// LangChain 模型工厂（嵌入模型）
//
// 这里只创建 embeddings（嵌入模型），不创建 ChatOpenAI。
// 设计原则：RAG 阶段只让 LangChain 负责"嵌入 + 检索"，chat 还是用裸 fetch SSE
// （阶段 4-11 打磨的流式/中断/错误处理零改动）。
// ChatOpenAI 的引入留给路线 B（阶段 16+）。
//
// 为什么用单例（globalThis.embeddings）：
// OpenAIEmbeddings 是无状态的（只是配置：apiKey/baseURL/model），创建一次即可。
// 挂到 global 避免热重载时重复创建（和 db.ts 一个道理）。
//
// 配置复用现有 env（和 chat 共用一套硅基流动账号）：
// - OPENAI_BASE_URL / SILICONFLOW_API_KEY：和 chat 一样（硅基流动 OpenAI 兼容）
// - OPENAI_EMBEDDING_MODEL：嵌入模型，独立于聊天模型（RAG 用，默认 bge-m3）

import { OpenAIEmbeddings } from "@langchain/openai";

const apiKey = process.env.SILICONFLOW_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL || "https://api.siliconflow.cn/v1";
const embeddingModel =
  process.env.OPENAI_EMBEDDING_MODEL || "BAAI/bge-m3";

const globalForEmbeddings = globalThis as unknown as {
  embeddings: OpenAIEmbeddings | undefined;
};

export const embeddings =
  globalForEmbeddings.embeddings ??
  new OpenAIEmbeddings({
    model: embeddingModel,
    apiKey,
    configuration: { baseURL },
  });

if (process.env.NODE_ENV !== "production") {
  globalForEmbeddings.embeddings = embeddings;
}
