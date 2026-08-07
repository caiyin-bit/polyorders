// 钱包「AI 分析」的提示词构建。这个功能的价值几乎全在提示词质量上,
// 所以单独成纯函数文件:与数据组装(API 路由)、LLM 调用(llm.ts)解耦,
// 可以单测、可以脱离网络迭代措辞。
//
// 设计取舍:
// - 衍生统计(盈亏比、利润集中度、大赢大亏单)由 SQL 预先算好传入,
//   而不是让模型自己从明细里数——模型算术不可靠,预计算的数字才配当证据。
// - 明细仍然给(持仓/成交/平仓各几十行):画像与意图解读需要模型看原始
//   序列里的模式,这是聚合数字替代不了的。
// - 输出要求纯文本编号小节:前端零依赖,不引 Markdown 渲染器。

import { COPY_DAILY_MAX_USD_DEFAULT, COPY_ORDER_USD, TOP_N } from "./config";

export type AnalysisScore = {
  rank: number | null;
  total_positions: number;
  winning_positions: number;
  win_rate: number;
  total_realized_pnl: number | null;
  avg_pnl: number | null;
};

export type AnalysisOpenPosition = {
  title: string | null;
  outcome: string | null;
  size: number | null;
  avg_price: number | null;
  cur_price: number | null;
  current_value: number | null;
  cash_pnl: number | null;
};

export type AnalysisTrade = {
  timestamp: number; // 秒
  side: string;
  title: string | null;
  outcome: string | null;
  price: number | null;
  usdc_size: number | null;
};

export type AnalysisClosedRow = {
  timestamp: number | null; // 秒
  title: string | null;
  outcome: string | null;
  avg_price: number | null;
  realized_pnl: number;
};

export type AnalysisInput = {
  address: string;
  username: string | null;
  /** ISO 字符串,由调用方注入,保持本函数纯 */
  now: string;
  score: AnalysisScore | null;
  openTotal: number;
  openPositions: AnalysisOpenPosition[];
  trades: AnalysisTrade[];
  closed: {
    total: number;
    sumPnl: number;
    avgWin: number | null;
    avgLoss: number | null;
    last30d: { count: number; sum: number };
    topWins: AnalysisClosedRow[];
    topLosses: AnalysisClosedRow[];
    recent: AnalysisClosedRow[];
  };
  /** [秒级时间戳, 累计已实现盈亏] 采样序列 */
  curve: Array<[number, number]>;
};

export const ANALYST_SYSTEM = `你是一名深耕预测市场的交易分析师,专长是审计 Polymarket 上「聪明钱」地址的真实水平。
你服务于一套跟单监控系统:它持续抓取 Polymarket 月度盈利榜,筛出 Top ${TOP_N} 地址供用户研究与小额跟单。用户点开某个地址的档案后请求你出具检视报告——他们要的不是夸奖,而是「这钱是怎么赚的、还能不能继续赚、跟他有没有肉」的判断。

必须遵守:
1. 只依据用户消息中提供的数据下结论,数据之外的“事实”一律不得出现;需要外部信息才能验证的判断,直接写明「仅凭现有数据无法判断」。
2. 每个论点都要落到具体数字(金额、次数、价格、日期)上作为证据;没有数字支撑的形容词删掉。
3. 价格即概率:Polymarket 价格在 0-1 之间。0.04 买入是约 25 倍赔率的长尾彩票,0.95 买入是吃 5% 价差的高确定性交易,两种打法的风险画像完全不同,要识别他属于哪种。
4. 时刻警惕幸存者偏差:能入围就意味着近期赚了钱。你的价值在于区分「可复制的优势」与「一次性的运气」——一笔大赢撑起的排名与长期稳定盈利,含金量完全不同。
5. 数据窗口有限(见用户消息中的说明),窗口之外不可见;不要把「窗口内没有」说成「从来没有」。
6. 输出为纯文本:用「一、」「二、」等编号小节,节内要点以「- 」开头,不使用任何 Markdown 符号(#、*、\` 等);总长 600-900 字,信息密度优先,拒绝凑字。`;

/* ---------- 数据渲染工具:提示词里的数字格式要稳定、紧凑、无歧义 ---------- */

function usd(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "-";
  const abs = Math.abs(v);
  const s =
    abs >= 1000
      ? Math.round(abs).toLocaleString("en-US")
      : abs.toFixed(2);
  return `${v < 0 ? "-" : ""}$${s}`;
}

function px(v: number | null): string {
  return v === null || !Number.isFinite(v) ? "-" : v.toFixed(2);
}

function day(sec: number | null): string {
  if (!sec) return "-";
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

function clock(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " ");
}

function closedLine(r: AnalysisClosedRow): string {
  return `${day(r.timestamp)} | ${r.title ?? "-"} | ${r.outcome ?? "-"} | 均价 ${px(r.avg_price)} | ${usd(r.realized_pnl)}`;
}

function section(title: string, lines: string[]): string {
  return `${title}\n${lines.length > 0 ? lines.join("\n") : "(无数据)"}`;
}

export function buildAnalysisPrompt(d: AnalysisInput): string {
  const s = d.score;
  const c = d.closed;

  // 利润集中度:模型判断「一笔大赢还是稳定盈利」的关键证据,必须预先算好
  const top5WinSum = c.topWins.reduce((a, r) => a + r.realized_pnl, 0);
  const concentration =
    c.sumPnl > 0 && top5WinSum > 0
      ? `前 5 大盈利合计 ${usd(top5WinSum)},占总已实现盈亏的 ${Math.round((top5WinSum / c.sumPnl) * 100)}%`
      : "总盈亏非正或无盈利仓位,集中度不适用";
  const winLossRatio =
    c.avgWin !== null && c.avgLoss !== null && c.avgLoss !== 0
      ? (c.avgWin / Math.abs(c.avgLoss)).toFixed(2)
      : "-";

  const profile = [
    `地址: ${d.address}`,
    `用户名: ${d.username ?? "(未知)"}`,
    `榜单排名: ${s?.rank ? `#${s.rank}` : "未上榜"}`,
    s
      ? `胜率 ${(s.win_rate * 100).toFixed(1)}%(${s.winning_positions}/${s.total_positions});已实现盈亏 ${usd(s.total_realized_pnl)};平均单仓 ${usd(s.avg_pnl)}`
      : "暂无评分数据",
  ];

  const derived = [
    `已平仓 ${c.total} 笔,合计 ${usd(c.sumPnl)}`,
    `盈利仓平均 ${usd(c.avgWin)},亏损仓平均 ${usd(c.avgLoss)},单笔盈亏比 ${winLossRatio}`,
    concentration,
    `最近 30 天平仓 ${c.last30d.count} 笔,合计 ${usd(c.last30d.sum)}`,
  ];

  const curveLines = d.curve.map(([t, v]) => `${day(t)} → ${usd(v)}`);

  const openLines = d.openPositions.map(
    (p) =>
      `${p.title ?? "-"} | ${p.outcome ?? "-"} | ${p.size !== null ? Math.round(p.size) : "-"} 份 | 均价 ${px(p.avg_price)} → 现价 ${px(p.cur_price)} | 现值 ${usd(p.current_value)} | 浮动 ${usd(p.cash_pnl)}`,
  );

  const tradeLines = d.trades.map(
    (t) =>
      `${clock(t.timestamp)} | ${t.side === "BUY" ? "买" : "卖"} | ${t.title ?? "-"} | ${t.outcome ?? "-"} | @${px(t.price)} | ${usd(t.usdc_size)}`,
  );

  return `【任务】对以下 Polymarket 地址做全面检视与解读,产出跟单参考报告。

【背景与数据窗口】
- 当前时间 ${d.now}(UTC)。数据为本系统抓取的 Polymarket 公开数据。
- 榜单规则:按近一个月已实现盈亏排序,系统跟踪前 ${TOP_N} 名。
- 窗口限制:成交流水仅保留最近约 14 天(每地址至少最近 50 笔);已平仓为全量历史,明细只列最近 ${c.recent.length} 条(聚合统计覆盖全量);当前持仓共 ${d.openTotal} 条,按市值列出前 ${d.openPositions.length} 条。
- 本系统的跟单参数:单笔 $${COPY_ORDER_USD},日预算 $${COPY_DAILY_MAX_USD_DEFAULT},评估跟单适配性时以此为准。

${section("【地址概况】", profile)}

${section("【衍生统计】(由系统在全量已平仓数据上预先计算,可直接引用)", derived)}

${section(`【前 ${c.topWins.length} 大盈利仓】(平仓日期 | 市场 | 方向 | 均价 | 盈亏)`, c.topWins.map(closedLine))}

${section(`【前 ${c.topLosses.length} 大亏损仓】(同上)`, c.topLosses.map(closedLine))}

${section("【累计已实现盈亏曲线】(采样点:日期 → 累计值)", curveLines)}

${section("【当前持仓】(市场 | 方向 | 数量 | 均价→现价 | 现值 | 浮动盈亏)", openLines)}

${section("【最近成交】(UTC 时间 | 买/卖 | 市场 | 方向 | 价格 | 金额)", tradeLines)}

${section("【最近已平仓】(平仓日期 | 市场 | 方向 | 均价 | 盈亏)", c.recent.map(closedLine))}

【分析框架】按以下六节输出,每节 2-5 个要点;某节数据不足就明说「数据不足」并解释缺什么,不要硬凑:
一、交易者画像 —— 主战场(从市场标题归纳:体育/加密/政治/娱乐等)、打法(低价博长尾还是高价吃确定性,可从均价分布判断)、单笔规模量级、交易频率与持仓周期。
二、业绩质量 —— 盈亏结构是否健康:利润是否靠少数大赢撑起(引用集中度数字);盈亏比与胜率是否自洽;权益曲线形态(稳定爬升/一次跳变/近期回撤),点出曲线中最大跳变对应哪笔仓位。
三、当前持仓检视 —— 集中度(单一市场或同一事件占总市值比例)、整体浮盈浮亏、均价与现价的偏离方向说明市场此刻站在他哪一边、哪几笔最值得盯。
四、近期动向解读 —— 从最近成交推断意图:正在建仓什么、离场什么;同一市场短时间内反复买卖的,指出并给出可能解释(调仓/做市/刷量)。
五、跟单适配性 —— 以本系统「单笔 $${COPY_ORDER_USD}、有延迟、只能吃到他之后的价格」为前提:他的优势是否可复制(靠信息与判断,还是靠速度与大资金);其常用价位区间上跟单是否还有期望收益;成交频率是否适合跟。
六、风险与红旗 —— 幸存者偏差在此例的具体体现、疑似对敲或刷量的痕迹、数据窗口造成的盲区、其他异常信号。

最后以「结论」小节收尾:3-5 句话总体判断,并从【强烈关注/值得关注/观望/回避】中给出一档跟单参考评级,附一句话理由。`;
}
