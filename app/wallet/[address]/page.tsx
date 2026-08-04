import { getDb } from "@/src/db";
import { getEventSlugs } from "@/src/markets";
import { fmtPct, fmtTime, fmtUsd, shortAddr } from "../../lib/format";

export const dynamic = "force-dynamic";

type ScoreRow = {
  total_positions: number;
  winning_positions: number;
  win_rate: number;
  total_realized_pnl: number | null;
  avg_pnl: number | null;
  rank: number | null;
};

type PositionRow = {
  condition_id: string;
  title: string | null;
  outcome: string | null;
  avg_price: number | null;
  total_bought: number | null;
  realized_pnl: number;
  timestamp: number | null;
};

const MAX_ROWS = 500;

export default async function WalletPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  const db = getDb();

  const score = db
    .prepare("SELECT * FROM scores WHERE address = ?")
    .get(address) as ScoreRow | undefined;

  const { n: totalRows } = db
    .prepare("SELECT COUNT(*) AS n FROM closed_positions WHERE address = ?")
    .get(address) as { n: number };

  const positions = db
    .prepare(
      `SELECT condition_id, title, outcome, avg_price, total_bought, realized_pnl, timestamp
       FROM closed_positions WHERE address = ?
       ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(address, MAX_ROWS) as PositionRow[];

  const distinctIds = [...new Set(positions.map((p) => p.condition_id))];
  const eventSlugs = await getEventSlugs(distinctIds);

  const stats = [
    { label: "排名", value: score?.rank ? `#${score.rank}` : "-" },
    { label: "胜率", value: score ? fmtPct(score.win_rate) : "-" },
    { label: "已实现盈亏", value: score ? fmtUsd(score.total_realized_pnl) : "-" },
    { label: "仓位数", value: score?.total_positions ?? "-" },
    { label: "盈利仓位", value: score?.winning_positions ?? "-" },
    { label: "平均单仓盈亏", value: score ? fmtUsd(score.avg_pnl) : "-" },
  ];

  return (
    <main className="space-y-8">
      <div>
        <h2 className="font-mono text-lg font-medium">{shortAddr(address)}</h2>
        <div className="mt-1 select-all break-all font-mono text-xs text-zinc-500">
          {address}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-center dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="text-lg font-semibold tabular-nums">{s.value}</div>
            <div className="mt-1 text-xs text-zinc-500">{s.label}</div>
          </div>
        ))}
      </div>

      <section>
        <h3 className="mb-3 font-medium">
          已平仓仓位
          <span className="ml-2 text-sm font-normal text-zinc-500">
            共 {totalRows} 条{totalRows > MAX_ROWS ? `,显示最新 ${MAX_ROWS} 条` : ""}
          </span>
        </h3>
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-zinc-500">
            <tr>
              <th className="py-2 font-normal">市场</th>
              <th className="py-2 font-normal">方向</th>
              <th className="py-2 text-right font-normal">均价</th>
              <th className="py-2 text-right font-normal">买入量</th>
              <th className="py-2 text-right font-normal">已实现盈亏</th>
              <th className="py-2 text-right font-normal">时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {positions.map((p, i) => (
              <tr key={i}>
                <td className="max-w-96 truncate py-2 pr-4">
                  {(() => {
                    const slug = eventSlugs.get(p.condition_id);
                    return slug ? (
                      <a
                        href={`https://polymarket.com/event/${slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-700 hover:underline dark:text-emerald-400"
                      >
                        {p.title ?? "-"}
                      </a>
                    ) : (
                      (p.title ?? "-")
                    );
                  })()}
                </td>
                <td className="py-2 pr-4 text-zinc-500 dark:text-zinc-400">{p.outcome ?? "-"}</td>
                <td className="py-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                  {p.avg_price !== null ? p.avg_price.toFixed(3) : "-"}
                </td>
                <td className="py-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                  {p.total_bought !== null ? p.total_bought.toFixed(0) : "-"}
                </td>
                <td
                  className={`py-2 text-right tabular-nums ${p.realized_pnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                >
                  {fmtUsd(p.realized_pnl)}
                </td>
                <td className="py-2 text-right text-zinc-500 dark:text-zinc-400">
                  {fmtTime(p.timestamp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
