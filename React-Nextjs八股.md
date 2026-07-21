# React / Next.js 面试八股

> 对应项目：Nextjs-RAG-LC（阶段 1-16）
> 配套文档：`14.全局状态管理.md`、`阶段12之后架构梳理.md`、`12b.会话持久化补充.md`
>
> 题型前缀：【概念】定义题 / 【决策】项目设计题 / 【排查】调试题 / 【追问】进阶题
> 难度：⭐ 基础 / ⭐⭐ 中等 / ⭐⭐⭐ 进阶
>
> **回答心法**：每道题答完概念后，主动用项目举例。

---

## 一、React 基础

### 【概念⭐】什么是受控组件？和非受控组件的区别？
受控组件的值由 React state 控制（`value` 绑 state，`onChange` 更新 state）。非受控组件的值存在 DOM 里，React 用 ref 读取。

```tsx
// 受控（项目里的输入框）
const [input, setInput] = useState("");
<input value={input} onChange={(e) => setInput(e.target.value)} />
```

**项目举例**：ChatBox 的 input、systemPrompt 都是受控组件。好处是"React 是唯一数据源"，可以校验、可以重置。

---

### 【概念⭐】useState 和 useRef 的区别？什么时候用哪个？
| | useState | useRef |
|---|---|---|
| 改值触发重渲染 | ✅ 会 | ❌ 不会 |
| 用途 | 存"要显示给用户的数据" | 存"组件用的工具/句柄"，不该触发渲染 |
| 例子 | messages、input、loading | 定时器 id、AbortController、DOM 引用 |

**项目举例**：
- `input`/`messages`/`loading` 用 useState（用户要看）
- `abortRef`（AbortController）、`justCreatedRef`（曾经的尝试，后被 store 替代）用 useRef（用户不看，改它不该重渲染）

---

### 【决策⭐⭐】为什么 abortRef 用 useRef 不用 useState？
AbortController 是组件内部的"遥控器"，用户看不到它，改它不需要重渲染页面。用 useState 会触发无意义重渲染，且 state 更新是异步的，点停止按钮那一刻可能拿不到最新值。useRef 是同步的、不触发渲染。

---

### 【概念⭐⭐】useEffect 的依赖数组是什么意思？空数组、有值、不传的区别？
- `[]`：只在 mount 时跑一次
- `[a, b]`：mount 时跑 + a 或 b 变化时再跑
- 不传：每次渲染都跑（很少用，容易死循环）

**项目举例**：ChatBox 加载历史 `useEffect(() => {...}, [currentId])`，currentId 变化（切换会话）时重新加载。

---

### 【追问⭐⭐⭐】useEffect 里能不能直接写 async？为什么？不能。useEffect 要求返回 `void` 或 cleanup 函数；async 函数返回 Promise，React 会报错。正确做法是里面套 async IIFE：
```tsx
useEffect(() => {
  (async () => { const res = await fetch(...); ... })();
}, [currentId]);
```

**项目举例**：ChatBox 加载历史就这么写的（`12.会话持久化.md` 第五节）。

---

### 【排查⭐⭐⭐】（杀手锏题）讲一个你遇到的 useEffect 相关 bug
**讲五轮 debug 故事**（`12b.会话持久化补充.md` 第五轮）：
- 现象：新建会话发消息，消息显示后立刻消失（闪烁）
- 用 console.log 打印每次 useEffect 执行的依赖值，发现清标记 `setJustCreatedId(null)` 改变了依赖数组里的 justCreatedId，触发 useEffect 自我重跑，重跑时标记已清空、保护失效，走到加载历史分支，覆盖了消息
- 根因：**useEffect 依赖数组的自我触发**——effect 内部修改了依赖列表里的值，形成连锁
- 修复：justCreatedId 移出依赖数组，改用 `useChatStore.getState()` 实时读（不建立订阅，清标记不触发重跑）

---

### 【概念⭐】什么是闭包陷阱（stale closure）？怎么解决？
组件渲染时，事件处理函数/useEffect 捕获的是"渲染那一刻"的 state 值。异步操作执行时，这个闭包值可能是旧的。

```tsx
const [count, setCount] = useState(0);
useEffect(() => {
  const timer = setInterval(() => console.log(count), 1000);
  // count 永远是 0（捕获的是 mount 时的值）
}, []);
```

解法：把 count 加进依赖数组，或用 useRef / functional update。

**项目举例**：ChatBox 的 catch 块里读 messages 是闭包旧值（发送前的），改用 `useChatStore.getState().messages` 读实时值（`14.全局状态管理.md`）。

---

### 【概念⭐】key 的作用是什么？为什么不能用 index？
key 帮 React 区分列表项的身份，决定哪些元素复用、哪些重建。用 index 当 key，列表顺序变化时会导致状态错乱（React 复用了错的元素）。

**项目举例**：消息列表 `key={message.id ?? index}`——DB 加载的有稳定 id，本地新建的暂时用 index。

---

### 【概念⭐⭐】React 的不可变更新（immutability）为什么重要？怎么更新数组里的对象？
不能直接改 state（`arr[0].x = 1` ❌），要返回新引用：
```tsx
setMessages(prev => {
  const next = [...prev];
  next[lastIndex] = { ...next[lastIndex], content: newContent };
  return next;
});
```

原因：React 用引用相等判断 state 是否变化，直接改原对象引用不变，React 不会重渲染。

**项目举例**：ChatBox 流式追加消息、Sidebar 列表更新，都是不可变更新。

---

## 二、Next.js App Router

### 【概念⭐】服务端组件和客户端组件的区别？
| | 服务端组件 | 客户端组件 |
|---|---|---|
| 在哪跑 | 服务器 | 浏览器 |
| 默认？ | ✅ 默认 | 需文件顶部 `"use client"` |
| 能用 useState/useEffect 吗 | ❌ | ✅ |
| 能 await params/查数据库吗 | ✅ | ❌ |

**项目举例**：`app/chat/[id]/page.tsx` 是服务端组件（用 await params），`ChatBox` 是客户端组件（用 useState）。

---

### 【决策⭐⭐】服务端组件能渲染客户端组件吗？反过来呢？
- 服务端 → 渲染客户端子组件：✅ 可以（项目里 page.tsx 渲染 `<ChatBox/>`）
- 客户端 → 渲染服务端组件：❌ 不行（会把服务端组件当客户端组件处理，失去服务端能力）。变通：把服务端组件当 children 传进来。

---

### 【概念⭐⭐⭐】什么是逻辑组件（effect-only component）？为什么 `return null` 的组件要放 JSX 里？
逻辑组件 = 只做副作用、不渲染 UI（`return null`）的组件。放 JSX 里是因为 **React 的副作用必须挂在组件生命周期上**——不渲染它就不 mount、不 mount 它的 useEffect 就不跑。

**项目举例**：`SyncConversationId`（`components/SyncConversationId.tsx`）用 useEffect 把 URL 的 id 同步进 store，`return null`。它放 JSX 里是为了让 useEffect 跑起来。详见 `14.全局状态管理.md`。

---

### 【概念⭐⭐】layout.tsx 是什么？和 page.tsx 的关系？
layout 是"壳子"，page 是"内容"。layout 包住同目录下所有 page，访问任何子路由时壳子不变、只有 `{children}` 切换。**layout 在路由切换时不重新挂载**，所以跨页面共享的东西（如侧边栏）放 layout 里。

**项目举例**：`app/chat/layout.tsx` 渲染 `<Sidebar/> + {children}`，切换会话时 Sidebar 不重建，重命名焦点不丢。

---

### 【决策⭐⭐】为什么 Sidebar 放 layout 不放每个 page？
1. 复用——/chat 和 /chat/[id] 共用一个 Sidebar
2. 持久化——切换路由时 layout 不重新 mount，重命名状态保留
3. 不闪烁——避免每次切会话重新加载列表

---

### 【概念⭐⭐】动态路由 `[id]` 是什么？Next.js 15 里 params 怎么取？
文件名方括号 `[id]` 是动态段，访问 `/chat/abc` 时 `params.id = "abc"`。Next.js 15 里 **params 是 Promise**，要 `await`：
```tsx
type Params = { params: Promise<{ id: string }> };
export default async function Page({ params }: Params) {
  const { id } = await params;
}
```

---

### 【追问⭐⭐】params 为什么在 Next.js 15 变成 Promise？
为了支持 Streaming（流式渲染）——服务端可以先渲染一部分发给浏览器，params 可能要异步解析。

---

### 【概念⭐】`router.push` 和 `<Link>` 的区别？客户端导航是什么？
- `<Link>`：声明式，写在 JSX 里，用于页面间的链接
- `router.push`：编程式，在事件处理函数里调用（如点击按钮后跳转）
- 两者都是**客户端导航**——不刷新整页，只更新 URL 和变化的组件，体验顺滑

**项目举例**：Sidebar 切会话 `router.push(`/chat/${id}`)`、ChatBox 新建会话 `router.push("/chat")`。

---

### 【决策⭐⭐⭐】（杀手锏题）`router.push` 从 /chat 到 /chat/[id]，为什么会导致组件重建？
`/chat` 和 `/chat/[id]` 是**两个不同的页面文件**（`page.tsx` vs `[id]/page.tsx`），渲染两棵不同的组件树。`router.push` 跳转时，Next.js 卸载旧页面、挂载新页面，ChatBox 是全新实例，本地 state 清零。

这是"新建会话首条消息被吃"bug 的根因之一。解法：把 messages 提到组件外的 store（Zustand）。详见 `12b.会话持久化补充.md`。

---

## 三、状态管理

### 【概念⭐⭐】什么是全局状态管理？为什么需要它？
组件内的 useState 是"私有抽屉"，跨组件共享数据做不到。全局状态管理是"放在组件外部的共享柜子"，所有组件读写同一个柜子。

**项目举例**：Sidebar 和 ChatBox 要共享"当前会话 id"和"会话列表"，用 Zustand store。

---

### 【决策⭐⭐⭐】为什么选 Zustand 不选 Redux / Context？
| | Zustand | Redux | Context |
|---|---|---|---|
| Provider | 不需要 | 需要 | 需要 |
| 样板代码 | 极少 | 多 | 中 |
| 精准订阅 | ✅ selector | ✅ 要配 reselect | ❌ 任何值变都重渲染 |
| 学习成本 | 极低 | 高 | 低 |

选 Zustand：轻量、精准订阅、不需 Provider。详见 `Zustand使用文档.md`。

---

### 【概念⭐⭐⭐】selector 订阅 vs getState 读，区别是什么？（重点）
- `useChatStore((s) => s.x)`：**订阅**，x 变触发重渲染；如果在 useEffect 依赖数组里，x 变还会触发 effect 重跑
- `useChatStore.getState().x`：**只读一次当前值**，不订阅，不触发任何东西

**项目举例（杀手锏）**：`justCreatedId` 故意用 getState 读，不用 selector——因为如果订阅它并放进 useEffect 依赖，清标记会触发自我重跑，覆盖消息。详见 `12b` 第五轮。

---

### 【决策⭐⭐】什么 state 进 store，什么留组件 useState？
- 进 store：跨组件共享的（conversations、currentId）、跨重建需存活的（messages、systemPrompt、loading）
- 留组件：纯 UI 临时状态（input 输入框值、折叠态）、重建丢了无所谓的（editingId）

口诀：重建后必须保留的进 store；重建后从空开始也无所谓的留组件。

---

## 四、排查/调试方法论

### 【排查⭐⭐⭐】（必练故事）用户反馈"新建会话首条消息显示后消失"，你怎么排查？
**讲五轮 debug**（`12b.会话持久化补充.md`）。STAR 法：
- **S 现象**：新建会话发消息，消息显示后立刻消失（闪烁），刷新或切换回来又能显示
- **T 任务**：定位根因并修复
- **A 行动**：
  1. 从"刷新能恢复"反推 → 数据库有数据 → 问题在显示层
  2. 加 console.log 打印每次 useEffect 执行的依赖值，发现清标记后 useEffect 又跑了一次
  3. 定位根因：清标记改变了依赖数组里的值，触发自我重跑
- **R 结果**：justCreatedId 移出依赖数组，改用 getState 读，根治

**亮点**：体现"从现象反推根因 + 用日志调试 + 理解 useEffect 依赖机制"。

---

### 【追问⭐⭐】如果不用日志，你怎么定位时序 bug？
- 加日志是最直接的（打印每次执行的依赖值）
- 也可用 React DevTools 的 Profiler 看每次重渲染的原因
- 或在 setMessages 的回调里打断点，看调用栈

---

### 【排查⭐⭐】怎么判断一个 bug 是"竞态条件"？
特征：**偶发、不稳定**——同样的操作有时出 bug 有时不出。说明多个异步操作在抢同一个资源，执行顺序不固定。本项目"消息有时消失有时正常"就是典型竞态。

---

## 五、进阶追问

### 【追问⭐⭐⭐】如果项目要做 SSR（服务端渲染）首屏，Zustand 要怎么处理？
Zustand 是客户端 store，SSR 时服务端没有浏览器环境。要用 `useStore` 配合 hydration（服务端注入初始 state，客户端 mount 时再 hydrate）。本项目目前是纯客户端渲染（ChatBox 是客户端组件），没这个问题。

---

### 【追问⭐⭐】你的消息列表有性能问题吗？消息多了怎么办？
当前 `messages.map` 每条都渲染 Markdown（重）。优化方向：
- 虚拟列表（react-window）只渲染可见区域
- 历史消息不渲染 Markdown（纯文本）
- 分页加载（只渲染最近 N 条）

---

## 速查（一页纸）

```
受控组件：value 绑 state + onChange
useState vs useRef：看不看得到 / 要不要重渲染
useEffect 依赖：[]一次 / [x]x变跑 / 不传每次跑
useEffect 不能直接 async：套 IIFE
闭包陷阱：异步里读到旧值，用依赖/ref/getState 解决
key：不能用 index（顺序变会错乱）
不可变更新：返回新引用，不能直接改

服务端组件（默认）vs 客户端组件（"use client"）
服务端能渲染客户端子组件，反过来不行
逻辑组件：return null 只跑 useEffect，放 JSX 才 mount
layout：壳子不重建，page：内容切换
动态路由 [id]：Next.js 15 params 是 Promise
router.push：客户端导航，不刷新整页

Zustand：selector 订阅 / getState 只读
进 store：跨组件/跨重建；留组件：纯 UI 临时
```
