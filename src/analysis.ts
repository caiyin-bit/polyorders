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

最后以「结论」小节收尾:3-5 句话总体判断,并从【强烈关注/值得关注/观望/回避】中给出一档跟单参考评级,附一句话理由。
报告的最后一行必须是如下固定格式(供系统解析):单独成行、以「评级:」开头、用半角竖线分隔、理由不超过 40 字;「评级:」字样不要出现在结论正文里:
评级:观望|理由:此处为一句话理由`;
}

/* ---------- 交叉分析:多模型独立报告的综合 ---------- */

export const SYNTHESIS_SYSTEM = `你是跟单监控系统的首席分析师。多位独立分析师(不同的大模型)刚刚基于完全相同的数据,各自出具了对同一个 Polymarket 地址的检视报告。你的任务是汇总出一份最终结论。

必须遵守:
1. 只依据各份报告的内容,不引入报告之外的"事实";报告之间信息冲突时明确指出,不要私自裁决数据事实。
2. 分歧比共识更有价值:某份报告独有的洞察(其他报告没看到的机制、风险)要点名提出,并评估其可信度。
3. 综合评级从【强烈关注/值得关注/观望/回避】中选一档:各报告一致时随之;有分歧时偏保守(取更谨慎的一档),并说明分歧所在。
4. 输出为纯文本,总长 300-500 字,分三节:「一、共识」「二、分歧与独有洞察」「三、综合判断」。
5. 报告的最后一行必须是固定格式(供系统解析):单独成行、以「评级:」开头、半角竖线分隔、理由不超过 40 字:
评级:观望|理由:此处为一句话理由`;

export type SynthesisMember = {
  model: string;
  rating: string | null;
  reason: string | null;
  content: string;
};

export function buildSynthesisPrompt(
  address: string,
  members: SynthesisMember[],
): string {
  const parts = members.map(
    (m, i) =>
      `═══ 报告 ${i + 1}(模型:${m.model};其评级:${m.rating ?? "未给出"}${m.reason ? `,理由:${m.reason}` : ""})═══\n${m.content}`,
  );
  return `【任务】综合以下 ${members.length} 份对地址 ${address} 的独立检视报告,输出最终结论。

${parts.join("\n\n")}`;
}

/* ---------- 评级解析:列表页每行展示的结构化字段来自这里 ---------- */

export const RATINGS = ["强烈关注", "值得关注", "观望", "回避"] as const;
export type Rating = (typeof RATINGS)[number];

export type ExtractedRating = {
  rating: Rating;
  reason: string;
  /** 剥掉机器行后的正文:弹窗展示用,避免结论与固定行重复 */
  content: string;
};

// 模型偶尔用全角冒号/竖线,一并容忍;理由截断到 60 字防御性兜底
const RATING_LINE =
  /^评级[::]\s*(强烈关注|值得关注|观望|回避)\s*[||]\s*理由[::]\s*(.+)$/;

export function extractRating(content: string): ExtractedRating | null {
  const lines = content.split("\n");
  // 从末尾找:固定行约定在最后,但模型可能在其后再拖一两行空白或客套话
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].trim().match(RATING_LINE);
    if (m) {
      return {
        rating: m[1] as Rating,
        reason: m[2].trim().slice(0, 60),
        content: [...lines.slice(0, i), ...lines.slice(i + 1)]
          .join("\n")
          .trimEnd(),
      };
    }
  }
  // 兜底一:老格式只在结论里写【评级】,取其后同一行的文字当理由
  const m2 = content.match(/【(强烈关注|值得关注|观望|回避)】[::]?\s*([^\n]*)/);
  if (m2) {
    return {
      rating: m2[1] as Rating,
      reason: m2[2].trim().slice(0, 60),
      content,
    };
  }
  // 兜底二:实测模型会把评级揉进结论段末尾,分隔符五花八门
  // (「评级:观望。理由:…」「评级:回避——…」)。取最后一处,
  // 其后同行文字剥掉分隔符与可选的「理由:」前缀即为理由
  const loose = [
    ...content.matchAll(
      /评级[::]\s*(强烈关注|值得关注|观望|回避)[。.,,::——\-||\s]*(?:理由[::]\s*)?([^\n]*)/g,
    ),
  ].at(-1);
  if (loose) {
    return {
      rating: loose[1] as Rating,
      reason: loose[2].trim().slice(0, 60),
      content,
    };
  }
  return null;
}
