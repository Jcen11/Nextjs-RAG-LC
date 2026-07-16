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
import type { Conversation } from "@/lib/queries";

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

  // actions —— 状态操作函数
  setCurrentId: (id: string | null) => void;
  setMessages: (messages: Message[]) => void;
  appendMessage: (message: Message) => void;
  updateLastMessage: (content: string) => void; // 流式追加用：更新最后一条的 content
  setLoading: (loading: boolean) => void;
  setSystemPrompt: (prompt: string) => void;

  // 会话列表操作（从 API 拉数据后更新 store，供 Sidebar 用）
  setConversations: (conversations: Conversation[]) => void;
};

export const useChatStore = create<ChatState>((set) => ({
  // 初始状态
  conversations: [],
  currentId: null,
  messages: [],
  systemPrompt: "",
  loading: false,

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

  setConversations: (conversations) => set({ conversations }),
}));
