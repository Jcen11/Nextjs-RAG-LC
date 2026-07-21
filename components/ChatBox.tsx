"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Markdown from "./Markdown";
import KbSelector from "./KbSelector";
import { useChatStore, type Message } from "@/lib/store";
// 阶段 17：引入 shadcn/ui 组件美化界面（共存策略，老 CSS 不动）
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";

// ChatBox 不再接收 conversationId prop——改从全局 store 读 currentId
// 这是阶段 14（全局状态管理）的改造，根治"组件卸载重建导致 messages 丢失"的 bug。
// 详见 12b 文档（debug 过程）和 14 文档（Zustand 设计）。
export default function ChatBox() {
  const router = useRouter();

  // 从 store 读状态（组件重建后这些值还在，因为存在组件外的 store 里）
  const currentId = useChatStore((s) => s.currentId);
  const messages = useChatStore((s) => s.messages);
  const systemPrompt = useChatStore((s) => s.systemPrompt);
  const loading = useChatStore((s) => s.loading);
  const currentKbId = useChatStore((s) => s.currentKbId); // 阶段 15：当前会话的知识库
  // 注意：justCreatedId 不用 selector 订阅，改在 useEffect 里用 getState() 实时读。
  // 原因：如果订阅它并放进 useEffect 依赖数组，清标记（setJustCreatedId(null)）会
  // 触发 useEffect 重跑，重跑时标记已清空、保护失效，走到加载历史分支覆盖 messages。
  // 用 getState() 读不建立订阅，清标记不会触发重跑。

  // 从 store 读 actions
  const setMessages = useChatStore((s) => s.setMessages);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const updateLastMessage = useChatStore((s) => s.updateLastMessage);
  const setLoading = useChatStore((s) => s.setLoading);
  const setSystemPrompt = useChatStore((s) => s.setSystemPrompt);
  const setJustCreatedId = useChatStore((s) => s.setJustCreatedId);
  const refreshConversations = useChatStore((s) => s.refreshConversations);
  const setCurrentKbId = useChatStore((s) => s.setCurrentKbId); // 阶段 15

  // 纯 UI 临时状态留在组件 useState（不必进 store）
  const [input, setInput] = useState("");
  const [systemOpen, setSystemOpen] = useState(false);

  // mount 时（或 currentId 变化时）从数据库加载历史
  // 依赖数组只放 [currentId]：currentId 变化时才该重新加载。
  // justCreatedId 故意不进依赖——它用 getState() 实时读，避免清标记触发重跑（详见下方注释）。
  useEffect(() => {
    // 新建会话保护：如果标记了 justCreatedId，说明是本地刚建的会话，
    // store.messages 已有用户消息（handleSend 写进去的），数据库还没存。
    // 跳过所有加载/清空逻辑——否则会拿到空数组覆盖掉 store.messages。
    // 用 getState() 实时读，不建立订阅：这样清标记（setJustCreatedId(null)）不会触发
    // useEffect 重跑。否则会形成"清标记→依赖变→重跑→标记已空→加载历史覆盖"的链条。
    const createdId = useChatStore.getState().justCreatedId;
    if (createdId) {
      // 标记还在 = 这是刚建的会话，别动 messages
      // 等 currentId 变成 createdId 后再清标记（确保 currentId=null 和 currentId=abc 两次都被拦住）
      if (currentId === createdId) {
        setJustCreatedId(null);
      }
      return;
    }

    if (!currentId) {
      // 无 id = 新会话，清空状态
      setMessages([]);
      setSystemPrompt("");
      setCurrentKbId(null); // 阶段 15：新建会话默认不绑定知识库
      return;
    }

    // 有 id = 加载历史。用 async 函数包一层，因为 useEffect 本身不能是 async
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/conversations/${currentId}`);
        if (!res.ok) {
          return;
        }
        const data = await res.json();
        if (cancelled) {
          return; // 组件卸载了就别再 setState（避免 React 警告）
        }
        setMessages(
          data.messages.map(
            (m: { id: number; role: string; content: string }) => ({
              id: m.id,
              role: m.role as Message["role"],
              content: m.content,
            }),
          ),
        );
        if (data.conversation?.systemPrompt) {
          setSystemPrompt(data.conversation.systemPrompt);
        }
        // 阶段 15：读出会话绑定的知识库 id，存进 store（决定发消息时是否走 RAG）
        setCurrentKbId(data.conversation?.kbId ?? null);
      } catch {
        // 加载失败静默处理，用户会看到空会话（不影响发新消息）
      }
    })();

    // cleanup：如果 currentId 变化或组件卸载时请求还没回，标记取消
    return () => {
      cancelled = true;
    };
    // 依赖只放 currentId：它变化时才该重新加载。
    // justCreatedId 不进依赖（用 getState 读），避免清标记触发重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  // 保存当前请求的 AbortController，停止时调它的 abort()
  // 用 ref 而不是 state——它不该触发重渲染，只是个"遥控器"
  //
  // 为什么需要这个 ref（核心）：
  //   controller 是在 handleSend 里创建的（局部变量），但"停止"按钮点的是
  //   handleStop——这是两个独立的函数，handleStop 拿不到 handleSend 的局部变量。
  //   abortRef 就是个"共享盒子"：handleSend 创建 controller 后放进盒子，
  //   handleStop 从盒子里取出来按 abort()，从而跨函数共享同一个 controller。
  //   没有这个 ref，点"停止"时盒子是空的，啥也中断不了。
  const abortRef = useRef<AbortController | null>(null);

  // 点"停止"时调用，中断正在进行的请求
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

    const userMessage: Message = {
      role: "user",
      content: text,
    };

    const assistantMessage: Message = {
      role: "assistant",
      content: "",
    };

    // 先构造要发给后端的完整历史：旧消息 + 这条新 user 消息
    // 必须在 setMessages 加空 assistant 占位之前构造，否则会把空占位也发给 AI
    const messagesToSend = [...messages, userMessage];

    // 关键顺序：先把消息写进 store，再处理新建会话 + router.push
    // 因为 router.push 会触发组件重建，useEffect 会跑——必须让 store.messages
    // 在 push 之前就有内容，配合 justCreatedId 标记拦住 useEffect 的清空/加载
    setMessages([...messages, userMessage, assistantMessage]);
    setInput("");
    setLoading(true);

    // 首次发送时若无 currentId，先创建会话
    let activeConvId = currentId;
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
        // 新建会话保护：标记这个 id 是刚建的，useEffect 看到就跳过加载历史
        // （数据库还没存消息，加载会拿到空数组覆盖掉 store.messages）
        // 必须在 router.push 之前设置，push 后 useEffect 会立刻检查它
        // 放 store 而不是 ref——ref 在组件实例内、重建会丢，store 跨实例存活
        setJustCreatedId(activeConvId);
        // 更新 URL（不触发整页刷新，走客户端导航）
        // 跳到 /chat/[id] 会让本组件重建，但 store.messages 已有内容 + justCreatedId 拦住 useEffect
        router.push(`/chat/${activeConvId}`);
      } catch {
        return;
      }
    }

    // 每次发送都新建一个 AbortController，存到 ref 供"停止"按钮调用
    // 步骤①：造一个新遥控器（每个请求一个独立的 controller）
    const controller = new AbortController();
    // 步骤②：把遥控器放进共享盒子 abortRef，这样 handleStop 才能拿到它
    abortRef.current = controller;

    // 标记这轮是否正常完成（用于决定是否保存到数据库）
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
          kbId: currentKbId ?? undefined, // 阶段 15：绑了知识库就走 RAG，否则纯对话
        }),
        // 步骤③：把 controller 和 fetch 绑定（给 fetch 挂号）
        // 之后只要 controller.abort() 被调用，这个 fetch 就会立刻中断
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = await response.json();

        /* 旧：直接用本地 setMessages 改（阶段 12）
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: data.reply || "请求失败。",
          };
          return next;
        });
        */
        // 新：用 store 的 updateLastMessage 更新最后一条
        updateLastMessage(data.reply || "请求失败。");
        return;
      }

      const reader = response.body?.getReader();

      if (!reader) {
        /* 旧：本地 setMessages
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: "没有收到流式响应。",
          };
          return next;
        });
        */
        updateLastMessage("没有收到流式响应。");
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

        /* 旧：本地 setMessages 追加 chunk（阶段 12）
        setMessages((prev) => {
          const next = [...prev];
          const lastMessage = next[next.length - 1];
          next[next.length - 1] = {
            ...lastMessage,
            content: lastMessage.content + chunk,
          };
          return next;
        });
        */
        // 新：用 store 的 updateLastMessage，传入累积后的完整 content
        // assistantContent 已经把所有 chunk 同步累加好了，整体替换最后一条的 content
        // （比旧的"每次读 prev 再拼接"更直接，因为 assistantContent 是同步变量）
        updateLastMessage(assistantContent);
      }

      // 走到这里说明 while 正常结束（流读完），标记为可保存
      completedNormally = true;
    } catch (error: unknown) {
      // 区分两种情况——
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

      // 新：用 store 更新最后一条消息
      // 注意：不能用上面渲染时捕获的 messages（闭包旧值），要用 getState() 读实时值
      // 因为 catch 执行时，流式已经更新过 store 多次，渲染闭包的 messages 是发送前的
      const lastContent =
        useChatStore.getState().messages.slice(-1)[0]?.content ?? "";
      if (aborted) {
        // 主动中止：若已生成了内容就补一个"（已停止）"标记，否则提示已取消
        updateLastMessage(
          lastContent.trim().length > 0
            ? `${lastContent}\n\n_（已停止）_`
            : "_（已取消）_",
        );
      } else {
        // 非主动中止：判断是不是网络问题，给更具体的提示
        const isNetworkError =
          error instanceof TypeError && error.message === "Failed to fetch";
        updateLastMessage(
          isNetworkError
            ? "网络连接失败，请检查网络后重试。"
            : "请求过程中发生异常，请重试。",
        );
      }
    } finally {
      // 步骤④：请求结束（正常完成/被中止/出错都走这里），清空盒子
      // 清掉是为了让下次发送放新的 controller，避免误用到旧的
      abortRef.current = null;
      setLoading(false);

      // 只有正常完成时才保存到数据库
      // 中止/出错时 completedNormally 仍为 false，跳过保存
      // （这是简化处理；理想方案见 待学与待办.md 的"后端 tee 边写边存"改进点）
      if (completedNormally && activeConvId && text && assistantContent) {
        try {
          await fetch("/api/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversationId: activeConvId,
              userMessage: text,
              assistantMessage: assistantContent,
            }),
          });
          // 保存成功，刷新侧边栏会话列表（让新会话标题立刻显示）
          // 直接刷新 store 的 conversations——Sidebar 订阅了它，会自动重渲染
          // （之前用 router.refresh 无效，因为它刷新服务端组件树，而 Sidebar 是客户端组件）
          await refreshConversations();
        } catch {
          // 保存失败静默处理
        }
      }
    }
  }

  return (
    // 阶段 17：用 Tailwind 做纵向 flex 布局——消息区滚动 + 底部输入栏固定
    // chat-main 已经是 flex-1，这里 section 撑满它的高度，内部纵向排列
    <section className="flex flex-col h-full">
      {/* 阶段 15：知识库选择器（选当前会话绑哪个知识库，决定是否走 RAG） */}
      <KbSelector conversationId={currentId} />

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
      <div className="px-1 py-2">
        <button
          className="system-toggle"
          onClick={() => setSystemOpen((open) => !open)}
          type="button"
        >
          {systemOpen ? "▼ 系统提示词" : "▶ 系统提示词"}
          {systemPrompt.trim() && !systemOpen ? "（已设置）" : ""}
        </button>
        {systemOpen && (
          <Textarea
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
      <div className="flex items-center gap-2 px-1 py-2 border-t border-border">
        <Input
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
        <Button onClick={handleSend} disabled={loading}>
          {loading ? "发送中..." : "发送"}
        </Button>
        {/* 新：loading 时显示"停止"按钮，点击中断当前生成 */}
        {loading && (
          <Button variant="destructive" onClick={handleStop} type="button">
            停止
          </Button>
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
        <Button
          variant="outline"
          onClick={() => router.push("/chat")}
          disabled={loading}
          type="button"
        >
          新建会话
        </Button>
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

      {/* 新：消息区用 ScrollArea 包裹，美化滚动条；内部消息样式沿用老 CSS（msg-user/msg-assistant） */}
      <ScrollArea className="flex-1 min-h-0 px-1">
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
      </ScrollArea>
    </section>
  );
}
