// LangChain 模型工厂（聊天模型 + 嵌入模型）
//
// 阶段 16（路线 B 重构）：新增 ChatOpenAI 工厂，替代 chat 路由里的裸 fetch SSE。
// 现在 chat 调用走 LangChain 的统一抽象，RAG（embeddings）继续用本文件的 embeddings。
// 详见 16.路线B重构.md。
//
// 为什么用单例（globalThis）：
// ChatOpenAI 和 OpenAIEmbeddings 都是无状态的（只是配置对象），创建一次即可。
// 挂到 global 避免热重载时重复创建（和 db.ts 一个道理）。
//
// 配置复用现有 env（聊天和嵌入共用一套硅基流动账号）：
// - OPENAI_BASE_URL / SILICONFLOW_API_KEY：硅基流动 OpenAI 兼容
// - OPENAI_MODEL：聊天模型（默认 Qwen/Qwen3-8B）
// - OPENAI_EMBEDDING_MODEL：嵌入模型（默认 bge-m3，RAG 用）

import { ChatOpenAI } from "@langchain/openai";
import { OpenAIEmbeddings } from "@langchain/openai";

const apiKey = process.env.SILICONFLOW_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL || "https://api.siliconflow.cn/v1";
const chatModel = process.env.OPENAI_MODEL || "Qwen/Qwen3-8B";
const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || "BAAI/bge-m3";

const globalForModels = globalThis as unknown as {
  chatModel: ChatOpenAI | undefined;
  embeddings: OpenAIEmbeddings | undefined;
};

// 聊天模型：用于 chat 路由的流式回复（阶段 16 替代裸 fetch）
// streaming: true 让 model.stream() 返回逐 token 的流
export const model =
  globalForModels.chatModel ??
  new ChatOpenAI({
    model: chatModel,
    apiKey,
    configuration: { baseURL },
    streaming: true,
  });

// 嵌入模型：用于 RAG 的文档/查询向量化（阶段 15 起）
export const embeddings =
  globalForModels.embeddings ??
  new OpenAIEmbeddings({
    model: embeddingModel,
    apiKey,
    configuration: { baseURL },
  });

if (process.env.NODE_ENV !== "production") {
  globalForModels.chatModel = model;
  globalForModels.embeddings = embeddings;
}
