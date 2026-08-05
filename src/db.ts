import { Pool, type PoolClient, types } from "pg";

// pg 对 int8/numeric 默认返回字符串;本项目数值均在 JS 安全整数/浮点范围内,统一转 number
types.setTypeParser(types.builtins.INT8, Number);
types.setTypeParser(types.builtins.NUMERIC, Number);

const DEFAULT_URL = "postgres://polyorders:polyorders@localhost:5432/polyorders";

// 挂 globalThis 防止 Next.js dev HMR 重载模块时泄漏连接池
const g = globalThis as unknown as { __pgPool?: Pool };

export function getPool(): Pool {
  if (!g.__pgPool) {
    const connectionString = process.env.DATABASE_URL ?? DEFAULT_URL;
    g.__pgPool = new Pool({
      connectionString,
      max: 10,
      // Supabase 强制 TLS 且证书为其自有 CA,跳过链校验
      ssl: connectionString.includes("supabase.co")
        ? { rejectUnauthorized: false }
        : undefined,
    });
  }
  return g.__pgPool;
}

export function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) {
  return getPool().query<T>(text, params as never[]);
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
