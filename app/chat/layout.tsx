// /chat 路由的共享布局
//
// 这个 layout 只包裹 /chat 和 /chat/[id]，不影响首页（/）和 about 页。
// 布局结构：左侧 Sidebar + 右侧聊天区（children）
//
// 为什么用 layout 而不是每个页面都写一遍 Sidebar：
// 1. 复用——/chat 和 /chat/[id] 共用同一个侧边栏
// 2. 持久化——切换路由时 layout 不重新 mount，Sidebar 的状态（如正在重命名）保留
// 3. 不闪烁——侧边栏在路由切换时不会重新加载

import Sidebar from "@/components/Sidebar";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="chat-shell">
      <Sidebar />
      <div className="chat-main">{children}</div>
    </div>
  );
}
