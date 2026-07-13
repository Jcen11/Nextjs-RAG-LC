"use client";

import { useRef, useState } from "react";
import Markdown from "./Markdown";

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

export default function ChatBox() {
  const [input, setInput] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [systemOpen, setSystemOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  // 新：保存当前请求的 AbortController，停止时调它的 abort()
  // 用 ref 而不是 state——它不该触发重渲染，只是个"遥控器"
  const abortRef = useRef<AbortController | null>(null);

  // 新：点"停止"时调用，中断正在进行的请求
  function handleStop() {
    abortRef.current?.abort();
  }

  async function handleSend() {
    const text = input.trim();

    if (!text) {
      return;
    }

    const userMessage: Message = {
      role: "user",
      content: text,
    };

    // 先构造要发给后端的完整历史：旧消息 + 这条新 user 消息
    // 必须在 setMessages 加空 assistant 占位之前构造，否则会把空占位也发给 AI
    const messagesToSend = [...messages, userMessage];

    const assistantMessage: Message = {
      role: "assistant",
      content: "",
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput("");
    setLoading(true);

    // 新：每次发送都新建一个 AbortController，存到 ref 供"停止"按钮调用
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: messagesToSend,
          system: systemPrompt.trim() || undefined,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = await response.json();

        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: data.reply || "请求失败。",
          };
          return next;
        });
        return;
      }

      const reader = response.body?.getReader();

      if (!reader) {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: "没有收到流式响应。",
          };
          return next;
        });
        return;
      }

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });

        if (!chunk) {
          continue;
        }

        setMessages((prev) => {
          const next = [...prev];
          const lastMessage = next[next.length - 1];

          next[next.length - 1] = {
            ...lastMessage,
            content: lastMessage.content + chunk,
          };

          return next;
        });
      }
    } catch (error: unknown) {
      // 新：区分两种情况——
      // 1) 用户主动中止：controller.signal.aborted 为 true
      //    → 不报错，保留已经生成的部分（可能用户只是不想等了，前面的话还有用）
      // 2) 其它异常（网络断开、超时、服务端崩了）→ 给错误提示
      /* 旧：catch 不区分原因，一律显示"请求过程中发生异常"
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          content: "请求过程中发生异常。",
        };
        return next;
      });
      */

      const aborted = controller.signal.aborted;

      setMessages((prev) => {
        const next = [...prev];
        const lastMessage = next[next.length - 1];

        if (aborted) {
          // 主动中止：若已生成了内容就补一个"（已停止）"标记，否则提示已取消
          next[next.length - 1] = {
            ...lastMessage,
            content:
              lastMessage.content.trim().length > 0
                ? `${lastMessage.content}\n\n_（已停止）_`
                : "_（已取消）_",
          };
        } else {
          // 非主动中止：判断是不是网络问题，给更具体的提示
          const isNetworkError =
            error instanceof TypeError && error.message === "Failed to fetch";
          next[next.length - 1] = {
            role: "assistant",
            content: isNetworkError
              ? "网络连接失败，请检查网络后重试。"
              : "请求过程中发生异常，请重试。",
          };
        }

        return next;
      });
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }

  return (
    <section>
      {/* 旧：system 输入框无条件显示
      <div>
        <textarea
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          placeholder="系统提示词（可选）：比如 你是一个友好的助手，回答要简洁"
          rows={2}
        />
      </div>
      */}

      {/* 新：system 输入框可折叠，默认收起 */}
      <div>
        <button
          className="system-toggle"
          onClick={() => setSystemOpen((open) => !open)}
          type="button"
        >
          {systemOpen ? "▼ 系统提示词" : "▶ 系统提示词"}
          {systemPrompt.trim() && !systemOpen ? "（已设置）" : ""}
        </button>
        {systemOpen && (
          <textarea
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
            placeholder="系统提示词（可选）：比如 你是一个友好的助手，回答要简洁"
            rows={2}
          />
        )}
      </div>

      {/* 旧：输入框只有 onChange，无回车发送；只有发送按钮，无清空
      <div>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="请输入消息"
        />
        <button onClick={handleSend} disabled={loading}>
          {loading ? "发送中..." : "发送"}
        </button>
      </div>
      */}

      {/* 新：回车发送（Shift+Enter 不触发）+ 清空按钮 + 停止按钮 */}
      <div>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !loading) {
              event.preventDefault();
              handleSend();
            }
          }}
          placeholder="请输入消息（回车发送）"
        />
        <button onClick={handleSend} disabled={loading}>
          {loading ? "发送中..." : "发送"}
        </button>
        {/* 新：loading 时显示"停止"按钮，点击中断当前生成 */}
        {loading && (
          <button className="stop-btn" onClick={handleStop} type="button">
            停止
          </button>
        )}
        <button
          className="clear-btn"
          onClick={() => setMessages([])}
          disabled={loading || messages.length === 0}
          type="button"
        >
          清空
        </button>
      </div>

      {/* 旧：消息纯文本显示，不区分 user/assistant 样式，AI 回复的 Markdown 标记原样可见
      <ul>
        {messages.map((message, index) => (
          <li key={index}>
            <strong>{message.role === "user" ? "你" : "机器人"}：</strong>
            {message.content}
          </li>
        ))}
      </ul>
      */}

      {/* 新：assistant 消息用 Markdown 渲染，user 消息仍纯文本，并区分消息样式 */}
      <ul>
        {messages.map((message, index) => (
          <li
            key={index}
            className={message.role === "user" ? "msg-user" : "msg-assistant"}
          >
            <strong>{message.role === "user" ? "你" : "机器人"}：</strong>
            {message.role === "assistant" ? (
              <Markdown content={message.content} />
            ) : (
              message.content
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
