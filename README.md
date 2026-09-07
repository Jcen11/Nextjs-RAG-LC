# AI 知识库助手（Nextjs-RAG-LC）

一个基于 Next.js + LangChain + RAG 的全栈 AI 聊天与文档问答应用。从"最简 Next.js 页面"逐步演化到集成流式对话、多会话管理、文档知识库的完整产品，共经历 17 个阶段。

> 这是个人学习项目，目标是形成一个可写进简历的完整全栈 AI 项目。每个阶段都有配套文档记录设计决策和踩坑过程。

---

## 一、应用场景

**一个能"读你的文档"来回答问题的 AI 助手**：

1. **创建知识库** → 上传文档（txt/md，未来支持 PDF）
2. **绑定到会话** → 在侧边栏选哪个知识库参与问答
3. **提问** → 系统检索文档相关片段，拼进 prompt，AI 基于文档回答
4. **多会话管理** → 每个对话独立持久化，刷新不丢，侧边栏切换

典型用途：个人笔记问答、团队知识库、学习资料助手、客服 FAQ。

---

## 二、技术栈

### 前端
| 技术 | 版本 | 用途 |
|---|---|---|
| **Next.js** | 15.4.6 (App Router) | 全栈框架，路由 + SSR |
| **React** | 19.1.0 | UI 库 |
| **TypeScript** | 5.8.3 | 类型安全 |
| **Tailwind CSS** | v4 | 原子化 CSS（阶段 17 引入） |
| **shadcn/ui** | — | 组件库（Button/Input/Dialog/ScrollArea 等，源码归项目） |
| **Zustand** | 5.0.14 | 全局状态管理 |
| **react-markdown** | v10 | AI 回复的 Markdown 渲染 |
| **react-syntax-highlighter** | v16 | 代码块高亮 |

### AI / RAG
| 技术 | 用途 |
|---|---|
| **LangChain.js** v1 | AI 应用框架（ChatOpenAI、Embeddings、TextSplitter、VectorStore） |
| **ChatOpenAI** | 对话模型调用（阶段 16 替代了裸 fetch SSE） |
| **OpenAIEmbeddings** | 文档/查询向量化（bge-m3 模型） |
| **RecursiveCharacterTextSplitter** | 文档切块 |
| **MemoryVectorStore** | 向量检索（内存实现，可插拔抽象层，未来换 Chroma） |

### 数据层
| 技术 | 用途 |
|---|---|
| **SQLite**（node:sqlite） | 会话/消息/知识库元数据持久化 |
| **原生 SQL** | 直接用 prepared statements（不用 ORM） |

### LLM 提供商
- **硅基流动（SiliconFlow）**——OpenAI 兼容 API
- 对话模型：Qwen/Qwen3-8B
- 嵌入模型：BAAI/bge-m3

---

## 三、系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      浏览器（客户端）                         │
│                                                              │
│   Zustand store（组件外的全局状态中心）                       │
│   currentId / messages / conversations / kbId / loading ...  │
│         ↑ 订阅 + 调 action                                    │
│                                                              │
│   ┌──────────┐  ┌─────────────────────┐                     │
│   │ Sidebar  │  │ ChatBox             │  shadcn/ui 组件      │
│   │ 会话列表  │  │ 消息+发送+流式+RAG   │  (Tailwind 样式)     │
│   │ 切换/重命名│  │ Markdown 渲染       │                     │
│   └────┬─────┘  └─────────┬───────────┘                     │
│        │ fetch             │ fetch (流式)                     │
└────────┼───────────────────┼─────────────────────────────────┘
─────────┼───────────────────┼─── HTTP ────────────────────────
         ↓                   ↓
┌─────────────────────────────────────────────────────────────┐
│                   Next.js 服务端                             │
│                                                              │
│   路由层 (app/)                                              │
│   layout.tsx (全屏 flex + header)                            │
│   chat/layout.tsx (Sidebar + 内容区)                         │
│   chat/page.tsx + chat/[id]/page.tsx (URL→store 同步)         │
│                                                              │
│   API 层 (app/api/)                                          │
│   /api/chat        POST  对话（ChatOpenAI 流式 + RAG 前置）   │
│   /api/conversations  GET/POST   会话增查                    │
│   /api/conversations/[id]  GET/DELETE/PATCH  会话详情/删/改名 │
│   /api/messages    POST  保存一轮对话                        │
│   /api/knowledge   GET/POST   知识库增查                     │
│   /api/knowledge/[id]  GET/DELETE  知识库详情/删             │
│   /api/knowledge/[id]/documents  POST  上传文档(切块+嵌入)   │
│                                                              │
│   业务逻辑层 (lib/)                                          │
│   langchain.ts   ChatOpenAI + Embeddings 工厂(单例)          │
│   rag.ts         切块/索引/检索/格式化                       │
│   vectorstore.ts 向量库抽象层(Memory 实现,可插拔)            │
│   store.ts       Zustand 全局状态                            │
│   queries.ts     SQLite CRUD (prepared statements)          │
│   db.ts          SQLite 连接(单例) + 建表 + 事务             │
│                                                              │
│   chat.db (SQLite 文件)                                      │
└─────────────────────────────────────────────────────────────┘
```

### 架构特点

1. **全局状态管理（Zustand）**：跨组件、跨路由重建共享的状态放在组件外的 store，根治"组件卸载重建丢 state"的竞态 bug（详见 `12b` 五轮 debug）
2. **URL → store 单向同步**：URL 保留可分享的会话 id，SyncConversationId 把它写进 store；setCurrentId 的幂等写法为未来反向同步预留
3. **RAG 不接管 chat**：RAG 只是 chat 的"前置步骤"（检索 + 拼 prompt），LLM 调用的流式/中断/错误处理逻辑保留不动
4. **可插拔向量库**：`vectorstore.ts` 抽象接口，当前 Memory 实现，未来换 Chroma 只改一个文件
5. **服务端/客户端组件分工**：page 取数据（服务端），交互/状态在客户端组件
6. **共存样式策略**：shadcn 组件用 Tailwind，老组件用原 CSS，渐进迁移

---

## 四、核心功能

| 功能 | 说明 | 对应阶段 |
|---|---|---|
| 流式对话 | AI 回复边生成边显示（SSE） | 5 |
| 多轮上下文 | 记住对话历史 | 6 |
| 系统提示词 | 自定义 AI 人设 | 7 |
| Markdown 渲染 | 代码高亮 + 复制按钮 | 8/9 |
| 中止生成 | 点"停止"立即中断（AbortController 五环链路） | 10 |
| 错误处理 | 分层 try/catch + 状态码语义化 | 11 |
| 会话持久化 | 刷新/重开不丢，URL 带 id | 12 |
| 多会话管理 | 侧边栏：列表/切换/重命名/删除 | 13 |
| 全局状态管理 | Zustand，根治组件重建 bug | 14 |
| RAG 知识库 | 上传文档 → 切块嵌入 → 检索注入 | 15 |
| LangChain 统一抽象 | ChatOpenAI 替代裸 fetch | 16 |
| UI 美化 | Tailwind v4 + shadcn/ui | 17 |

---

## 五、快速开始

### 环境要求
- **Node.js >= 22**（用了内置的 `node:sqlite`，低于 22 会报错）

### 安装与运行
```bash
npm install
npm run dev
```
打开 http://localhost:3000

### 配置环境变量
复制 `.env.local.example` 为 `.env.local`，填入：
```
SILICONFLOW_API_KEY=你的key
OPENAI_BASE_URL=https://api.siliconflow.cn/v1
OPENAI_MODEL=Qwen/Qwen3-8B
OPENAI_EMBEDDING_MODEL=BAAI/bge-m3
```
（在硅基流动控制台申请 key）

### 数据库
首次运行自动创建 `chat.db`（SQLite 文件），无需手动建表。

---

## 六、文档索引

### 项目概述（本文档）
- **README.md**（本文档）—— 全貌入口

### 阶段演进文档（按编号）
学习项目核心——每个阶段记录做了什么、为什么、踩了什么坑。

| 阶段 | 文档 | 主题 |
|---|---|---|
| 1 | `1.Nextjs最简页面.md` | Next.js App Router 基础 |
| 2 | `2.AI对话页面.md` | 客户端状态 + 表单 |
| 3 | `3.接入真实api对话.md` | 接入 LLM API |
| 4 | `4.接口OpenAI兼容改造.md` | 原生 fetch + 硅基流动 |
| 5 | `5.流式聊天改造.md` | SSE 流式 |
| 6 | `6.多轮上下文.md` | messages 数组 |
| 7 | `7.系统提示词.md` | system message |
| 8 | `8.Markdown渲染.md` | react-markdown + 高亮 |
| 9 | `9.交互打磨.md` | 复制/回车/清空/折叠 |
| 10 | `10.中止生成与错误处理.md` | AbortController 五环链路 + 错误分层 |
| 11 | (合并到 10) | 错误处理（合并讲） |
| 12 | `12.会话持久化.md` | SQLite + 动态路由 |
| 12b | `12b.会话持久化补充.md` | **五轮 debug 故事**（竞态 bug 排查） |
| 13 | `13.多会话管理.md` | 侧边栏 |
| 14 | `14.全局状态管理.md` | Zustand + URL↔store 同步 |
| 15 | `15.RAG知识库.md` | RAG 全流程 + 向量库选型 |
| 16 | `16.路线B重构.md` | ChatOpenAI 替代裸 fetch（对比） |
| 17 | `17.UI美化.md` | Tailwind v4 + shadcn/ui |

### 参考资料（随时查）
| 文档 | 内容 |
|---|---|
| `SQLite速通.md` | SQLite/SQL 基础（外键/索引/事务/注入） |
| `Zustand使用文档.md` | Zustand 完整使用手册 |
| `阶段12之后架构梳理.md` | 阶段 12 之后的架构总览 + 数据流图 |
| `env模板示例.md` | 环境变量配置说明 |
| `待学与待办.md` | 待学项 + 待办 + 改进点 + 已完成阶段 |

### 面试八股（`面试八股/` 子文件夹）
| 文档 | 覆盖 |
|---|---|
| `面试八股/面试八股总目录.md` | 索引 + 使用心法 |
| `面试八股/React-Nextjs八股.md` | React/Next.js 概念题 |
| `面试八股/JS-Web工程八股.md` | 流式/中断/竞态/状态管理 |
| `面试八股/RAG-AI工程八股.md` | RAG 全流程/向量库/LangChain |
| `面试八股/数据库八股.md` | SQLite/SQL/事务/索引 |

---

## 七、亮点（面试可讲）

1. **五轮 debug 定位竞态 bug**（`12b`）：从 ref 失败 → 组件重建 → Zustand → useEffect 依赖自我触发，完整的排查故事
2. **AbortController 五环中断链路**（`10`）：前端 abort → fetch → request.signal → 上游 abort → reader.cancel
3. **裸 fetch vs ChatOpenAI 对比重构**（`16`）：两个版本对照，理解底层也懂抽象
4. **向量库三方案选型 + 可插拔抽象层**（`15`）：Memory/Chroma/FAISS 对比，接口隔离
5. **全局状态管理选型**（`14`）：Zustand vs Redux/Context 的取舍

---

## 八、已知限制与后续规划

详见 `待学与待办.md`。主要改进点：

- **向量库换 Chroma**：当前 Memory（重启重嵌入），部署时换持久化实现
- **支持 PDF/Word**：当前只支持 txt/md
- **检索结果溯源展示**：让 AI 回答标注引用了哪段文档
- **断连也能保存**：后端 tee 流边写边存（当前前端断了会丢）
- **部署上线**：Vercel（需换 Turso/Postgres，SQLite 不支持 serverless）

---

## 九、项目演化路线

```
阶段 1-4   能用：最简页面 → 接入真实 AI
阶段 5-9   好用：流式/上下文/Markdown/交互打磨
阶段 10-11 不出事：中止生成 + 错误处理
阶段 12-14 有深度：持久化/多会话/全局状态管理
阶段 15-16 AI 工程：RAG 知识库 + LangChain 统一
阶段 17    好看：Tailwind + shadcn/ui 美化
（后续）    部署上线 + 简历包装
```
