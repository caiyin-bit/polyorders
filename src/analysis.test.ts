import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANALYST_SYSTEM,
  buildAnalysisPrompt,
  buildSynthesisPrompt,
  extractRating,
  SYNTHESIS_SYSTEM,
  type AnalysisInput,
} from "./analysis";

function fixture(over: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    address: "0xabc0000000000000000000000000000000000def",
    username: "whale42",
    now: "2026-08-07T12:00:00.000Z",
    score: {
      rank: 3,
      total_positions: 120,
      winning_positions: 90,
      win_rate: 0.75,
      total_realized_pnl: 52_300,
      avg_pnl: 435,
    },
    openTotal: 7,
    openPositions: [
      {
        title: "Will BTC hit $150k in 2026?",
        outcome: "Yes",
        size: 1000,
        avg_price: 0.42,
        cur_price: 0.55,
        current_value: 550,
        cash_pnl: 130,
      },
    ],
    trades: [
      {
        timestamp: 1_754_500_000,
        side: "BUY",
        title: "Fed cuts rates in September?",
        outcome: "Yes",
        price: 0.61,
        usdc_size: 1200,
      },
    ],
    closed: {
      total: 113,
      sumPnl: 52_300,
      avgWin: 700,
      avgLoss: -350,
      last30d: { count: 40, sum: 21_000 },
      topWins: [
        {
          timestamp: 1_753_000_000,
          title: "Super Bowl winner",
          outcome: "Chiefs",
          avg_price: 0.08,
          realized_pnl: 30_000,
        },
      ],
      topLosses: [
        {
          timestamp: 1_752_000_000,
          title: "ETH flips BTC",
          outcome: "Yes",
          avg_price: 0.3,
          realized_pnl: -4_000,
        },
      ],
      recent: [
        {
          timestamp: 1_754_400_000,
          title: "NBA finals game 5",
          outcome: "Over",
          avg_price: 0.5,
          realized_pnl: 250,
        },
      ],
    },
    curve: [
      [1_750_000_000, 1000],
      [1_754_000_000, 52_300],
    ],
    ...over,
  };
}

describe("buildAnalysisPrompt:钱包检视提示词", () => {
  it("覆盖六节分析框架与结论评级——框架缺一节,报告就少一个维度", () => {
    const p = buildAnalysisPrompt(fixture());
    for (const kw of [
      "一、交易者画像",
      "二、业绩质量",
      "三、当前持仓检视",
      "四、近期动向解读",
      "五、跟单适配性",
      "六、风险与红旗",
      "强烈关注/值得关注/观望/回避",
    ]) {
      assert.ok(p.includes(kw), `缺少:${kw}`);
    }
  });

  it("预计算的衍生统计进入提示词:集中度、盈亏比、近 30 天", () => {
    const p = buildAnalysisPrompt(fixture());
    // 30000 / 52300 ≈ 57%
    assert.match(p, /占总已实现盈亏的 57%/);
    // 700 / 350 = 2.00
    assert.match(p, /单笔盈亏比 2\.00/);
    assert.match(p, /最近 30 天平仓 40 笔,合计 \$21,000/);
  });

  it("明细行带齐关键字段:秒级时间戳转为可读 UTC 时间", () => {
    const p = buildAnalysisPrompt(fixture());
    assert.ok(p.includes("买 | Fed cuts rates in September? | Yes | @0.61 | $1,200"));
    assert.ok(p.includes("均价 0.42 → 现价 0.55"));
    // 1_754_500_000s = 2025-08-06 17:06 UTC
    assert.ok(p.includes("2025-08-06 17:06"));
  });

  it("空数据不硬凑:各明细节显示(无数据),总盈亏非正时不算集中度", () => {
    const p = buildAnalysisPrompt(
      fixture({
        score: null,
        openPositions: [],
        trades: [],
        closed: {
          total: 0,
          sumPnl: -100,
          avgWin: null,
          avgLoss: null,
          last30d: { count: 0, sum: 0 },
          topWins: [],
          topLosses: [],
          recent: [],
        },
        curve: [],
      }),
    );
    assert.ok(p.includes("(无数据)"));
    assert.ok(p.includes("暂无评分数据"));
    assert.ok(p.includes("集中度不适用"));
    assert.ok(p.includes("单笔盈亏比 -"));
  });

  it("系统提示词钉住关键纪律:禁止编造、数字佐证、幸存者偏差、纯文本输出", () => {
    for (const kw of ["不得出现", "具体数字", "幸存者偏差", "纯文本"]) {
      assert.ok(ANALYST_SYSTEM.includes(kw), `缺少:${kw}`);
    }
  });
});

describe("交叉分析综合提示词", () => {
  it("综合提示词带上每份报告的模型名、评级与全文", () => {
    const p = buildSynthesisPrompt("0xabc", [
      { model: "deepseek-v4-flash", rating: "回避", reason: "无肉可吃", content: "报告A全文" },
      { model: "qwen-max", rating: null, reason: null, content: "报告B全文" },
    ]);
    assert.ok(p.includes("2 份"));
    assert.ok(p.includes("模型:deepseek-v4-flash;其评级:回避,理由:无肉可吃"));
    assert.ok(p.includes("模型:qwen-max;其评级:未给出"));
    assert.ok(p.includes("报告A全文") && p.includes("报告B全文"));
  });

  it("综合系统提示词钉住关键纪律:分歧优先、保守裁决、固定尾行", () => {
    for (const kw of ["分歧", "偏保守", "评级:", "强烈关注/值得关注/观望/回避"]) {
      assert.ok(SYNTHESIS_SYSTEM.includes(kw), `缺少:${kw}`);
    }
  });
});

describe("extractRating:报告尾行评级解析", () => {
  const report = "一、画像\n- 要点\n\n结论\n整体判断……";

  it("标准尾行:提取评级与理由,正文剥离机器行", () => {
    const r = extractRating(`${report}\n评级:回避|理由:价差太薄跟单无利可图`);
    assert.equal(r?.rating, "回避");
    assert.equal(r?.reason, "价差太薄跟单无利可图");
    assert.equal(r?.content, report);
  });

  it("容忍全角冒号与竖线、尾部多余空行", () => {
    const r = extractRating(`${report}\n评级:值得关注|理由:结构健康\n\n`);
    assert.equal(r?.rating, "值得关注");
    assert.equal(r?.reason, "结构健康");
  });

  it("兜底:老报告只有结论里的【评级】写法", () => {
    const r = extractRating("……跟单评级【观望】:近期回撤未见底。");
    assert.equal(r?.rating, "观望");
    assert.ok(r?.reason.includes("近期回撤"));
  });

  it("宽松兜底:评级揉进结论段、分隔符不规范(线上真实案例)", () => {
    // 案例一:「评级:观望。理由:…」句号分隔且不换行
    const r1 = extractRating(
      "结论\n……在$10日预算下不具备可复制性。评级:观望。理由:高频撒网型交易,跟单延迟难以复制其边缘优势。",
    );
    assert.equal(r1?.rating, "观望");
    assert.ok(r1?.reason.startsWith("高频撒网型交易"));
    // 案例二:「评级:回避——…」破折号带理由
    const r2 = extractRating(
      "结论\n……数据窗口有限。评级:回避——他在 0.98-1.00 价位吃最后 2% 价差,跟单者没有肉可吃。",
    );
    assert.equal(r2?.rating, "回避");
    assert.ok(r2?.reason.includes("价差"));
  });

  it("四档之外的词不认;完全没有评级返回 null", () => {
    assert.equal(extractRating(`${report}\n评级:强烈推荐|理由:x`), null);
    assert.equal(extractRating(report), null);
  });

  it("理由超长截断到 60 字,防御模型不守 40 字约定", () => {
    const r = extractRating(`${report}\n评级:观望|理由:${"长".repeat(100)}`);
    assert.equal(r?.reason.length, 60);
  });
});
