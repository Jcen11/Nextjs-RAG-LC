// /chat  ——  无 id 入口，对应"新建会话"
//
// 访问 /chat 时把 store.currentId 清空，让 ChatBox 进入"新建会话"模式。
// （和 /chat/[id]/page.tsx 的 SyncConversationId 对称：那里是"设 currentId"，这里是"清 currentId"）
//
// ChatBox 不传 conversationId prop，自己从 store 读 currentId。

import ChatBox from "@/components/ChatBox";
import { useChatStore } from "@/lib/store";
import { useEffect } from "react";

// 客户端组件：把 store.currentId 清空（标记"当前没有选中会话 = 新建会话"）
function ClearCurrentId() {
  const setCurrentId = useChatStore((s) => s.setCurrentId);

  useEffect(() => {
    setCurrentId(null);
  }, [setCurrentId]);

  return null; // 只做副作用，不渲染
}

export default function ChatPage() {
  return (
    <main>
      <h1>最小聊天页面</h1>
      <p>这个页面演示客户端状态、表单输入、调用 Next.js API 和流式显示回复。</p>
      <ClearCurrentId />
      <ChatBox />
    </main>
  );
}
