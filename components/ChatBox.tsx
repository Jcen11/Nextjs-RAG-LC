"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Markdown from "./Markdown";

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
  id?: number; // 新：从数据库加载的消息有 id（自增主键），新建的消息暂无
};

// 新：组件接收可选的 conversationId
// - 有 id（从 /chat/[id] 进入）：mount 时加载历史
// - 无 id（从 /chat 进入）：首次发送时创建会话，拿到 id 后跳转 URL
export default function ChatBox({ conversationId }: { conversationId?: string }) {
// 等价于function ChatBox(props: { conversationId?: string }) 后面取props.conversationId，但解构更简洁
  const router = useRouter();
  const [input, setInput] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [systemOpen, setSystemOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  // 新：标记"这个 conversationId 是本地刚创建的，useEffect 别去取历史"
  // 解决"新建会话首条消息被吃掉"的竞态 bug（详见 12b 文档）
  const justCreatedRef = useRef(false);

  // 新：mount 时（或 conversationId 变化时）从数据库加载历史
  // 依赖数组 [conversationId] 表示只在 conversationId 变化时重新加载
  useEffect(() => {
    if (!conversationId) {
      // 无 id = 新会话，清空状态
      setMessages([]);
      setSystemPrompt("");
      return;
    }

    // 新：如果是本地刚创建的会话，跳过加载历史（数据库里还是空的，
    // 而且本地 state 已经有正在进行的对话，取历史会覆盖掉——这是 bug 根因）
    if (justCreatedRef.current) {
      justCreatedRef.current = false; // 用完复位
      return;
    }

    // 有 id = 加载历史。用 async 函数包一层，因为 useEffect 本身不能是 async
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}`);
        if (!res.ok) {
          return;
        }
        const data = await res.json();
        if (cancelled) {
          return; // 组件卸载了就别再 setState（避免 React 警告）
        }
        setMessages(
          data.messages.map((m: { id: number; role: string; content: string }) => ({
            id: m.id,
            role: m.role as Message["role"],
            content: m.content,
          })),
        );
        if (data.conversation?.systemPrompt) {
          setSystemPrompt(data.conversation.systemPrompt);
        }
      } catch {
        // 加载失败静默处理，用户会看到空会话（不影响发新消息）
      }
    })();

    // cleanup：如果 conversationId 变化或组件卸载时请求还没回，标记取消
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // 新：保存当前请求的 AbortController，停止时调它的 abort()
  // 用 ref 而不是 state——它不该触发重渲染，只是个"遥控器"
  //
  // 为什么需要这个 ref（核心）：
  //   controller 是在 handleSend 里创建的（局部变量），但"停止"按钮点的是
  //   handleStop——这是两个独立的函数，handleStop 拿不到 handleSend 的局部变量。
  //   abortRef 就是个"共享盒子"：handleSend 创建 controller 后放进盒子，
  //   handleStop 从盒子里取出来按 abort()，从而跨函数共享同一个 controller。
  //   没有这个 ref，点"停止"时盒子是空的，啥也中断不了。
  const abortRef = useRef<AbortController | null>(null);

  // 新：点"停止"时调用，中断正在进行的请求
  // 这里的 abortRef.current 就是 handleSend 里放进去的那个 controller
  // ?. 是因为初始值是 null（还没发送过），取不到就什么都不做
  function handleStop() {
    abortRef.current?.abort();
  }

  async function handleSend() {
    const text = input.trim();

    if (!text) {
      return;
    }

    // 新：首次发送时若无 conversationId，先创建会话
    // 创建成功后用 router.push 更新 URL 到 /chat/[id]
    // 这样刷新页面也能恢复，且当前会话有了"身份"
    let activeConvId = conversationId;
    if (!activeConvId) {
      try {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemPrompt: systemPrompt.trim() || undefined,
          }),
        });
        if (!res.ok) {
          return;
        }
        const data = await res.json();
        activeConvId = data.id;
        // 新：打标记——告诉即将触发的 useEffect"这个 id 是本地刚建的，别去取历史"
        // 必须在 router.push 之前设置，因为 push 会同步触发 useEffect 重跑
        justCreatedRef.current = true;
        // 更新 URL（不触发整页刷新，走客户端导航）
        router.push(`/chat/${activeConvId}`);
      } catch {
        return;
      }
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
    // 步骤①：造一个新遥控器（每个请求一个独立的 controller）
    const controller = new AbortController();
    // 步骤②：把遥控器放进共享盒子 abortRef，这样 handleStop 才能拿到它
    abortRef.current = controller;

    // 新：标记这轮是否正常完成（用于决定是否保存到数据库）
    // - 正常 break 出 while 循环 = true → 保存
    // - 中止/出错进 catch = false → 不保存
    // 声明在 try 外面，finally 才能访问到
    let completedNormally = false;
    // 同理，assistant 累积内容也提到外面，finally 保存时要用
    let assistantContent = "";

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
        // 步骤③：把 controller 和 fetch 绑定（给 fetch 挂号）
        // 之后只要 controller.abort() 被调用，这个 fetch 就会立刻中断
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

      // assistantContent 已在 try 外声明（finally 要用），这里直接累加

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });

        if (!chunk) {
          continue;
        }

        assistantContent += chunk; // 同步累积，供 finally 保存用

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

      // 走到这里说明 while 正常结束（流读完），标记为可保存
      completedNormally = true;
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
      // 步骤④：请求结束（正常完成/被中止/出错都走这里），清空盒子
      // 清掉是为了让下次发送放新的 controller，避免误用到旧的
      abortRef.current = null;
      setLoading(false);

      // 新：只有正常完成时才保存到数据库
      // 中止/出错时 completedNormally 仍为 false，跳过保存
      // （这是简化处理；理想方案见 待学与待办.md 的"后端 tee 边写边存"改进点）
      if (completedNormally && activeConvId && text && assistantContent) {
        // 用 fire-and-forget：保存失败不影响用户继续聊天，最多丢失这一轮历史
        fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: activeConvId,
            userMessage: text,
            assistantMessage: assistantContent,
          }),
        }).catch(() => {
          // 保存失败静默处理（实际产品里可以加 toast 提示）
        });
      }
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
        {/* 旧：清空当前消息（仅本地，刷新后还在）
        <button
          className="clear-btn"
          onClick={() => setMessages([])}
          disabled={loading || messages.length === 0}
          type="button"
        >
          清空
        </button>
        */}
        {/* 新：新建会话——跳到 /chat（无 id），触发全新会话流程 */}
        <button
          className="clear-btn"
          onClick={() => router.push("/chat")}
          disabled={loading}
          type="button"
        >
          新建会话
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
            key={message.id ?? index}
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
