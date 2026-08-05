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

export async function POST() {
  // Vercel serverless 无常驻进程,线上抓取由 GitHub Actions 定时执行
  if (process.env.VERCEL) {
    return Response.json(
      { started: false, reason: "线上环境请通过 GitHub Actions 触发抓取" },
      { status: 501 },
    );
  }
  if (childRunning() || externalFetchRunning()) {
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
  const running = childRunning() || externalFetchRunning();

  const [currentRes, countsRes] = await Promise.all([
    running
      ? query<{ step: string; started_at: number }>(
          "SELECT step, started_at FROM fetch_runs WHERE finished_at IS NULL ORDER BY id DESC LIMIT 1",
        )
      : Promise.resolve(null),
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
    running,
    // Vercel serverless 无常驻进程,线上不支持手动触发(抓取由 GitHub Actions 定时执行)
    canRun: !process.env.VERCEL,
    current: currentRes?.rows[0] ?? null,
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
