import { getDb } from "@/src/db";
import { TOP_N } from "@/src/config";
import { fmtPct, fmtUsd, shortAddr } from "../lib/format";

export const dynamic = "force-dynamic";

type TopRow = {
  address: string;
  username: string | null;
  total_positions: number;
  winning_positions: number;
  win_rate: number;
  total_realized_pnl: number | null;
  rank: number;
};

export default function TopPage() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.address, c.username, s.total_positions, s.winning_positions,
              s.win_rate, s.total_realized_pnl, s.rank
       FROM scores s LEFT JOIN candidates c ON c.address = s.address
       WHERE s.rank IS NOT NULL
       ORDER BY s.rank
       LIMIT ?`,
    )
    .all(TOP_N) as TopRow[];

  const pnlStmt = db.prepare(
    "SELECT realized_pnl FROM closed_positions WHERE address = ? ORDER BY timestamp DESC LIMIT 50",
  );

  return (
    <main>
      <h2 className="mb-4 text-lg font-medium">
        Top {TOP_N} 高胜率地址
        <span className="ml-2 text-sm font-normal text-zinc-500">
          按 胜率 × ln(仓位数) 排序,样本 30–5000(剔除做市机器人)
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">
          暂无评分数据,先运行 <code>pnpm fetch</code>
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => {
            const pnls = (pnlStmt.all(r.address) as Array<{ realized_pnl: number }>)
              .map((p) => p.realized_pnl)
              .reverse();
            const maxAbs = Math.max(1, ...pnls.map(Math.abs));
            return (
              <a
                key={r.address}
                href={`/wallet/${r.address}`}
                className="rounded-xl border border-zinc-200 bg-zinc-50 p-5 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-lg font-semibold text-zinc-500">
                    #{r.rank}
                  </span>
                  <span className="font-mono text-sm text-zinc-700 dark:text-zinc-300">
                    {shortAddr(r.address)}
                  </span>
                </div>
                {r.username && (
                  <div className="mt-1 truncate text-sm text-zinc-500 dark:text-zinc-400">
                    {r.username}
                  </div>
                )}
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-xl font-semibold text-emerald-600 dark:text-emerald-400">
                      {fmtPct(r.win_rate)}
                    </div>
                    <div className="text-xs text-zinc-500">胜率</div>
                  </div>
                  <div>
                    <div className="text-xl font-semibold">
                      {fmtUsd(r.total_realized_pnl)}
                    </div>
                    <div className="text-xs text-zinc-500">已实现盈亏</div>
                  </div>
                  <div>
                    <div className="text-xl font-semibold">
                      {r.total_positions}
                    </div>
                    <div className="text-xs text-zinc-500">仓位数</div>
                  </div>
                </div>
                <div className="mt-4 flex h-10 items-end gap-px">
                  {pnls.map((p, i) => (
                    <div
                      key={i}
                      className={`flex-1 rounded-sm ${p >= 0 ? "bg-emerald-500/70" : "bg-red-500/70"}`}
                      style={{ height: `${Math.max(8, (Math.abs(p) / maxAbs) * 100)}%` }}
                    />
                  ))}
                </div>
              </a>
            );
          })}
        </div>
      )}
    </main>
  );
}
