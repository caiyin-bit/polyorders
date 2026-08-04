import { getDb } from "./db";
import { createLimiter, fetchJson, sleep } from "./http";

const GAMMA_API = "https://gamma-api.polymarket.com";
const BATCH = 25;

type GammaMarket = {
  conditionId: string;
  slug?: string;
  events?: Array<{ slug?: string }>;
};

const limiter = createLimiter(5, 100);

async function fetchBatch(
  ids: string[],
  closed: boolean,
): Promise<GammaMarket[]> {
  const url =
    `${GAMMA_API}/markets?${ids.map((id) => `condition_ids=${encodeURIComponent(id)}`).join("&")}` +
    (closed ? "&closed=true" : "");
  for (let attempt = 0; attempt < 4; attempt++) {
    const rows = await limiter(() => fetchJson<GammaMarket[]>(url));
    if (rows.length > 0 || attempt === 3) return rows;
    await sleep(1500 * (attempt + 1));
  }
  return [];
}

export async function getEventSlugs(
  conditionIds: string[],
): Promise<Map<string, string>> {
  const db = getDb();
  const result = new Map<string, string>();
  const missing: string[] = [];

  const cached = db.prepare(
    "SELECT condition_id, event_slug FROM markets WHERE condition_id = ?",
  );
  for (const id of conditionIds) {
    const row = cached.get(id) as
      | { condition_id: string; event_slug: string | null }
      | undefined;
    if (row === undefined) missing.push(id);
    else if (row.event_slug) result.set(id, row.event_slug);
  }
  if (missing.length === 0) return result;

  const found = new Map<string, { slug: string | null; eventSlug: string | null }>();
  for (const closed of [true, false]) {
    const pending = missing.filter((id) => !found.has(id));
    if (pending.length === 0) break;
    const batches: string[][] = [];
    for (let i = 0; i < pending.length; i += BATCH) {
      batches.push(pending.slice(i, i + BATCH));
    }
    await Promise.all(
      batches.map(async (ids) => {
        try {
          const markets = await fetchBatch(ids, closed);
          for (const m of markets) {
            found.set(m.conditionId, {
              slug: m.slug ?? null,
              eventSlug: m.events?.[0]?.slug ?? null,
            });
          }
        } catch (err) {
          console.error(`markets: gamma batch failed: ${String(err)}`);
        }
      }),
    );
  }

  const insert = db.prepare(
    `INSERT INTO markets (condition_id, slug, event_slug, fetched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(condition_id) DO UPDATE SET
       slug = excluded.slug, event_slug = excluded.event_slug, fetched_at = excluded.fetched_at`,
  );
  const now = Date.now();
  db.transaction(() => {
    for (const [id, f] of found) {
      insert.run(id, f.slug ?? null, f.eventSlug ?? null, now);
    }
  })();
  for (const [id, f] of found) {
    const link = f.eventSlug ?? f.slug;
    if (link) result.set(id, link);
  }
  return result;
}
