// 根布局（阶段 17 美化）
// 用 Tailwind 类做全屏 flex 布局：header 固定顶部，内容区撑满剩余高度
// 替代了之前"纯文字 header/footer + main padding"的简陋结构
import "./globals.css";

export const metadata = {
  title: "AI 知识库助手",
  description: "基于 LangChain + RAG 的 AI 聊天与文档问答应用",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="h-screen flex flex-col bg-background text-foreground antialiased">
        <header className="h-14 flex-shrink-0 flex items-center px-6 border-b border-border bg-card">
          <span className="text-base font-semibold">AI 知识库助手</span>
          <span className="ml-3 text-xs text-muted-foreground">
            LangChain + RAG
          </span>
        </header>
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </body>
    </html>
  );
}
