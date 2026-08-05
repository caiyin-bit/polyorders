import { getPool, query } from "../db";
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
    const { rows } = await query<{ id: number }>(
      "INSERT INTO fetch_runs (step, started_at) VALUES ($1, $2) RETURNING id",
      [name, Date.now()],
    );
    const runId = rows[0].id;
    const started = Date.now();
    try {
      const result = await fn();
      await query(
        "UPDATE fetch_runs SET finished_at = $1, addresses_ok = $2, addresses_failed = $3 WHERE id = $4",
        [Date.now(), result?.ok ?? null, result?.failed ?? null, runId],
      );
      console.log(`${name}: done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (err) {
      await query(
        "UPDATE fetch_runs SET finished_at = $1, error = $2 WHERE id = $3",
        [Date.now(), String(err), runId],
      );
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
    "4": runStep("score", () => computeScores().then((r) => ({ ok: r.total }))),
  };

  const selected = step ? [step] : Object.keys(steps);
  for (const key of selected) {
    const fn = steps[key];
    if (!fn) throw new Error(`unknown step: ${key}`);
    await fn();
  }
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
