// 全局状态管理（Zustand）
//
// 为什么用 store 而不是各组件 useState：
// 路由跳转 /chat → /chat/[id] 时，ChatBox 会被卸载重建，本地 useState/useRef 会丢失
// （这是"新建会话首条消息被吃掉"bug 的根因，详见 12b 文档和 14 文档）。
// 把跨组件、跨重建需要存活的状态放进 store（组件外的单一数据源），
// 组件重建后从 store 读，不会丢失。
//
// Zustand 选型理由（vs Context / Redux）：
// - 比 Context 轻量：不需要 Provider 包裹，组件直接 useStore 订阅
// - 比 Redux 简单：没有 action/reducer/dispatch 的样板代码，一个 create 搞定
// - 精准订阅：用 selector 只订阅需要的字段，避免无关 state 变化触发重渲染
//
// 什么进 store、什么留组件 useState：
// - 进 store：跨组件共享的（conversations、currentId）、跨重建需存活的（messages、systemPrompt、loading）
// - 留组件：纯 UI 临时状态（input 输入框、systemOpen 折叠、editingId 重命名、abortRef）

import { create } from "zustand";
import type { Conversation, KnowledgeBase } from "@/lib/queries";

// 组件渲染用的消息类型（比 ChatMessage 简化，去掉 createdAt，加上 system 角色兼容）
export type Message = {
  id?: number; // DB 加载的有 id；本地新建的暂无
  role: "user" | "assistant" | "system";
  content: string;
};

// === store 的状态形状 ===
type ChatState = {
  // 状态
  conversations: Conversation[]; // 所有会话列表（Sidebar 用）
  currentId: string | null; // 当前选中的会话（Sidebar + ChatBox 共用）
  messages: Message[]; // 当前会话的消息列表（ChatBox 用）
  systemPrompt: string; // 当前会话的 system 提示词
  loading: boolean; // 是否正在生成
  // 标记"刚创建但还没保存进数据库的会话 id"
  // 解决"新建会话首条消息被吃"的竞态：router.push 后 useEffect 会加载历史，
  // 但此时数据库还没存（保存是流式后才发生），加载到空数组会覆盖 store.messages。
  // handleSend 创建会话后设这个字段，useEffect 看到就跳过加载（直接用 store 里已有的消息）。
  // 之前用 justCreatedRef 失败，因为 ref 在组件实例内、重建后丢失；放进 store 就跨实例存活了。
  justCreatedId: string | null;
  // 阶段 15：当前会话绑定的知识库 id（null = 纯对话模式）
  // 从数据库加载会话时读出来，ChatBox 发请求时带上，决定是否走 RAG
  currentKbId: string | null;
  // 阶段 15：所有知识库列表（知识库管理面板用）
  knowledgeBases: KnowledgeBase[];

  // actions —— 状态操作函数
  setCurrentId: (id: string | null) => void;
  setMessages: (messages: Message[]) => void;
  appendMessage: (message: Message) => void;
  updateLastMessage: (content: string) => void; // 流式追加用：更新最后一条的 content
  setLoading: (loading: boolean) => void;
  setSystemPrompt: (prompt: string) => void;
  setJustCreatedId: (id: string | null) => void;
  setCurrentKbId: (kbId: string | null) => void; // 阶段 15
  setKnowledgeBases: (kbs: KnowledgeBase[]) => void; // 阶段 15

  // 会话列表操作（从 API 拉数据后更新 store，供 Sidebar 用）
  setConversations: (conversations: Conversation[]) => void;
  // 从后端拉取最新会话列表并写进 store（封装了 fetch + setConversations）
  // ChatBox 保存消息后、Sidebar mount 时都调它，保证列表是最新
  refreshConversations: () => Promise<void>;
  // 阶段 15：从后端拉取最新知识库列表写进 store
  refreshKnowledgeBases: () => Promise<void>;
};

export const useChatStore = create<ChatState>((set) => ({
  // 初始状态
  conversations: [],
  currentId: null,
  messages: [],
  systemPrompt: "",
  loading: false,
  justCreatedId: null,
  currentKbId: null,
  knowledgeBases: [],

  // === actions ===
  setCurrentId: (id) => {
    // 防循环更新：id 没变就不动（避免 URL→store→URL 死循环）
    set((state) => (state.currentId === id ? state : { currentId: id }));
  },

  setMessages: (messages) => set({ messages }),

  appendMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  // 流式追加：把最后一条消息的 content 设为传入的完整内容
  // （ChatBox 流式时累积完整内容后调这个，而不是每次 chunk 追加，简化逻辑）
  updateLastMessage: (content) =>
    set((state) => {
      if (state.messages.length === 0) return state;
      const next = [...state.messages];
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, content };
      return { messages: next };
    }),

  setLoading: (loading) => set({ loading }),

  setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),

  setJustCreatedId: (id) => set({ justCreatedId: id }),

  setCurrentKbId: (kbId) => set({ currentKbId: kbId }),

  setKnowledgeBases: (kbs) => set({ knowledgeBases: kbs }),

  setConversations: (conversations) => set({ conversations }),

  // 从后端拉取最新会话列表写进 store
  // 注意：action 里可以直接用 fetch（Zustand 的 action 是普通函数，能发异步请求）
  refreshConversations: async () => {
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) return;
      const data = await res.json();
      set({ conversations: data.conversations as Conversation[] });
    } catch {
      // 静默失败，列表不更新也不影响聊天
    }
  },

  // 阶段 15：拉取最新知识库列表
  refreshKnowledgeBases: async () => {
    try {
      const res = await fetch("/api/knowledge");
      if (!res.ok) return;
      const data = await res.json();
      set({ knowledgeBases: data.knowledgeBases as KnowledgeBase[] });
    } catch {
      // 静默失败
    }
  },
}));
