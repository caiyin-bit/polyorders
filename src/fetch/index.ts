import { getDb } from "../db";
import { fetchCandidates } from "./candidates";
import { fetchPositions } from "./positions";
import { prefilter } from "./prefilter";
import { computeScores } from "./score";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function runStep(
  name: string,
  fn: () => Promise<{ ok?: number; failed?: number } | void>,
) {
  return async () => {
    const db = getDb();
    const runId = db
      .prepare("INSERT INTO fetch_runs (step, started_at) VALUES (?, ?)")
      .run(name, Date.now()).lastInsertRowid;
    const started = Date.now();
    try {
      const result = await fn();
      db.prepare(
        "UPDATE fetch_runs SET finished_at = ?, addresses_ok = ?, addresses_failed = ? WHERE id = ?",
      ).run(Date.now(), result?.ok ?? null, result?.failed ?? null, runId);
      console.log(`${name}: done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (err) {
      db.prepare(
        "UPDATE fetch_runs SET finished_at = ?, error = ? WHERE id = ?",
      ).run(Date.now(), String(err), runId);
      throw err;
    }
  };
}

async function main() {
  const step = argValue("step");
  const force = process.argv.includes("--force");
  const maxArg = argValue("max");
  const max = maxArg ? Number(maxArg) : undefined;

  const steps: Record<string, () => Promise<void>> = {
    "1": runStep("candidates", () =>
      fetchCandidates(force).then((n) => ({ ok: n })),
    ),
    "2": runStep("prefilter", () => prefilter(force, max)),
    "3": runStep("positions", () => fetchPositions(force, max)),
    "4": runStep("score", () => {
      const r = computeScores();
      return Promise.resolve({ ok: r.total });
    }),
  };

  const selected = step ? [step] : Object.keys(steps);
  for (const key of selected) {
    const fn = steps[key];
    if (!fn) throw new Error(`unknown step: ${key}`);
    await fn();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
