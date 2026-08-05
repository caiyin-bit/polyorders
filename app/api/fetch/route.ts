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
  const [current, recentRes, countsRes] = await Promise.all([
    dbCurrentRun(),
    query(
      `SELECT step, started_at, finished_at, addresses_ok, addresses_failed, error
       FROM fetch_runs ORDER BY id DESC LIMIT 8`,
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
  ]);

  const c = countsRes.rows[0];
  return Response.json({
    running: childRunning() || externalFetchRunning() || current !== null,
    // Vercel serverless 无常驻进程,线上不支持手动触发(抓取由 GitHub Actions 定时执行)
    canRun: !process.env.VERCEL,
    current,
    recent: recentRes.rows,
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
