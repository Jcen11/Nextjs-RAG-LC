// /chat/[id]  ——  打开一个已有的会话（从 URL 取 id）
//
// 这是 Next.js App Router 的动态路由：文件名 [id] 里的 [id] 是动态段，
// 访问 /chat/abc-123 时，params.id = "abc-123"。
//
// 这个页面是服务端组件，只负责把 id 取出来传给 ChatBox。
// ChatBox 是客户端组件，负责加载历史、发消息、保存。

import ChatBox from "@/components/ChatBox";

type Params = { params: Promise<{ id: string }> };

export default async function ChatByIdPage({ params }: Params) {
  const { id } = await params;

  return (
    <main>
      <h1>聊天（会话 {id.slice(0, 8)}…）</h1>
      <p>这个会话的历史会从数据库加载，刷新页面也不丢。</p>
      <ChatBox conversationId={id} />
    </main>
  );
}
