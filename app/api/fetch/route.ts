import { execSync, spawn, type ChildProcess } from "node:child_process";
import { openSync } from "node:fs";
import { getDb } from "@/src/db";

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
  const last = getDb()
    .prepare(
      "SELECT step, started_at, finished_at, error FROM fetch_runs ORDER BY id DESC LIMIT 1",
    )
    .get() as
    | { step: string; started_at: number; finished_at: number | null; error: string | null }
    | undefined;
  return Response.json({
    running: childRunning() || externalFetchRunning(),
    lastRun: last ?? null,
  });
}
