# Zustand 使用文档

> 这份文档假设你"略懂 React 基础"（知道 useState/useEffect），但没用过状态管理库。
>
> 目标：看完这份，能**完全看懂**本项目的 `lib/store.ts`，并自己写出新的 store。
>
> 这是一份**参考资料**，不是阶段文档，不带阶段编号。随时回查。

---

## 一、先建立心智模型：store 是什么

你熟悉的 `useState` 是**组件内部的抽屉**——每个组件有自己的抽屉，别人打不开：

```
ChatBox 组件
  └─ useState(messages) ← 只有 ChatBox 自己能读能改

Sidebar 组件
  └─ useState(conversations) ← 只有 Sidebar 自己能读能改
```

问题：如果 ChatBox 和 Sidebar 需要**共享**数据（比如"当前是哪个会话"），用 useState 做不到——两个组件各自有自己的抽屉，互不可见。

**store 是放在组件外部的共享柜子**——所有组件都能读写同一个柜子：

```
                    store（组件外部的共享柜子）
                    ├─ messages
                    ├─ currentId
                    └─ conversations
                       ↑↓
            ┌──────────┼──────────┐
            ↓          ↓          ↓
       ChatBox     Sidebar    其它组件
       （读写）    （读写）   （读写）
```

任何组件都能订阅 store 的某些字段，也能调 action 修改它。**store 是单一数据源（single source of truth）**。

这就是 Zustand 做的事——给你一个组件外部的、所有组件共享的状态容器。

---

## 二、为什么用 Zustand（vs useState / Context / Redux）

| 方案 | 共享状态 | 学习成本 | 样板代码 | 精准订阅 |
|---|---|---|---|---|
| **useState** | ❌ 组件内私有 | 极低 | 无 | — |
| **Context** | ✅ 跨组件 | 低 | 中（要 Provider 包裹） | ❌ 任何值变，所有消费者重渲染 |
| **Redux** | ✅ 跨组件 | 高 | 多（reducer/action/dispatch） | ✅ 但要配 reselect |
| **Zustand** | ✅ 跨组件 | 极低 | 极少（一个 create） | ✅ selector 原生支持 |

**Zustand 的核心优势**：
1. **不需要 Provider**：Redux/Context 要用 `<Provider>` 包裹整棵树，Zustand 不用——组件直接 `import { useChatStore } from "@/lib/store"` 就能用
2. **一个函数搞定**：`create(...)` 里同时定义状态和操作，没有 Redux 的 action/reducer 拆分
3. **精准订阅**：用 selector 只订阅需要的字段，避免无关 state 变化触发重渲染（性能好）
4. **跨重建存活**：store 在组件外部，组件卸载/重建不影响它（这是本项目引入它的核心原因）

---

## 三、创建 store：`create` 函数

看本项目的真实代码（`lib/store.ts`）：

```ts
import { create } from "zustand";

type ChatState = {
  // 状态（数据）
  messages: Message[];
  currentId: string | null;
  loading: boolean;
  // ...其它状态

  // actions（操作函数）
  setMessages: (messages: Message[]) => void;
  setLoading: (loading: boolean) => void;
  // ...其它 action
};

export const useChatStore = create<ChatState>((set) => ({
  // 初始状态
  messages: [],
  currentId: null,
  loading: false,

  // actions：用 set 修改状态
  setMessages: (messages) => set({ messages }),
  setLoading: (loading) => set({ loading }),
}));
```

### 拆解 `create` 的结构

```ts
create<ChatState>((set) => ({ ... }))
      ↑           ↑      ↑
      │           │      └─ 返回"初始状态 + actions"的对象
      │           └─ set 是 Zustand 提供的"修改状态的函数"
      └─ TypeScript 类型参数（让 store 有类型提示）
```

**关键三件套**：
1. **状态（state）**：直接写字段和初始值，像对象的属性
2. **action（操作函数）**：用 `set` 修改状态的函数，命名习惯用 `setXxx` / `updateXxx` / `appendXxx`
3. **set 函数**：Zustand 传给你的修改状态的唯一入口

### `set` 函数的两种用法

```ts
// 用法 A：直接传对象（替换字段）
setMessages: (messages) => set({ messages }),
//                       ↑ set 接收一个对象，里面的字段会合并到 store

// 用法 B：传函数（基于现有 state 计算）
updateLastMessage: (content) =>
  set((state) => {
    // state 是当前的完整 store 状态
    const next = [...state.messages];
    const last = next[next.length - 1];
    next[next.length - 1] = { ...last, content };
    return { messages: next };  // 返回要更新的字段
  }),
```

**什么时候用哪种**：
- 新值**不依赖**老值 → 用法 A（`set({ loading: true })`）
- 新值**依赖**老值（比如"在数组末尾追加"、"修改最后一条"）→ 用法 B（`set((state) => ...)`，拿到 state 基于它改）

### set 是"合并"不是"替换"

```ts
set({ messages: [] });
```

这只会把 `messages` 字段改成 `[]`，**其它字段（currentId、loading 等）不变**。set 是浅合并——只更新你传进去的字段。这点和 React 的 `setState` 一样。

如果想**整体替换**所有 state，传第二个参数 `true`：
```ts
set({ ...newState }, true);  // 罕见，通常不需要
```

---

## 四、组件怎么用 store：selector 订阅

### 读状态：用 selector

```tsx
import { useChatStore } from "@/lib/store";

function ChatBox() {
  // ✅ 好的写法：用 selector 只订阅需要的字段
  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);

  // ❌ 不好的写法：订阅整个 store，任何字段变都重渲染
  const store = useChatStore();
  const messages = store.messages;
}
```

**selector 是个函数**：`(state) => 你要的字段`。Zustand 会比较这个函数返回值，**变了才触发组件重渲染**。这是性能优化的关键——避免无关 state 变化导致不必要重渲染。

```
store 里 conversations 变了：
  订阅 messages 的组件 → 不重渲染（messages 没变）✓
  订阅 conversations 的组件 → 重渲染（conversations 变了）✓
```

如果用不好的写法（订阅整个 store），任何字段变都会触发重渲染，性能差。

### 读 action：也用 selector

```tsx
const setMessages = useChatStore((s) => s.setMessages);
const setLoading = useChatStore((s) => s.setLoading);
```

action 是函数，**引用稳定**（不会变），所以订阅它不会触发重渲染。但用 selector 写法保持一致、清晰。

### 调 action 修改状态

```tsx
function ChatBox() {
  const setMessages = useChatStore((s) => s.setMessages);

  function handleSend() {
    setMessages([...]);  // 调 action，store 更新
  }
}
```

调 action 后，store 的对应字段更新，**所有订阅了那个字段的组件自动重渲染**。不需要手动通知。

---

## 五、getState：在非渲染上下文读实时值（重要！）

这是本项目踩过坑的点（详见 `12b.会话持久化补充.md` 第五轮）。

### 问题：渲染闭包的值是旧的

```tsx
function ChatBox() {
  const messages = useChatStore((s) => s.messages);  // 渲染时捕获的值

  async function handleSend() {
    // 这里读 messages，是"渲染时的值"——异步操作期间如果 store 变了，这里还是旧的
    console.log(messages);  // 可能是旧值
  }
}
```

`messages` 是组件**渲染时**的闭包值。如果异步操作（fetch、setTimeout）执行期间 store 被别的操作更新了，闭包里的 `messages` 不会跟着变——它是旧快照。

### 解法：getState 读实时值

```tsx
import { useChatStore } from "@/lib/store";

function ChatBox() {
  async function handleSend() {
    // 用 getState() 读 store 的实时快照（不建立订阅）
    const currentMessages = useChatStore.getState().messages;
    console.log(currentMessages);  // 永远是最新的
  }
}
```

`getState()` 返回 store 当前的完整状态，**不建立订阅**——调用它不会让组件订阅 store，值变不会触发重渲染。

### selector vs getState 的区别（关键）

| | selector `useChatStore((s) => s.x)` | getState `useChatStore.getState().x` |
|---|---|---|
| 建立订阅吗 | ✅ 建立（值变触发重渲染） | ❌ 不建立（只读一次） |
| 返回值 | 订阅的字段 | 字段的当前快照 |
| 在哪用 | 组件函数体顶部（渲染时） | 事件处理函数、useEffect、catch 块里（需要实时值时） |
| 放进 useEffect 依赖数组 | ✅ 会触发重跑 | — （不适用） |

**本项目的真实用例**（`justCreatedId`）：

```tsx
useEffect(() => {
  // 用 getState 读，不进依赖数组
  // 如果用 selector 订阅并放进依赖，清标记会触发 useEffect 重跑（自我触发 bug）
  const createdId = useChatStore.getState().justCreatedId;
  if (createdId) {
    if (currentId === createdId) {
      setJustCreatedId(null);  // 清标记不会触发 useEffect 重跑
    }
    return;
  }
  // ...
}, [currentId]);  // 只依赖 currentId
```

**记忆点**：
- 组件顶部读状态 → 用 selector（`useChatStore((s) => s.x)`）
- 事件处理函数/useEffect 里读实时值 → 用 getState（`useChatStore.getState().x`）
- 不需要响应变化的值 → 用 getState（避免进依赖数组引发自我触发）

---

## 六、在 store 外部修改状态：setState

除了在组件里调 action，还能在**任何地方**直接改 store（不需要 hooks）：

```ts
import { useChatStore } from "@/lib/store";

// 在普通函数、非组件文件里：
useChatStore.setState({ messages: [] });

// 或基于现有 state 改：
useChatStore.setState((state) => ({ loading: !state.loading }));

// 也能读：
const currentMessages = useChatStore.getState().messages;
```

适合在**非 React 代码**里操作 store（比如工具函数、事件监听器、定时器）。本项目的 action 都定义在 store 里，组件调 action——但如果有需要，外部代码也能直接 `setState`。

---

## 七、action 里发异步请求

Zustand 的 action 是普通函数，**可以发异步请求**。本项目的 `refreshConversations` 就是例子：

```ts
refreshConversations: async () => {
  try {
    const res = await fetch("/api/conversations");
    if (!res.ok) return;
    const data = await res.json();
    set({ conversations: data.conversations });
  } catch {
    // 静默失败
  }
},
```

要点：
- action 标 `async`，里面用 `await`
- 请求完成后用 `set(...)` 把结果写进 store
- 组件调这个 action：`const refresh = useChatStore((s) => s.refreshConversations); await refresh();`

这让"从后端拉数据 + 更新 store"的逻辑**集中在 store 里**，组件只调一个函数，不关心 fetch 细节。

---

## 八、什么进 store、什么留组件 useState

这是设计 store 的核心判断。**不是所有 state 都该进 store**。

### 判断标准：这个 state 需要跨组件/跨重建共享吗？

| 进 store | 留组件 useState |
|---|---|
| 跨组件共享的（conversations、currentId） | 纯 UI 临时状态（input 输入框值） |
| 跨重建需存活的（messages、systemPrompt、loading） | 只在单个组件内用、重建丢了也无所谓的（systemOpen 折叠态、editingId 重命名） |

**口诀**：
- 这个 state **重建后必须保留** → 进 store
- 这个 state **重建后从空开始也无所谓** → 留组件

### 本项目的实际划分

```ts
// 进 store 的（lib/store.ts）
conversations   // Sidebar 和 ChatBox 都要读
currentId       // Sidebar 和 ChatBox 都要读
messages        // ChatBox 用，但重建后必须保留（不然消息丢）
systemPrompt    // 同上
loading         // 同上

// 留组件 useState 的
input           // ChatBox 的输入框，重建后清空无所谓
systemOpen      // system 提示词面板的折叠态，重建后默认收起也行
editingId       // Sidebar 正在重命名的会话 id，重建后取消重命名也可接受
editTitle       // 重命名输入框的临时值，同上
abortRef        // AbortController 的 ref，本来就是组件内的"遥控器"
```

**不要把所有东西都塞进 store**——store 太大会变难维护。只放真正需要共享/存活的。

---

## 九、防循环更新：setCurrentId 的写法

当 store 和 URL 双向同步时，容易形成死循环：URL→store→URL→store...

本项目的防御（`setCurrentId`）：

```ts
setCurrentId: (id) => {
  // 防循环更新：id 没变就不动
  set((state) => (state.currentId === id ? state : { currentId: id }));
  //                       ↑ 如果 id 没变，返回原 state（不触发更新）
},
```

返回原 `state`（同一个引用）时，Zustand 检测到没变化，不触发订阅者重渲染。链条终止。

**适用场景**：任何"可能被重复调用、但值相同时不该触发更新"的 action。比如双向同步、事件监听器里的 setState。

---

## 十、TypeScript 类型怎么写

### 基本写法

```ts
type ChatState = {
  // 状态
  messages: Message[];
  loading: boolean;
  // action：函数类型
  setMessages: (messages: Message[]) => void;
};

export const useChatStore = create<ChatState>((set) => ({
  // ...
}));
```

`create<ChatState>` 的泛型参数让 store 有类型提示——调 `useChatStore((s) => s.xxx)` 时，`s` 会有自动补全。

### 复杂 action 的类型

```ts
type ChatState = {
  // 基于现有 state 计算
  updateLastMessage: (content: string) => void;
  // 异步 action
  refreshConversations: () => Promise<void>;
};
```

### 共享类型

本项目把 `Message` 类型定义在 store.ts 里导出，其它文件 import：

```ts
// lib/store.ts
export type Message = {
  id?: number;
  role: "user" | "assistant" | "system";
  content: string;
};

// components/ChatBox.tsx
import { useChatStore, type Message } from "@/lib/store";
```

`Conversation` 类型定义在 `lib/queries.ts`（因为它和数据库表结构对应），store 里 import 它：

```ts
// lib/store.ts
import type { Conversation } from "@/lib/queries";
```

**类型定义在哪**：跟着"数据的源头"走。Message 是 store 用的渲染类型，定义在 store；Conversation 是数据库类型，定义在 queries。

---

## 十一、完整工作流：从创建到使用

以"在组件里读 messages、调 setMessages"为例：

```
1. 定义 store（lib/store.ts）
   ┌─────────────────────────────────────┐
   │ create<ChatState>((set) => ({       │
   │   messages: [],                     │ ← 初始状态
   │   setMessages: (m) => set({messages: m}),  │ ← action
   │ }))                                 │
   └─────────────────────────────────────┘

2. 组件 A 订阅 + 调 action（ChatBox.tsx）
   const messages = useChatStore((s) => s.messages);    ← 订阅
   const setMessages = useChatStore((s) => s.setMessages); ← 拿 action
   setMessages([...]);  ← 调 action，store 更新

3. 组件 B 也订阅（任何其它组件）
   const messages = useChatStore((s) => s.messages);    ← 也订阅
   // 组件 A 调 setMessages 后，组件 B 自动重渲染（messages 变了）
```

**没有 Provider、没有 connect、没有 reducer**——定义一次，任何组件 import 即用。这是 Zustand 最大的简洁性。

---

## 十二、对照本项目：store.ts 全景

带着上面的知识，重新看 `lib/store.ts` 的结构：

```ts
// 类型定义
export type Message = { ... };
type ChatState = {
  // 状态（6 个字段）
  conversations, currentId, messages, systemPrompt, loading, justCreatedId
  // actions（9 个函数）
  setCurrentId, setMessages, appendMessage, updateLastMessage,
  setLoading, setSystemPrompt, setJustCreatedId,
  setConversations, refreshConversations
};

// create 创建 store
export const useChatStore = create<ChatState>((set) => ({
  // 初始状态
  conversations: [], currentId: null, messages: [], ...

  // actions
  setCurrentId: (id) => set((state) => state.currentId === id ? state : { currentId: id }),  // 防循环
  setMessages: (messages) => set({ messages }),                                                 // 直接设
  appendMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),    // 基于旧值追加
  updateLastMessage: (content) => set((state) => { ... }),                                      // 修改最后一条
  refreshConversations: async () => { const res = await fetch(...); set({ ... }); },           // 异步拉数据
  // ...
}));
```

每个 action 都对应一个真实场景：
- `setMessages` / `appendMessage` / `updateLastMessage`：ChatBox 发消息、流式更新时用
- `setCurrentId`：URL→store 同步时用（SyncConversationId 调它）
- `setJustCreatedId`：新建会话保护（handleSend 创建会话后调它）
- `refreshConversations`：保存消息后刷新侧边栏列表

---

## 十三、常见疑问

### Q：store 数据刷新页面会丢吗？
**答**：会。store 在浏览器内存里，刷新就清空。所以本项目刷新时，ChatBox 的 useEffect 会重新从数据库加载历史填进 store。store 只是"会话期间的共享内存"，持久化靠数据库。

### Q：多个组件调同一个 action 会冲突吗？
**答**：不会。Zustand 的 set 是同步的，JS 单线程，调 action 按顺序执行。不存在并发冲突。

### Q：store 能存函数吗？
**答**：能，但通常没必要。action 本身就是存在 store 里的函数。如果你想在 store 里存"回调函数"，一般改用"存数据 + 组件根据数据调函数"的模式。

### Q：为什么要导出 useChatStore 而不是 store 本身？
**答**：`useChatStore` 是个 hook（带订阅能力的函数），组件用它订阅。store 本身是内部状态，不直接暴露。但需要时能用 `useChatStore.getState()` / `useChatStore.setState()` 访问。

### Q：store 太大怎么办？
**答**：按领域拆成多个 store（`useChatStore`、`useUserStore`、`useUIStore`）。本项目目前一个 store 够用，等加了用户系统/文档管理等再拆。

---

## 速查总结（一页纸）

```
创建 store：
  create<Type>((set) => ({ 状态, actions }))
  set 接对象（直接设）或函数（基于旧值）

组件读状态（订阅）：
  const x = useChatStore((s) => s.x)   ← selector，只订阅 x

组件读 action：
  const setX = useChatStore((s) => s.setX)

非渲染上下文读实时值（不订阅）：
  useChatStore.getState().x

外部修改（非组件代码）：
  useChatStore.setState({ x: ... })

防循环更新：
  set((state) => state.x === newVal ? state : { x: newVal })

异步 action：
  refreshX: async () => { const res = await fetch(...); set({ ... }); }

什么进 store：
  跨组件共享、跨重建需存活的 → 进 store
  纯 UI 临时状态、重建丢了无所谓的 → 留组件 useState
```
