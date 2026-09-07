// 向量库抽象层 + Memory 实现
//
// 这是阶段 15 最关键的工程设计——"可插拔向量库"。
// 业务代码（rag.ts、API 路由）只依赖 VectorStore 接口，不直接碰具体实现。
// 当前用 MemoryVectorStore（内存单例），以后换 Chroma/FAISS 只改这一个文件。
//
// 为什么用抽象层（不是直接用 MemoryVectorStore）：
// 1. 解耦：业务代码不绑死具体向量库，换实现时业务逻辑不动
// 2. 简历价值：能讲"设计了可插拔抽象层，对比过 Memory/Chroma/FAISS"
// 3. 测试友好：mock 接口比 mock 具体类容易
//
// 向量库选型对比（详见 15.RAG知识库.md）：
// - MemoryVectorStore：纯内存，重启重嵌入。零依赖，换机无痛。当前选用。
// - Chroma：Docker 持久化。生产可用，但要 Docker 环境。
// - FAISS：本地文件持久化。Windows 上 node-gyp 编译坑大。
//
// 数据隔离：用 kbId（知识库 id）作为命名空间，不同知识库的向量互不干扰。
// MemoryVectorStore 本身不支持命名空间，这里用一个 Map<kbId, store> 模拟。

import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import { embeddings } from "./langchain";

// === 抽象接口 ===
// 任何向量库实现都要提供这两个方法。业务代码只认这个接口。
export interface VectorStore {
  // 把一批文本块加入指定知识库（每个块带元数据，方便溯源）
  addDocuments(kbId: string, chunks: string[], meta: Record<string, unknown>): Promise<void>;
  // 在指定知识库里检索和 query 最相似的 top-k 个块，返回内容字符串数组
  similaritySearch(kbId: string, query: string, k: number): Promise<string[]>;
  // 删除整个知识库的向量（删知识库时调）
  delete(kbId: string): Promise<void>;
}

// === Memory 实现 ===
// 用 Map<kbId, MemoryVectorStore> 给每个知识库一个独立的内存向量空间
// （MemoryVectorStore 本身不带命名空间，靠外层 Map 隔离）
const stores = new Map<string, MemoryVectorStore>();

class MemoryStore implements VectorStore {
  async addDocuments(kbId: string, chunks: string[], meta: Record<string, unknown>): Promise<void> {
    let store = stores.get(kbId);
    if (!store) {
      store = await MemoryVectorStore.fromExistingIndex(embeddings);
      stores.set(kbId, store);
    }
    // 把每个文本块包装成 Document（带元数据），加进 store
    const docs = chunks.map(
      (text) =>
        new Document({
          pageContent: text,
          metadata: { ...meta },
        }),
    );
    await store.addDocuments(docs);
  }

  async similaritySearch(kbId: string, query: string, k: number): Promise<string[]> {
    const store = stores.get(kbId);
    if (!store) {
      // 这个知识库还没索引过任何文档，返回空
      return [];
    }
    const docs = await store.similaritySearch(query, k);
    return docs.map((d) => d.pageContent);
  }

  async delete(kbId: string): Promise<void> {
    stores.delete(kbId);
  }
}

// === 单例导出 ===
// 业务代码 import { vectorStore } from "@/lib/vectorstore"，调 vectorStore.addDocuments(...)
// 以后换 Chroma：把这里改成 `new ChromaStore()`，其它代码零改动
export const vectorStore: VectorStore = new MemoryStore();
