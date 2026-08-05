import { query, withTransaction } from "./db";
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
  const result = new Map<string, string>();
  if (conditionIds.length === 0) return result;

  const { rows: cached } = await query<{
    condition_id: string;
    event_slug: string | null;
  }>("SELECT condition_id, event_slug FROM markets WHERE condition_id = ANY($1)", [
    conditionIds,
  ]);
  const known = new Set(cached.map((r) => r.condition_id));
  for (const r of cached) {
    if (r.event_slug) result.set(r.condition_id, r.event_slug);
  }
  const missing = conditionIds.filter((id) => !known.has(id));
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

  const now = Date.now();
  await withTransaction(async (client) => {
    for (const [id, f] of found) {
      await client.query(
        `INSERT INTO markets (condition_id, slug, event_slug, fetched_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (condition_id) DO UPDATE SET
           slug = EXCLUDED.slug, event_slug = EXCLUDED.event_slug, fetched_at = EXCLUDED.fetched_at`,
        [id, f.slug ?? null, f.eventSlug ?? null, now],
      );
    }
  });
  for (const [id, f] of found) {
    const link = f.eventSlug ?? f.slug;
    if (link) result.set(id, link);
  }
  return result;
}
