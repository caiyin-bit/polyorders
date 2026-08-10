import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseChatCompletion } from "./llm";

describe("parseChatCompletion:DeepSeek 响应解析", () => {
  it("正常响应提取回答与用量(含推理 token 明细)", () => {
    const r = parseChatCompletion({
      model: "deepseek-v4-flash",
      choices: [{ message: { content: "看多" } }],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 8,
        completion_tokens_details: { reasoning_tokens: 5 },
      },
    });
    assert.equal(r.content, "看多");
    assert.equal(r.model, "deepseek-v4-flash");
    assert.deepEqual(r.usage, {
      promptTokens: 120,
      completionTokens: 8,
      reasoningTokens: 5,
    });
  });

  it("HTTP 200 里的业务错误必须抛出,不能当成模型回答", () => {
    assert.throws(
      () =>
        parseChatCompletion({
          error: { code: 429, message: "rate limited" },
        }),
      /业务错误.*rate limited/,
    );
  });

  it("缺 content 或空 content 都算失败——空回答进不了决策链路", () => {
    assert.throws(() => parseChatCompletion({ choices: [] }));
    assert.throws(() =>
      parseChatCompletion({ choices: [{ message: { content: "" } }] }),
    );
  });

  it("推理耗尽预算导致正文为空时,报错指向 max_tokens", () => {
    assert.throws(
      () =>
        parseChatCompletion({
          choices: [{ message: { content: "" }, finish_reason: "length" }],
        }),
      /max_tokens/,
    );
  });

  it("非对象响应(HTML 错误页等)抛错", () => {
    assert.throws(() => parseChatCompletion(null));
    assert.throws(() => parseChatCompletion("Bad Gateway"));
  });

  it("usage 缺失时容忍为 0,不影响主结果", () => {
    const r = parseChatCompletion({ choices: [{ message: { content: "ok" } }] });
    assert.deepEqual(r.usage, {
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
    });
  });
});
