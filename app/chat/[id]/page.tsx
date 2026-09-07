// /chat/[id]  ——  打开一个已有会话（URL → store 桥梁）
//
// 动态路由：访问 /chat/abc 时 params.id = "abc"。
// 这个页面是服务端组件，负责把 URL 的 id 取出来，传给 SyncConversationId 同步进 store。
// store 更新 currentId 后，ChatBox 会自动加载该会话的历史。
//
// 为什么 SyncConversationId 要拆到单独文件：
// page.tsx 是服务端组件（要用 await params），但同步 store 需要客户端 hook。
// 拆到 components/SyncConversationId.tsx（标了 "use client"），两边各司其职。
//
// URL ↔ store 双向同步机制（见 14 文档）：
// - URL→store：SyncConversationId（本文件渲染它）
// - store→URL：Sidebar.handleSelect / ChatBox 新建会话时的 router.push

import ChatBox from "@/components/ChatBox";
import { SyncConversationId } from "@/components/SyncConversationId";

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
