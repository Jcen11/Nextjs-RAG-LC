import './globals.css'

export const metadata = {
  title: 'Next.js Minimal App',
  description: 'A minimal Next.js App Router project for beginners'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <header>公共头部</header>
        {children}
        <footer>公共底部</footer>
      </body>
    </html>
  )
}
