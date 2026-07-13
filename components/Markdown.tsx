"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

// 按需注册常用语言：只有注册过的语言才有高亮，其他语言降级为纯文本（不报错）
// 这样比全量打包（refractor 全部语言）小很多
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";

SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("jsx", jsx);
SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("css", css);

// 代码块子组件：必须抽成独立组件，因为复制按钮需要自己的 state（"复制" ↔ "已复制"）
// 如果内联在 code() 函数里返回，无法持有 state（React 规定 hook 只能在组件顶层调用）
function CodeBlock({
  language,
  children,
}: {
  language: string;
  children: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      // 2 秒后恢复按钮文字
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板 API 在非 HTTPS / 非 localhost 环境可能失败，这里静默处理
    }
  }

  return (
    <div className="code-block-wrapper">
      <button className="copy-btn" onClick={handleCopy} type="button">
        {copied ? "已复制" : "复制"}
      </button>
      <SyntaxHighlighter
        style={oneDark}
        language={language}
        PreTag="div"
        customStyle={{
          borderRadius: "6px",
          fontSize: "13px",
          margin: "8px 0",
        }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}

export default function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // react-markdown v10 起，code 组件不再有 inline 参数
          // 区分行内代码和代码块的方式：看 className 里有没有 language-xxx
          // 行内代码（如 `var`）的 className 为空或不含 language-，正常渲染成 <code>
          // 代码块（如 ```js）会被 react-markdown 包在 <pre> 里，className 形如 language-js
          // pre 的全称可以理解为 preformatted text，意思是"预格式化文本"。特点是：会保留空格 会保留换行 常用于显示代码、文本块
          code(props) {
            const { children, className, node, ...rest } = props;
            const match = /language-(\w+)/.exec(className || "");
            const lang = match ? match[1] : "";

            // 没有 language- 标记 → 当作行内代码处理
            if (!lang) {
              return (
                <code className={className} {...rest}>
                  {children}
                </code>
              );
            }

            /* 旧：直接用 SyntaxHighlighter 高亮，没有复制按钮
            return (
              <SyntaxHighlighter
                style={oneDark}
                language={lang}
                PreTag="div"
                customStyle={{
                  borderRadius: "6px",
                  fontSize: "13px",
                  margin: "8px 0",
                }}
              >
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            );
            */

            // 新：用 CodeBlock 子组件包裹，带复制按钮
            return (
              <CodeBlock language={lang}>
                {String(children).replace(/\n$/, "")}
              </CodeBlock>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

