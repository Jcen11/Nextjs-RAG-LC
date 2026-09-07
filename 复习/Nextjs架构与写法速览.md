# Next.js 项目架构与写法速览

> 复习用文档。以本项目（Nextjs-RAG-LC，Next.js 15 App Router）为实例，讲清 Next.js 项目的一般架构方式、目录约定、基本代码写法。
> 适合面试前通读 + 作为答题素材。更多细节回查项目内 1~18 号阶段文档。

---

## 一、核心心智模型：React 和 Next.js 是两层

这是入门时最大的思维差异，也是面试常考的第一题：

| | React | Next.js |
|---|---|---|
| 管什么 | 组件、JSX、useState、事件、列表渲染 | 路由、渲染方式（SSR/SSG）、API 接口、打包 |
| 你写什么 | `'use client'` 组件里的交互逻辑 | `page.tsx` / `layout.tsx` / `route.ts` 的约定 |
| 类比 | UI 积木 | 放积木的房子 + 供电系统 |

**一句话**：React 只回答"组件怎么画、状态怎么管"；Next.js 回答"这个组件挂在哪个 URL、在服务器还是浏览器渲染、数据从哪来"。初学的多数困惑来自把这两层混在一起理解。

---

## 二、App Router 的目录约定（特殊文件）

`app/` 目录下，**文件名即约定**。目录结构就是路由表，不用写路由配置：

| 文件 | 作用 | 对应 URL |
|---|---|---|
| `app/page.tsx` | 首页 | `/` |
| `app/about/page.tsx` | 普通页面 | `/about` |
| `app/chat/page.tsx` | 聊天页 | `/chat` |
| `app/chat/[id]/page.tsx` | 动态路由页 | `/chat/任意id` |
| `app/layout.tsx` | 根布局，包住所有页面 | 全局 |
| `app/chat/layout.tsx` | 子布局，只包 /chat 下的页面 | 局部 |
| `app/api/chat/route.ts` | API 接口（不是页面！） | `POST /api/chat` |
| `app/globals.css` | 全局样式 | — |

其他特殊文件（本项目没用到但要知道）：`loading.tsx`（加载态）、`error.tsx`（错误边界）、`not-found.tsx`（404）、`template.tsx`（每次进路由都重挂载的布局，和 layout 的区别是**不保留状态**）。

**动态路由的坑（Next.js 15 变化）**：`params` 现在是 Promise，必须 `await`：

```ts
// app/chat/[id]/page.tsx（真实代码）
type Params = { params: Promise<{ id: string }> };

export default async function ChatByIdPage({ params }: Params) {
  const { id } = await params;   // 15 之前是同步的，现在必须 await
  return <SyncConversationId id={id} />;
}
```

---

## 三、项目目录结构的含义（结合本项目）

```
app/            页面 + API 路由（路由层，都是"入口"）
  layout.tsx      根布局（header + 全屏 flex）
  chat/layout.tsx 聊天区子布局（Sidebar + 内容区）
  chat/page.tsx   /chat 页
  chat/[id]/page.tsx  动态路由页
  api/           所有后端接口（route.ts）
components/     普通组件（不是路由入口）
  ChatBox.tsx    核心交互组件（'use client'）
  ui/            shadcn/ui 组件（阶段 17）
lib/            业务逻辑（前后端共用目录，但每个文件只属于一侧）
  store.ts       Zustand（只在客户端用）
  rag.ts / langchain.ts / vectorstore.ts（只在服务端用）
  db.ts / queries.ts（只在服务端用）
chat.db         SQLite 数据文件（gitignore）
.env.local      本地密钥（gitignore）
vercel.json     部署配置（超时等）
```

**判断一个文件属于客户端还是服务端**：看它 import 了什么。`useChatStore`（Zustand hook）→ 客户端；`node:sqlite` / `process.env.XXX` 密钥 → 服务端。Next.js 会按依赖自动判定打包边界，`node:sqlite` 被客户端 import 会直接报错。

---

## 四、基本代码写法

### 1. 页面 page.tsx（默认服务端组件）

```tsx
import Link from "next/link";
import Counter from "../components/Counter";

export default function HomePage() {
  return (
    <main>
      <h1>欢迎学习 Next.js App Router</h1>
      <nav>
        <Link href="/chat">去聊天页面</Link>   {/* 页面跳转用 next/link，不是 <a> */}
      </nav>
      <Counter />
    </main>
  );
}
```

**要点**：默认就是服务端组件（在服务器渲染成 HTML）；能用 `async`、能直接读数据库、能读服务端环境变量；**不能用** useState/useEffect/事件。

### 2. 布局 layout.tsx（切换路由不重建）

```tsx
// app/chat/layout.tsx（真实代码）
import Sidebar from "@/components/Sidebar";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="chat-shell flex-1 min-h-0">
      <Sidebar />
      <div className="chat-main">{children}</div>
    </div>
  );
}
```

**三个用 layout 的理由**（项目注释里写的）：复用（多个页面共用 Sidebar）、**持久化（切换路由时 layout 不重新 mount，状态保留）**、不闪烁。这是阶段 13/14 架构的基石。

### 3. API 路由 route.ts（导出 HTTP 方法名）

```ts
// app/api/hello/route.ts 的形态：文件名 = 路由，导出函数名 = HTTP 方法
export async function GET() { ... }
export async function POST(request: Request) {
  const body = await request.json();   // 读请求体
  return Response.json({ reply: "..." });  // 返回 JSON
}
// 流式接口：return new Response(stream, { headers: {...} })  // 见 app/api/chat/route.ts
```

要点：一个文件可以同时导出 GET/POST/DELETE/PATCH；`request.json()` 包 try/catch（请求体可能不是 JSON）；状态码用 `{ status: 400 }` 语义化。

### 4. 客户端组件 'use client'（什么时候必须加）

加了 `"use client"`（文件第一行）才**能**用：useState / useEffect / 事件处理 / 浏览器 API（clipboard）/ 客户端库（Zustand、react-markdown）。

什么时候必须加：有交互、有状态、要调浏览器能力。什么时候别加：纯展示、需要服务端数据/密钥的场景——**保持服务端组件的优势**（更小 bundle、能直接读库）。

### 5. 服务端组件 + 客户端组件的协作模式（本项目最重要的写法）

Next.js 允许**服务端组件渲染客户端组件**（通过 props 传数据，但 props 必须可序列化；不能把函数传给客户端组件）：

```tsx
// app/chat/[id]/page.tsx（服务端）—— 用 await params 拿到 URL 的 id
export default async function ChatByIdPage({ params }: Params) {
  const { id } = await params;
  return (
    <SyncConversationId id={id} />   {/* 把 id 作为 prop 传给客户端子组件 */}
    <ChatBox />
  );
}
```

```tsx
// components/SyncConversationId.tsx（客户端）—— 负责调 store 这个客户端 hook
"use client";
import { useEffect } from "react";
import { useChatStore } from "@/lib/store";

export function SyncConversationId({ id }: { id: string }) {
  const setCurrentId = useChatStore((s) => s.setCurrentId);
  useEffect(() => { setCurrentId(id); }, [id, setCurrentId]);
  return null;   // 不渲染 UI，只做副作用
}
```

**为什么要拆两个文件**：page.tsx 需要服务端能力（await params），store 需要客户端能力（hook）——一个组件不能同时是两者，所以服务端组件"拿数据"，客户端子组件"消费数据"。各司其职。这个模式本项目用了两次（SyncConversationId / ClearCurrentId），面试必讲。

### 6. 客户端导航 router.push

```ts
// ChatBox 新建会话后改 URL（不整页刷新，走客户端导航）
router.push(`/chat/${activeConvId}`);
```

`next/navigation` 的 `useRouter()`（客户端）；`<Link>` 用于静态链接，`router.push` 用于代码里跳转。**注意**：客户端导航会卸载重建页面组件（但 layout 不重建）——这正是阶段 12 竞态 bug 的来源，也是阶段 14 引入 Zustand 的原因。

---

## 五、数据获取的两种模式（面试高频）

| 模式 | 写法 | 适用 | 本项目例子 |
|---|---|---|---|
| 服务端组件直接读数据 | page.tsx 里 `async` + 直接调查询函数 | 首屏数据、需要 SSR | 本项目页面组件没直接读库（数据在客户端 store 里），但这是标准做法 |
| 客户端 fetch API | `'use client'` 组件里 `fetch('/api/xxx')` | 交互后拿数据、流式 | ChatBox 调 `/api/chat`（流式）、Sidebar 调 `/api/conversations` |

本项目的选择：**交互型应用**（聊天）把状态放客户端（Zustand store）+ fetch API 层；服务端 route.ts 里才碰数据库和密钥。完整链路：

```
浏览器（ChatBox, 'use client'）
  → fetch('/api/chat') 
  → app/api/chat/route.ts（服务端：读 env 密钥、RAG 检索、调 LangChain 流式）
  → lib/rag.ts + lib/vectorstore.ts + lib/langchain.ts（业务逻辑）
  → lib/queries.ts + lib/db.ts（数据层）→ SQLite/Turso
```

分层原则（贯穿全项目）：**前端只认自己的接口格式；协议/密钥/数据库细节全收敛在服务端。每次改动只动必须动的那一层。**

---

## 六、写法惯例清单（从本项目提炼，面试可讲）

1. **密钥只在服务端**：`process.env.XXX_API_KEY` 只出现在 route.ts/lib，绝不进客户端 bundle；客户端要用公开变量必须加 `NEXT_PUBLIC_` 前缀。
2. **环境变量分层**：`.env.local`（真实值，gitignore）vs `.env.local.example`（模板，进 git）。
3. **单例挂 globalThis**：`db.ts`、`langchain.ts` 的模型/连接挂 `globalThis`，防开发模式热重载重复创建（阶段 18 的 Turso 客户端还因为"模块顶层初始化"踩过坑——**有副作用的初始化要么惰性、要么和启用开关绑定**）。
4. **API 返回状态码语义化**：400 参数错 / 404 不存在 / 500 服务端错 / 502 上游错 / 504 超时。
5. **查询层防注入**：SQL 全部 prepared statements（`?` 占位符），route.ts 不写 SQL。
6. **异步统一**：数据层接口统一 async（阶段 18），因为云端后端（Turso）天生 async——**接口按"最挑剔的实现"定契约**。
7. **可插拔抽象**：`VectorStore` 接口 + 底部单例装配（env 切换实现），业务零感知换实现。
8. **客户端组件尽量薄**：纯 UI 临时状态留组件 useState（输入框、折叠），跨组件/跨重建需存活的进 store。

---

## 七、面试速答（常见问题一句话答案）

- **SSR/SSG 区别？** SSR 每次请求在服务器渲染（动态数据），SSG 构建时渲染一次（静态页）。App Router 默认组件是静态的（构建时预渲染），用了动态 API（await params、读 request）才变成动态。
- **'use client' 是什么意思？** 声明组件在浏览器渲染，能用 hooks/事件；默认组件在服务器渲染。Next.js 按 import 依赖自动判定，客户端文件 import 服务端模块（node:sqlite）会报错。
- **layout 和 page 的关系？** layout 包 page；同层级路由切换时 layout 不重建（状态保留），page 重建。子目录可以有嵌套 layout。
- **route.ts 和 page.tsx 什么区别？** 同一目录下二选一：page 是页面，route 是纯 API；route 里按导出的 HTTP 方法名处理请求。
- **动态路由参数为什么是 Promise？** Next.js 15 起 params 是异步的，必须 await（15 之前同步）。
- **前端怎么和数据库交互？** 不直接交互——前端 fetch 自己的 API 路由，服务端 route.ts 才碰数据库。数据库文件（node:sqlite）根本不会打进客户端 bundle。
