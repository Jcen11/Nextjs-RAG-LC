// /chat/[id]  ——  打开一个已有会话（URL → store 桥梁）
//
// 动态路由：访问 /chat/abc 时 params.id = "abc"。
// 这个页面只负责把 URL 里的 id 同步到全局 store（URL → store 方向）。
// store 更新 currentId 后，ChatBox 会自动加载该会话的历史。
//
// 为什么用 SyncConversationId 子组件而不是直接在 page 里调 store：
// - page.tsx 是服务端组件，不能直接用 Zustand（store 是客户端 hook）
// - 抽一个 client component 做同步，page 渲染它
//
// URL ↔ store 双向同步机制（见 14 文档）：
// - URL→store：本文件的 SyncConversationId（用户访问/刷新/前进后退 URL）
// - store→URL：Sidebar.handleSelect / ChatBox 新建会话时的 router.push

import ChatBox from "@/components/ChatBox";
import { useChatStore } from "@/lib/store";
import { useEffect } from "react";

// 客户端组件：收到 id prop，同步进 store
function SyncConversationId({ id }: { id: string }) {
  const setCurrentId = useChatStore((s) => s.setCurrentId);

  useEffect(() => {
    setCurrentId(id);
  }, [id, setCurrentId]);

  return null; // 不渲染任何东西，只做副作用（同步）
}

type Params = { params: Promise<{ id: string }> };

export default async function ChatByIdPage({ params }: Params) {
  const { id } = await params;

  return (
    <main className="chat-main-inner">
      <SyncConversationId id={id} />
      <ChatBox />
    </main>
  );
}
