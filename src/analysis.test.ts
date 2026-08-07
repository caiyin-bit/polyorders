import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANALYST_SYSTEM,
  buildAnalysisPrompt,
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
