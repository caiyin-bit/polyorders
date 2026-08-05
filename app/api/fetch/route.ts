import { execSync, spawn, type ChildProcess } from "node:child_process";
import { openSync } from "node:fs";
import { LEADERBOARD } from "@/src/config";
import { query } from "@/src/db";

export const dynamic = "force-dynamic";

const g = globalThis as unknown as { __fetchChild?: ChildProcess };

function childRunning(): boolean {
  return g.__fetchChild !== undefined && g.__fetchChild.exitCode === null;
}

function externalFetchRunning(): boolean {
  try {
    execSync('pgrep -f "tsx src/fetch/index.ts"', { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// 抓取可能由其他容器(scheduler 定时)执行,进程探测看不见,
// 以 fetch_runs 未完结记录作为跨容器的"进行中"信号;超过 6 小时视为残留脏数据
const STALE_RUN_MS = 6 * 3600_000;

// Polymarket 连通性探测:模块级缓存 30s,避免 2s 快轮询把探测打爆
const PROBE_TTL_MS = 30_000;
let probeCache: {
  at: number;
  result: { ok: boolean; latencyMs: number | null };
} | null = null;

async function probePolymarket(): Promise<{
  ok: boolean;
  latencyMs: number | null;
}> {
  if (probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) {
    return probeCache.result;
  }
  const started = Date.now();
  let result: { ok: boolean; latencyMs: number | null };
  try {
    // 任何 HTTP 响应都视为在线(即使 4xx);网络层失败才算离线
    await fetch("https://data-api.polymarket.com/", {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    result = { ok: true, latencyMs: Date.now() - started };
  } catch {
    result = { ok: false, latencyMs: null };
  }
  probeCache = { at: Date.now(), result };
  return result;
}

// 定时调度(与 deploy/crontab 一致):live 为北京时间双数小时 23 分,全量为北京每日 10:00
// 不依赖进程时区,用 UTC 数学显式算北京时间(UTC+8)
const BJ_OFFSET_MS = 8 * 3600_000;

function nextScheduledRun(now: number): { at: number; kind: "live" | "full" } {
  const bj = new Date(now + BJ_OFFSET_MS);
  const y = bj.getUTCFullYear();
  const mo = bj.getUTCMonth();
  const d = bj.getUTCDate();

  // live:逐小时枚举北京时刻,找第一个 > now 的偶数小时 23 分
  let live = Infinity;
  for (let i = 0; i < 50; i++) {
    const t =
      Date.UTC(y, mo, d, bj.getUTCHours(), 23, 0, 0) - BJ_OFFSET_MS + i * 3600_000;
    if (t > now && new Date(t + BJ_OFFSET_MS).getUTCHours() % 2 === 0) {
      live = t;
      break;
    }
  }

  // full:北京每日 10:00
  let full = Date.UTC(y, mo, d, 10, 0, 0, 0) - BJ_OFFSET_MS;
  if (full <= now) full += 86400_000;

  return live < full ? { at: live, kind: "live" } : { at: full, kind: "full" };
}

type RunRowFull = {
  id: number;
  run_group: string | null;
  step: string;
  started_at: number;
  finished_at: number | null;
  addresses_ok: number | null;
  addresses_failed: number | null;
  error: string | null;
};

// 把 fetch_runs 行聚合成抓取会话:run_group 相同的为一组;历史 NULL 行各自成组
function groupSessions(rows: RunRowFull[], limit: number) {
  const groups = new Map<string, RunRowFull[]>();
  for (const r of rows) {
    const key = r.run_group ?? `legacy-${r.id}`;
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.entries()].slice(0, limit).map(([group, steps]) => {
    const sorted = [...steps].sort((a, b) => a.started_at - b.started_at);
    const names = new Set(steps.map((s) => s.step));
    const kind = names.has("candidates")
      ? "full"
      : names.size === 1 && names.has("live")
        ? "live"
        : [...names].join("+");
    const done = steps.every((s) => s.finished_at !== null);
    return {
      group,
      kind,
      started_at: Math.min(...steps.map((s) => s.started_at)),
      finished_at: done
        ? Math.max(...steps.map((s) => s.finished_at ?? 0))
        : null,
      ok: done && steps.every((s) => !s.error),
      steps: sorted.map(({ step, started_at, finished_at, addresses_ok, addresses_failed, error }) => ({
        step,
        started_at,
        finished_at,
        addresses_ok,
        addresses_failed,
        error,
      })),
    };
  });
}

async function dbCurrentRun(): Promise<{ step: string; started_at: number } | null> {
  const { rows } = await query<{ step: string; started_at: number }>(
    "SELECT step, started_at FROM fetch_runs WHERE finished_at IS NULL AND started_at > $1 ORDER BY id DESC LIMIT 1",
    [Date.now() - STALE_RUN_MS],
  );
  return rows[0] ?? null;
}

export async function POST() {
  // Vercel serverless 无常驻进程,线上抓取由 GitHub Actions 定时执行
  if (process.env.VERCEL) {
    return Response.json(
      { started: false, reason: "线上环境请通过 GitHub Actions 触发抓取" },
      { status: 501 },
    );
  }
  if (childRunning() || externalFetchRunning() || (await dbCurrentRun())) {
    return Response.json(
      { started: false, reason: "already_running" },
      { status: 409 },
    );
  }
  const logFd = openSync("data/fetch-web.log", "a");
  const child = spawn("./node_modules/.bin/tsx", ["src/fetch/index.ts"], {
    cwd: process.cwd(),
    stdio: ["ignore", logFd, logFd],
  });
  child.on("exit", () => {
    g.__fetchChild = undefined;
  });
  g.__fetchChild = child;
  return Response.json({ started: true });
}

export async function GET() {
  const [current, runsRes, countsRes, polymarket] = await Promise.all([
    dbCurrentRun(),
    query<RunRowFull>(
      `SELECT id, run_group, step, started_at, finished_at, addresses_ok, addresses_failed, error
       FROM fetch_runs ORDER BY id DESC LIMIT 300`,
    ),
    query<{
      candidates: number;
      prefiltered: number;
      passed: number;
      positions_fetched: number;
      scored: number;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM candidates) AS candidates,
         (SELECT COUNT(*)::int FROM candidates WHERE markets_traded IS NOT NULL) AS prefiltered,
         (SELECT COUNT(*)::int FROM candidates WHERE passed_prefilter) AS passed,
         (SELECT COUNT(*)::int FROM candidates WHERE positions_fetched_at IS NOT NULL) AS positions_fetched,
         (SELECT COUNT(*)::int FROM scores WHERE rank IS NOT NULL) AS scored`,
    ),
    probePolymarket(),
  ]);

  const c = countsRes.rows[0];
  return Response.json({
    running: childRunning() || externalFetchRunning() || current !== null,
    // Vercel serverless 无常驻进程,线上不支持手动触发(抓取由 GitHub Actions 定时执行)
    canRun: !process.env.VERCEL,
    current,
    polymarket,
    nextRun: nextScheduledRun(Date.now()),
    sessions: groupSessions(runsRes.rows, 10),
    counts: {
      candidates: c.candidates,
      prefiltered: c.prefiltered,
      passed: c.passed,
      positionsFetched: c.positions_fetched,
      scored: c.scored,
    },
    targets: {
      candidates: LEADERBOARD.maxOffset,
    },
  });
}
