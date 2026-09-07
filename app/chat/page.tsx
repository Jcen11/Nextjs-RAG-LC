// /chat  ——  无 id 入口，对应"新建会话"
//
// 访问 /chat 时清空 store.currentId，让 ChatBox 进入"新建会话"模式。
// ClearCurrentId 是客户端组件（标了 "use client"），负责调 store。
// ChatBox 不传 conversationId prop，自己从 store 读 currentId。

import ChatBox from "@/components/ChatBox";
import { ClearCurrentId } from "@/components/SyncConversationId";

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
