// OpenAI 兼容 chat/completions 的协议层:类型与响应解析。
// 只处理「报文长什么样」;调谁、怎么限流、怎么记账是 llm-gateway.ts 的事。

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatResult = {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    /** 推理型模型的思考部分,计费上含在 completionTokens 里 */
    reasoningTokens: number;
  };
};

/**
 * 解析 OpenAI 兼容响应。单独导出以便测试。
 *
 * 防御性检查 body.error:OpenAI 兼容生态里存在 HTTP 200 携带业务错误的实现,
 * 只看状态码会把错误消息当成模型回答。
 */
export function parseChatCompletion(body: unknown): ChatResult {
  const b = body as {
    error?: { message?: string; code?: number | string };
    model?: string;
    choices?: Array<{
      message?: { content?: unknown };
      finish_reason?: string;
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  } | null;
  if (!b || typeof b !== "object") {
    throw new Error("LLM 响应不是 JSON 对象");
  }
  if (b.error) {
    throw new Error(`LLM 业务错误: ${b.error.code ?? ""} ${b.error.message ?? ""}`);
  }
  const content = b.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    // deepseek-v4-flash 是推理模型:max_tokens 同时约束推理与正文,预算给小了
    // 会被推理全部吃掉,正文为空——这是实际踩过的坑,报错必须指向病因
    if (b.choices?.[0]?.finish_reason === "length") {
      throw new Error(
        "LLM 输出被 max_tokens 截断(推理型模型的思考过程也计入预算),需增大 maxTokens",
      );
    }
    throw new Error("LLM 响应缺少 choices[0].message.content");
  }
  return {
    content,
    model: b.model ?? "",
    usage: {
      promptTokens: b.usage?.prompt_tokens ?? 0,
      completionTokens: b.usage?.completion_tokens ?? 0,
      reasoningTokens:
        b.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    },
  };
}
