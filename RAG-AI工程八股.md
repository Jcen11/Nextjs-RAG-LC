# RAG / AI 工程面试八股

> 对应项目：Nextjs-RAG-LC（阶段 15/16）
> 配套文档：`15.RAG知识库.md`、`16.路线B重构.md`
> 对应代码：`lib/rag.ts`、`lib/vectorstore.ts`、`lib/langchain.ts`、`app/api/knowledge/*`、`app/api/chat/route.ts`
>
> 这份是 AI 工程岗的核心八股。投 AI 应用开发 / LLM 工程方向，这份是重点。

---

## 一、RAG 基础概念

### 【概念⭐】什么是 RAG？解决了什么问题？
RAG（Retrieval-Augmented Generation，检索增强生成）= 检索 + 生成。先从知识库检索相关文档，再把检索结果塞进 prompt，让 LLM 基于这些内容回答。

解决的问题：
1. **LLM 知识截止**——训练数据有截止日期，不知道新信息
2. **领域知识缺失**——LLM 不懂你的私有文档（公司资料、个人笔记）
3. **幻觉**——不给依据，LLM 会编造；给了检索内容，回答有据可依

**项目举例**：用户上传 knowledge.txt，提问"RAG 为什么要切块"，系统检索到讲这个的段落，拼进 prompt，AI 基于段落回答。

---

### 【概念⭐⭐】RAG 的完整流程是什么？
```
离线阶段（索引）：
  文档 → 切块（chunk）→ 嵌入（embedding）→ 存入向量库

在线阶段（检索 + 生成）：
  用户提问 → 嵌入提问 → 向量库检索 top-k 相关块 → 拼进 prompt → LLM 生成回答
```

**项目对应**：
- 离线：`lib/rag.ts` 的 `indexDocument`（splitText + vectorStore.addDocuments）
- 在线：`lib/rag.ts` 的 `retrieveContext` + `app/api/chat/route.ts` 的 RAG 前置

---

### 【概念⭐⭐】为什么要把文档切块（chunk）？不切整篇塞给 LLM 不行吗？
两个原因：
1. **上下文窗口有限**——LLM 的 context window 有限（几K~几十K token），整篇长文档塞不进去
2. **检索精度**——用户问"RAG 为什么要切块"，我们只想找出讲这个的那一段，不是把整篇都塞给 LLM。切块让检索能精准定位

---

### 【追问⭐⭐】chunkSize 太大或太小各有什么问题？
- **太小**：上下文丢失（一句话被切断，检索到的块信息不全）
- **太大**：检索不精准（一个块里混了多个主题，检索到但相关性稀释）；且浪费 token

**项目举例**：默认 chunkSize=500（中英文混合适用）。langChain-demo 用 100 太小（只适合小 demo）。

---

### 【追问⭐⭐】chunkOverlap（重叠）是干嘛的？不设会怎样？
相邻块的重叠部分。避免关键信息被切到两块各一半——比如一句话刚好在切分边界，重叠能让它在两个块里都完整出现。一般是 chunkSize 的 10-20%。

**项目举例**：chunkSize=500，overlap=50（10%）。

---

### 【概念⭐⭐】什么是嵌入（embedding）？为什么需要它？
把文本转成高维浮点向量（比如 bge-m3 是 1024 维）。语义相近的文本，向量在空间里也相近。这样就能用数学方法（余弦相似度）衡量"两段文本有多相关"。

```
"RAG 为什么要切块" → [0.12, -0.34, ..., 0.56]（1024 个数）
"文档切分的原理"   → [0.11, -0.32, ..., 0.55]（和上面很接近）
"今天天气真好"     → [0.88, 0.21, ..., -0.43]（和上面差很远）
```

---

### 【追问⭐⭐⭐】为什么用余弦相似度不用欧氏距离？
余弦相似度衡量**方向**（两向量夹角），欧氏距离衡量**绝对距离**。文本向量关注的是"语义方向是否一致"，文本长短（向量模长）不该影响相似度判断。所以用余弦。

---

### 【概念⭐】你用的嵌入模型是什么？为什么选它？
`BAAI/bge-m3`（硅基流动提供）。理由：
- 中文效果好（bge 系列对中文优化）
- 多语言（m3 = multilingual）
- 通过 OpenAI 兼容 API 调用，接入简单

不用 OpenAI 的 ada-002 因为中文效果不如 bge，且硅基流动更便宜。

---

## 二、向量库 / 检索

### 【决策⭐⭐⭐】（杀手锏题）你的向量库选型怎么做的？对比了哪些方案？
**讲三方案对比**（`15.RAG知识库.md`）：
| | MemoryVectorStore | Chroma | FAISS |
|---|---|---|---|
| 存储 | 内存 | Docker 文件 | 本地文件 |
| 持久化 | ❌ 重启重嵌入 | ✅ | ✅ |
| 依赖 | 零 | Docker | node-gyp 编译 |
| Windows | 无坑 | WSL2/权限 | **编译坑大**（better-sqlite3 栽过） |

**决策**：学习项目 + 要换电脑 + 文档量小，选 Memory。设计了抽象层以便未来切换 Chroma。

---

### 【决策⭐⭐⭐】为什么设计向量库抽象层？怎么实现的？
为了解耦——业务代码只依赖接口，不绑死具体向量库。换实现时业务逻辑不动。

```ts
// lib/vectorstore.ts
export interface VectorStore {
  addDocuments(kbId, chunks, meta): Promise<void>;
  similaritySearch(kbId, query, k): Promise<string[]>;
  delete(kbId): Promise<void>;
}

class MemoryStore implements VectorStore { ... }
// 以后：class ChromaStore implements VectorStore { ... }
```

**简历价值**：能讲"设计了可插拔抽象层，对比过三种方案，当前 Memory 实现，规划 Chroma 部署"。

---

### 【追问⭐⭐】不同知识库的向量怎么隔离的？
用 `kbId` 作为命名空间。`Map<kbId, MemoryVectorStore>` 给每个知识库独立的内存向量空间。检索时只在该 kbId 的空间里搜，不会搜到别的库的内容。

---

### 【追问⭐⭐⭐】如果文档量到 10 万篇，你的 RAG 怎么优化？
当前 MemoryVectorStore 不行了（内存爆 + 全量扫描慢）。优化方向：
1. **换持久化向量库**（Chroma/FAISS/Milvus）——支持 ANN（近似最近邻）索引，检索从 O(n) 降到 O(log n)
2. **嵌入只做一次**——文档入库时嵌入并持久化，不重复嵌入
3. **分布式**——向量库集群分片
4. **重排序（rerank）**——先检索 top-50，再用 cross-encoder 重排取 top-3，精度更高
5. **混合检索**——向量检索 + 关键词检索（BM25）结合

---

### 【追问⭐⭐】top-k 取几？怎么定？
当前 k=3。权衡：
- k 太大：塞太多无关内容，稀释重点，浪费 token
- k 太小：可能漏掉相关信息

实际要 A/B 测试。一般 3-5 是常见起点。复杂场景可以"检索 top-10，rerank 后取 top-3"。

---

## 三、LangChain / 工程实践

### 【概念⭐】LangChain 是什么？核心抽象有哪些？
LLM 应用开发框架。核心抽象：
- **ChatModel**（ChatOpenAI）：对话模型，支持 stream
- **Embeddings**（OpenAIEmbeddings）：文本向量化
- **TextSplitter**（RecursiveCharacterTextSplitter）：文档切块
- **VectorStore**：向量库（Memory/Chroma/FAISS）
- **Retriever**：检索器（vectorStore.asRetriever(k)）
- **Message**（HumanMessage/AIMessage/SystemMessage）：消息类型

**项目对应**：用了 ChatModel、Embeddings、TextSplitter、VectorStore。

---

### 【决策⭐⭐⭐】（路线 A vs B）为什么你做了两个版本（裸 fetch 和 ChatOpenAI）？
为了**对比学习**和**简历价值**：
- 裸 fetch 版（Nextjs-RAG）：理解 SSE 协议底层，可控性强，但手写解析繁琐
- ChatOpenAI 版（Nextjs-RAG-LC）：用 LangChain 统一抽象，代码简洁，和 RAG 风格一致

两个版本对照，能讲清"我理解了底层，也判断了什么时候该用抽象"。详见 `16.路线B重构.md`。

---

### 【决策⭐⭐⭐】RAG 和 chat 是怎么结合的？RAG 接管了 chat 吗？
**没有接管**。RAG 只是 chat 的"前置步骤"——在调 LLM 前，检索相关片段拼进 system message。LLM 调用逻辑（流式/中断/错误处理）一行不改。

```
用户提问 → 如果绑了知识库 → 检索 top3 片段 → 拼进 system message → 照常调 LLM 流式回复
```

这样保留了阶段 10/11 的健壮性，RAG 是旁路新增。详见 `15.RAG知识库.md`。

---

### 【追问⭐⭐】你的 RAG 是每轮重新检索吗？为什么？
是的。用户每发一条消息，都用最新提问检索一次。因为不同问题对应不同文档片段，不能复用上一轮的检索结果。

---

### 【追问⭐⭐⭐】RAG 的检索结果怎么注入 prompt 的？为什么放 system 不放 user？
拼成"以下是相关知识:\n片段1:...\n片段2:..."，作为 system message 插到消息列表前面。

放 system 而不是 user 的原因：
- system 是"指令/背景"，user 是"用户说的话"。检索到的知识是背景信息，语义上属于 system
- LLM 对 system message 的遵循度更高（更倾向于基于它回答）

---

### 【概念⭐⭐】什么是 MemoryVectorStore 的局限？生产怎么办？
- 纯内存，重启进程就丢，要重新嵌入（慢）
- 不支持持久化，没法部署到 serverless（Vercel）
- 全量扫描检索（O(n)），文档多了慢

生产方案：Chroma/FAISS/Milvus/Pinecone，支持持久化 + ANN 索引。

---

## 四、AI 工程进阶

### 【追问⭐⭐⭐】什么是幻觉（hallucination）？RAG 怎么缓解？
幻觉 = LLM 编造不存在的信息。RAG 缓解方式：
1. 给 LLM 检索到的真实文档作为依据
2. prompt 里加约束："只基于以下知识回答，不知道就说不知道"
3. 让 LLM 输出引用来源（溯源）

**项目规划**：检索结果溯源展示（`待学与待办.md` 改进点 3）。

---

### 【追问⭐⭐⭐】什么是 rerank？为什么要做？
rerank = 检索后重排序。向量检索快但粗（bi-encoder），先用它取 top-50；再用 cross-encoder 对这 50 个精细打分重排，取 top-3。精度比纯向量检索高很多。

适合对答案质量要求高的场景。

---

### 【追问⭐⭐】chunkSize、overlap、top-k 这些参数怎么调？
没有标准答案，要 A/B 测试：
- 准备一组问答对（标注好正确答案）
- 调整参数，看检索命中率（recall@k）和回答质量
- 选综合最优的

经验值：chunkSize 300-1000，overlap 10-20%，top-k 3-5。

---

### 【追问⭐⭐⭐】如果检索不到相关内容（用户问的知识库里没有），怎么处理？
当前：还是把空上下文塞给 LLM，LLM 用自己知识回答（可能幻觉）。
改进：
- 检索结果为空时，prompt 明确说"知识库无相关内容，请回答不知道"
- 或设置相似度阈值，低于阈值的检索结果不注入（避免注入噪声）

---

### 【追问⭐⭐】你的项目支持哪些文档格式？怎么扩展？
当前只支持纯文本（.txt/.md，用 `file.text()` 读）。扩展：引入 LangChain 的 PDFLoader/DocxLoader，在上传接口根据文件类型选 loader。这是 `待学与待办.md` 改进点 2。

---

## 五、和裸 fetch 对比（路线 B 重构）

### 【决策⭐⭐⭐】ChatOpenAI 替代裸 fetch 后，中断处理有什么变化？
| | 裸 fetch | ChatOpenAI |
|---|---|---|
| 中断方式 | AbortController + fetch signal + reader.cancel | `{ signal }` 传给 model.stream |
| 复杂度 | 五环链路，手动管 | LangChain 内部处理 |
| 可控性 | 高（每环可控） | 中（依赖 LangChain 实现） |

详见 `16.路线B重构.md` 第三节"中断处理"对比。

---

### 【追问⭐⭐】用 ChatOpenAI 后，你阶段 10/11 的错误处理还在吗？
在。重写时保留了：超时控制、客户端中断联动、错误状态码（502/504）。只是把"裸 fetch 的 SSE 解析"换成了"model.stream 的 async iterable 遍历"，错误处理逻辑适配了新的异常类型。详见 `16.路线B重构.md` 第四节。

---

## 速查（一页纸）

```
RAG = 检索 + 生成，解决 LLM 知识截止/幻觉
流程：文档→切块→嵌入→向量库；提问→嵌入→检索topk→拼prompt→生成

切块原因：上下文窗口有限 + 检索精度
chunkSize：太小丢上下文，太大不精准（500 经验值）
overlap：避免切断关键信息（10-20%）

嵌入：文本→高维向量，语义相近=向量相近
相似度：用余弦（方向）不用欧氏（距离）
bge-m3：中文好、多语言、OpenAI兼容

向量库：Memory(内存)/Chroma(Docker)/FAISS(编译)
选型：学习项目选 Memory + 抽象层
抽象层：接口隔离，换实现不改业务代码
隔离：kbId 命名空间

LangChain：ChatModel/Embeddings/Splitter/VectorStore/Retriever
RAG不接管chat：只是前置检索，拼进system message
注入system：背景信息语义，LLM遵循度高

幻觉：LLM编造，RAG给依据缓解
rerank：粗检索top50→精排top3
参数调优：A/B测试，看recall@k
```
