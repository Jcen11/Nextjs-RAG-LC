// 向量库抽象层：Memory 实现 + Chroma 实现（阶段 18 新增）
//
// 这是阶段 15 最关键的工程设计——"可插拔向量库"。
// 业务代码（rag.ts、API 路由）只依赖 VectorStore 接口，不直接碰具体实现。
// 阶段 18 兑现了这个设计的价值：加 Chroma 实现时，业务代码零改动。
//
// 为什么用抽象层（不是直接用 MemoryVectorStore）：
// 1. 解耦：业务代码不绑死具体向量库，换实现时业务逻辑不动
// 2. 简历价值：能讲"设计了可插拔抽象层，对比过 Memory/Chroma/FAISS"
// 3. 测试友好：mock 接口比 mock 具体类容易
//
// 向量库选型对比（详见 15.RAG知识库.md）：
// - MemoryVectorStore：纯内存，重启重嵌入。零依赖，换机无痛。本地开发默认。
// - Chroma：持久化向量数据库。自托管 Docker 或 Chroma Cloud，生产可用。
// - FAISS：本地文件持久化。Windows 上 node-gyp 编译坑大。
//
// 阶段 18 实现选择（在文件底部）：
// - 配了 CHROMA_URL（自托管）或 CHROMA_CLOUD_API_KEY（Chroma Cloud）→ Chroma
// - 都没配 → Memory（行为同阶段 15-17，本地跑零依赖）

import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { ChromaClient, CloudClient } from "chromadb";
import { Document } from "@langchain/core/documents";
import { embeddings } from "./langchain";

// === 抽象接口 ===
// 任何向量库实现都要提供这三个方法。业务代码只认这个接口。
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

// === Chroma 实现（阶段 18 新增）===
//
// 两种连法（由环境变量决定，见 getChromaConfig）：
// 1. 自托管（Docker）：CHROMA_URL=http://localhost:8000（或云服务器地址）
// 2. Chroma Cloud（托管）：CHROMA_CLOUD_API_KEY + CHROMA_TENANT + CHROMA_DATABASE
//    （控制台创建后给这三个值），不用自己装 Docker 跑服务
//
// 数据隔离：Chroma 用 collection（集合）隔离数据。
// 每个知识库一个 collection，名字用 kb_<kbId>（kbId 是 uuid，
// 满足 Chroma 的命名要求：3-63 位、字母数字和下划线/点/横线）。

// bge-m3 嵌入模型的维度（Chroma Cloud 建集合时必须指定维度，自托管也会校验）
const CHROMA_DIMENSION = 1024;

type ChromaConfig = {
  url?: string;
  apiKey?: string;
  tenant?: string;
  database?: string;
};

function getChromaConfig(): ChromaConfig {
  return {
    url: process.env.CHROMA_URL,
    apiKey: process.env.CHROMA_CLOUD_API_KEY,
    tenant: process.env.CHROMA_TENANT,
    database: process.env.CHROMA_DATABASE,
  };
}

function collectionNameFor(kbId: string): string {
  return `kb_${kbId}`;
}

class ChromaStore implements VectorStore {
  // 底层 chromadb 客户端（懒创建，进程内复用：连接配置不变，无需每次新建）
  private client: ChromaClient | null = null;

  // LangChain 包装器按 kb 缓存（它内部持有 collection 句柄，复用省一次 HTTP 查询）
  private wrappers = new Map<string, Chroma>();

  private getClient(): ChromaClient {
    if (this.client) {
      return this.client;
    }
    const config = getChromaConfig();

    if (config.apiKey) {
      // Chroma Cloud：CloudClient 自动带认证头；tenant/database 从控制台拿
      this.client = new CloudClient({
        apiKey: config.apiKey,
        tenant: config.tenant,
        database: config.database,
      });
    } else {
      // 自托管：解析 CHROMA_URL（如 http://localhost:8000 或 https://服务器:8000）
      const parsed = new URL(config.url || "http://localhost:8000");
      this.client = new ChromaClient({
        host: parsed.hostname,
        port: parsed.port
          ? Number(parsed.port)
          : parsed.protocol === "https:" ? 443 : 8000,
        ssl: parsed.protocol === "https:",
      });
    }
    return this.client;
  }

  private getWrapper(kbId: string): Chroma {
    let wrapper = this.wrappers.get(kbId);
    if (!wrapper) {
      // 传 index（我们自己的客户端）而不是 url：这样 Cloud/自托管共用一条构造路径，
      // 且 delete 时能拿到同一个 client 调 deleteCollection
      wrapper = new Chroma(embeddings, {
        index: this.getClient(),
        collectionName: collectionNameFor(kbId),
        // dimension：Cloud 建集合时必须显式给维度；cosine 适合语义相似度
        collectionMetadata: { dimension: CHROMA_DIMENSION, "hnsw:space": "cosine" },
      });
      this.wrappers.set(kbId, wrapper);
    }
    return wrapper;
  }

  async addDocuments(kbId: string, chunks: string[], meta: Record<string, unknown>): Promise<void> {
    const docs = chunks.map(
      (text) =>
        new Document({
          pageContent: text,
          metadata: { ...meta },
        }),
    );
    await this.getWrapper(kbId).addDocuments(docs);
  }

  async similaritySearch(kbId: string, query: string, k: number): Promise<string[]> {
    try {
      const docs = await this.getWrapper(kbId).similaritySearch(query, k);
      return docs.map((d) => d.pageContent);
    } catch {
      // 集合不存在（如换环境后 SQLite 有 kb 元数据但 Chroma 里没有集合）→ 当空处理。
      // 上层 rag.retrieveContext 拿到空也会返回 null，chat 路由会降级成普通对话。
      return [];
    }
  }

  async delete(kbId: string): Promise<void> {
    // 先清本地缓存的包装器，再删服务端集合
    this.wrappers.delete(kbId);
    try {
      await this.getClient().deleteCollection({ name: collectionNameFor(kbId) });
    } catch {
      // 集合不存在时删除会报错，忽略即可（删知识库是幂等操作）
    }
  }
}

// === 实现选择（阶段 18）===
// CHROMA_URL（自托管）或 CHROMA_CLOUD_API_KEY（Chroma Cloud）任一存在 → Chroma
// 都没配 → Memory（本地零依赖，行为同阶段 15-17）
const useChroma = Boolean(process.env.CHROMA_URL || process.env.CHROMA_CLOUD_API_KEY);

export const vectorStore: VectorStore = useChroma ? new ChromaStore() : new MemoryStore();
