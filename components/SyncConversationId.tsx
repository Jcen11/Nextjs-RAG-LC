"use client";

// URL → store 同步组件
//
// 为什么需要单独的客户端组件文件：
// page.tsx 是服务端组件（要用 await params 取 URL 参数，这是服务端能力）。
// 但 Zustand store 是客户端 hook（依赖 React 客户端运行时），服务端组件用不了。
// 所以把"同步 id 进 store"的逻辑拆到这个标了 "use client" 的文件里，
// page.tsx 渲染它，它负责调 store。
//
// 这两个组件都不渲染任何 UI（return null），只做副作用（同步 id 进 store）。

import { useEffect } from "react";
import { useChatStore } from "@/lib/store";

// 访问 /chat/[id] 时：把 URL 的 id 同步进 store.currentId
export function SyncConversationId({ id }: { id: string }) {
  const setCurrentId = useChatStore((s) => s.setCurrentId);

  useEffect(() => {
    setCurrentId(id);
  }, [id, setCurrentId]);

  return null;
}

// 访问 /chat（无 id）时：清空 store.currentId（标记"当前没有选中会话 = 新建会话"）
export function ClearCurrentId() {
  const setCurrentId = useChatStore((s) => s.setCurrentId);

  useEffect(() => {
    setCurrentId(null);
  }, [setCurrentId]);

  return null;
}
