// RAG 业务逻辑（切块 + 索引 + 检索 + 格式化）
//
// 这一层把"文档→可用上下文"的流程封装成几个函数，API 路由调它们。
// 核心三步：
//   1. splitText：把长文档切成小块（chunk），适合嵌入和检索
//   2. indexDocument：切块 + 嵌入 + 存进向量库
//   3. retrieveContext：用户提问 → 检索相关块 → 拼成 prompt 用的上下文字符串
//
// 为什么要把文档切块（chunk）：
// LLM 的上下文窗口有限（几K到几十K token），整篇文档塞不进去。
// 更重要的是检索精度——用户问"RAG 为什么要切块"，我们只想找出讲这个的那一段，
// 不是把整篇文档都塞给 LLM。切块让"检索"能精准定位到相关片段。
//
// chunkSize/overlap 怎么定：
// - chunkSize：每块多大。太小丢上下文（一句话被切断），太大检索不精准。
//   这里默认 500 字符（中英文混合适用），langChain-demo 用的 100 太小（只适合 demo）。
// - chunkOverlap：相邻块的重叠量。避免关键信息被切到两块各一半。
//   一般是 chunkSize 的 10-20%，这里用 50。

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { vectorStore } from "./vectorstore";

// 默认切块参数（API 路由可以覆盖）
const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_CHUNK_OVERLAP = 50;
const DEFAULT_TOP_K = 3;

// === 切块 ===
// 用 RecursiveCharacterTextSplitter：递归地按 段落>换行>句号>空格 的优先级切
// 它会尽量在自然边界（段落、句子）切，避免把一句话切成两半
export async function splitText(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  chunkOverlap = DEFAULT_CHUNK_OVERLAP,
): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
  });
  return await splitter.splitText(text);
}

// === 索引文档 ===
// 把一篇文档切块 + 嵌入 + 存进指定知识库的向量空间
// 返回切成的块数（API 路由存进 SQLite 当元数据）
export async function indexDocument(
  kbId: string,
  text: string,
  meta: { documentId: string; filename: string },
  options?: { chunkSize?: number; chunkOverlap?: number },
): Promise<number> {
  const chunks = await splitText(
    text,
    options?.chunkSize,
    options?.chunkOverlap,
  );
  await vectorStore.addDocuments(kbId, chunks, meta);
  return chunks.length;
}

// === 检索 + 格式化上下文 ===
// 用户提问 → 在指定知识库检索 top-k 相关块 → 拼成 system prompt 用的上下文
// 返回 null 表示没检索到东西（调用方决定要不要加 RAG 上下文）
export async function retrieveContext(
  kbId: string,
  query: string,
  k = DEFAULT_TOP_K,
): Promise<string | null> {
  const chunks = await vectorStore.similaritySearch(kbId, query, k);

  if (chunks.length === 0) {
    return null;
  }

  // 把检索到的块拼成结构化文本，让 LLM 知道这是"参考资料"
  // 编号（片段1/片段2）方便 LLM 引用，也方便调试看检索到了什么
  const formatted = chunks
    .map((chunk, i) => `片段${i + 1}：\n${chunk}`)
    .join("\n\n");

  return formatted;
}

// === 拼 RAG system 提示词 ===
// 把检索到的上下文包装成完整的 system 指令，告诉 LLM "基于这些资料回答"
// chat 路由调这个，拿到拼好的 system 字符串，照常走流式转发
export function buildRagSystemPrompt(context: string, basePrompt?: string): string {
  const parts: string[] = [];

  if (basePrompt && basePrompt.trim()) {
    parts.push(basePrompt.trim());
  }

  parts.push("你是一个知识库问答助手。请基于以下检索到的知识库内容回答用户问题。");
  parts.push("如果知识库内容不足以回答，请明确说明，不要编造。");
  parts.push("\n【知识库内容】");
  parts.push(context);

  return parts.join("\n");
}
