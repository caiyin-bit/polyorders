import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPool } from "../src/db";

async function main() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const dir = join(process.cwd(), "db/migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  // 重号必须当场报错:版本号相同的两个文件,后一个会被当成「已执行」静默跳过,
  // 表结构与代码就此对不上,而部署日志一切正常(此坑踩过一次)
  const seen = new Map<number, string>();
  for (const file of files) {
    const version = Number(file.split("_")[0]);
    if (!Number.isInteger(version)) {
      throw new Error(`migration 文件名需以数字开头: ${file}`);
    }
    const dup = seen.get(version);
    if (dup) {
      throw new Error(`migration 版本号重复: ${dup} 与 ${file} 都是 ${version}`);
    }
    seen.set(version, file);
  }

  const { rows } = await pool.query("SELECT version FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.version as number));

  for (const file of files) {
    const version = Number(file.split("_")[0]);
    if (applied.has(version)) continue;

    const sql = readFileSync(join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
        [version, file],
      );
      await client.query("COMMIT");
      console.log(`migrate: applied ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  await pool.end();
  console.log("migrate: up to date");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
