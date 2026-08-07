// 对已完成但未解析出评级的报告,用当前解析器重新提取评级与理由。
// 幂等,只动 rating IS NULL 的行;解析器升级后跑一次即可,不重新调用 LLM。
// 用法:npx tsx --env-file-if-exists=.env scripts/backfill-ratings.ts

import { extractRating } from "../src/analysis";
import { getPool, query } from "../src/db";

const { rows } = await query<{ id: number; content: string | null }>(
  `SELECT id, content FROM wallet_analyses
   WHERE status = 'done' AND rating IS NULL AND content IS NOT NULL`,
);
let updated = 0;
for (const r of rows) {
  const e = extractRating(r.content!);
  if (!e) continue;
  await query(
    `UPDATE wallet_analyses SET rating = $2, rating_reason = $3, content = $4
     WHERE id = $1`,
    [r.id, e.rating, e.reason, e.content],
  );
  updated++;
}
console.log(`backfill-ratings: 待处理 ${rows.length} 条,补齐 ${updated} 条`);
await getPool().end();
