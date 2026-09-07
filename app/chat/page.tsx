// /chat  ——  无 id 入口，对应"新建会话"
//
// ChatBox 不传 conversationId，用户首次发送时会先 POST 创建会话，
// 再用 router.push 跳到 /chat/[id]，URL 更新后刷新也能恢复。

import ChatBox from "@/components/ChatBox";

export default function ChatPage() {
  return (
    <main>
      <h1>最小聊天页面</h1>
      <p>这个页面演示客户端状态、表单输入、调用 Next.js API 和流式显示回复。</p>
      <ChatBox />
    </main>
  );
}
