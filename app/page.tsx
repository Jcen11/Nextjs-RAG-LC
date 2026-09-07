import Link from 'next/link'
import Counter from '../components/Counter'

export default function HomePage() {
  return (
    <main>
      <h1>欢迎学习 Next.js App Router</h1>

      <nav>
        <Link href="/about">去 About 页面</Link>
        <br />
        <Link href="/chat">去聊天页面</Link>
      </nav>

      <Counter />
    </main>
  )
}
