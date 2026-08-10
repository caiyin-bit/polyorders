import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LLM_MAX_TOKENS_CAP, LLM_MODELS } from "./config";
import {
  buildRequestBody,
  costUsd,
  isLlmConfigured,
  resolveModel,
  type GatewayRequest,
} from "./llm-gateway";

const DS = LLM_MODELS["deepseek-v4-flash"];
const OR = LLM_MODELS["claude-sonnet"];

function req(over: Partial<GatewayRequest> = {}): GatewayRequest {
  return { messages: [{ role: "user", content: "hi" }], caller: "test", ...over };
}

describe("resolveModel:逻辑模型解析", () => {
  it("缺省落到默认主力模型;拼错的名字抛错而非静默回落", () => {
    assert.equal(resolveModel().logical, "deepseek-v4-flash");
    assert.throws(() => resolveModel("deepseek-v99"), /未注册/);
  });
});

describe("isLlmConfigured:按默认模型的供应商判密钥", () => {
  it("有密钥为 true,无密钥或空串为 false", () => {
    assert.equal(isLlmConfigured({ DEEPSEEK_API_KEY: "sk-xxx" }), true);
    assert.equal(isLlmConfigured({}), false);
    assert.equal(isLlmConfigured({ DEEPSEEK_API_KEY: "" }), false);
  });
});

describe("costUsd:成本核算——算错则预算闸门失灵", () => {
  it("按注册表单价折算,推理 token 已含在 completion 内不重复计费", () => {
    const usage = { promptTokens: 1_000_000, completionTokens: 500_000, reasoningTokens: 100_000 };
    // 1M × $0.09 + 0.5M × $0.18 = 0.18
    assert.ok(Math.abs(costUsd(DS, usage) - 0.18) < 1e-9);
  });

  it("零用量成本为 0", () => {
    assert.equal(costUsd(DS, { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 }), 0);
  });
});

describe("buildRequestBody:供应商参数方言", () => {
  it("DeepSeek:none → thinking disabled;档位 → reasoning_effort", () => {
    const off = buildRequestBody(DS, req({ reasoning: "none" }));
    assert.deepEqual(off.thinking, { type: "disabled" });
    const low = buildRequestBody(DS, req({ reasoning: "low" }));
    assert.equal(low.reasoning_effort, "low");
    assert.equal(low.thinking, undefined);
  });

  it("OpenRouter:none → reasoning.enabled=false;档位 → reasoning.effort", () => {
    const off = buildRequestBody(OR, req({ reasoning: "none" }));
    assert.deepEqual(off.reasoning, { enabled: false });
    const high = buildRequestBody(OR, req({ reasoning: "high" }));
    assert.deepEqual(high.reasoning, { effort: "high" });
  });

  it("硅基流动:none → enable_thinking=false;档位翻译成 thinking_budget", () => {
    const SF = LLM_MODELS["qwen"];
    const off = buildRequestBody(SF, req({ reasoning: "none" }));
    assert.equal(off.enable_thinking, false);
    assert.equal("thinking_budget" in off, false);
    const med = buildRequestBody(SF, req({ reasoning: "medium" }));
    assert.equal(med.enable_thinking, true);
    assert.equal(med.thinking_budget, 4096);
    assert.equal(med.model, "Qwen/Qwen3.5-122B-A10B");
  });

  it("省略 reasoning 时不带任何推理参数(走模型默认)", () => {
    const b = buildRequestBody(DS, req());
    assert.equal("thinking" in b, false);
    assert.equal("reasoning_effort" in b, false);
  });

  it("发给供应商的是真实模型名而非逻辑名", () => {
    assert.equal(buildRequestBody(OR, req()).model, "anthropic/claude-sonnet-5");
  });

  it("maxTokens 超过网关上限被封顶", () => {
    const b = buildRequestBody(DS, req({ maxTokens: 999_999 }));
    assert.equal(b.max_tokens, LLM_MAX_TOKENS_CAP);
  });
});
