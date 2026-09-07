// 阶段 16（路线 B 重构）：用 LangChain 的 ChatOpenAI 替代裸 fetch SSE
//
// 重写部分：LLM 调用 + 流式解析
// 保留部分：请求体解析、RAG 前置（这两部分和裸 fetch 版完全一样）
//
// 重构核心对比（详见 16.路线B重构.md）：
// - 旧（裸 fetch）：自己拼 SSE 请求体、自己解析 data: 行、自己处理 [DONE]
// - 新（ChatOpenAI）：model.stream(messages) 返回 async iterable，遍历取 .content
// - 中断：旧用 AbortController + fetch signal；新用 { signal } 传给 model.stream
//
// 为什么重构：
// 1. 统一抽象——chat 和 RAG 都用 LangChain，代码风格一致
// 2. 减少手写解析——不用再处理 SSE 协议细节（data: 行、[DONE]、JSON.parse 容错）
// 3. 简历价值——"对比过裸 fetch 和 LangChain 两种实现，理解了两者的差异"

import {
  HumanMessage,
  AIMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { model } from "@/lib/langchain";

const apiKey = process.env.SILICONFLOW_API_KEY;

// 上游连接超时：30 秒还没连上/没首字节，就当中断处理
const UPSTREAM_TIMEOUT_MS = 30000;

// 阶段 15：RAG 检索的 top-k
const RAG_TOP_K = 3;

// 把前端发来的 {role, content} 数组转成 LangChain 的 Message 对象
// LangChain 的消息类型比 OpenAI 的 role 字符串更严格（有专门的类）
function toLangChainMessages(
  messages: { role: string; content: string }[],
  systemPrompt?: string,
) {
  const result = [];

  if (systemPrompt && systemPrompt.trim()) {
    result.push(new SystemMessage(systemPrompt));
  }

  for (const m of messages) {
    if (m.role === "user") {
      result.push(new HumanMessage(m.content));
    } else if (m.role === "assistant") {
      result.push(new AIMessage(m.content));
    }
    // system 角色由 systemPrompt 参数单独处理，这里跳过
  }

  return result;
}

export async function POST(request: Request) {
  // === 请求体解析（这部分和裸 fetch 版完全一样，不改）===
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { reply: "请求体不是合法的 JSON。" },
      { status: 400 },
    );
  }

  const messages = body.messages;
  const system = body.system;
  const kbId = typeof body.kbId === "string" ? body.kbId : null;

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json(
      { reply: "没有收到有效的消息列表。" },
      { status: 400 },
    );
  }

  if (!apiKey) {
    return Response.json(
      { reply: "服务端还没有配置 SILICONFLOW_API_KEY。" },
      { status: 500 },
    );
  }

  // === RAG 前置（这部分和裸 fetch 版完全一样，不改）===
  let finalSystem = typeof system === "string" ? system : "";

  if (kbId) {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const query = lastUserMsg?.content;

    if (query) {
      try {
        const { retrieveContext, buildRagSystemPrompt } = await import("@/lib/rag");
        const context = await retrieveContext(kbId, query, RAG_TOP_K);
        if (context) {
          finalSystem = buildRagSystemPrompt(context, finalSystem);
        }
      } catch {
        // 检索失败降级为普通对话
      }
    }
  }

  // 把前端消息 + system（可能含 RAG 上下文）转成 LangChain 消息对象
  const langchainMessages = toLangChainMessages(messages, finalSystem);

  // === 中断控制（和裸 fetch 版思路一样：超时 + 客户端中断联动）===
  const upstreamController = new AbortController();
  const timeoutId = setTimeout(() => {
    upstreamController.abort();
  }, UPSTREAM_TIMEOUT_MS);
  const onClientAbort = () => upstreamController.abort();
  request.signal.addEventListener("abort", onClientAbort);

  /* ============================================================
   * 旧（阶段 4-15）：裸 fetch + 手动 SSE 解析
   * 详见 git 历史的 ad2b664 提交，或对比 Nextjs-RAG 项目
   * ============================================================
   *
   * // 1. 手动拼 fetch 请求
   * const response = await fetch(`${baseURL}/chat/completions`, {
   *   method: "POST",
   *   headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
   *   body: JSON.stringify({ model, messages: messagesWithSystem, stream: true }),
   *   signal: upstreamController.signal,
   * });
   *
   * // 2. 手动解析 SSE 流（data: 行、[DONE]、JSON.parse 容错）
   * const reader = response.body.getReader();
   * while (true) {
   *   const { done, value } = await reader.read();
   *   if (done) break;
   *   buffer += decoder.decode(value, { stream: true });
   *   const lines = buffer.split("\n");
   *   buffer = lines.pop() || "";
   *   for (const line of lines) {
   *     if (!line.startsWith("data:")) continue;
   *     const jsonText = line.slice(5).trim();
   *     if (jsonText === "[DONE]") { controller.close(); return; }
   *     const data = JSON.parse(jsonText);  // 还要 try/catch 容错
   *     const content = data.choices?.[0]?.delta?.content;
   *     if (content) controller.enqueue(encoder.encode(content));
   *   }
   * }
   *
   * ============================================================
   * 新（阶段 16）：ChatOpenAI.stream —— 不用碰 SSE 协议细节
   * ============================================================
   */

  // 调 LangChain 的 stream，拿到 async iterable
  let stream;
  try {
    stream = await model.stream(langchainMessages, {
      signal: upstreamController.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    request.signal.removeEventListener("abort", onClientAbort);
    // 区分：中断/超时 vs 真错误
    const aborted = upstreamController.signal.aborted;
    if (aborted) {
      return Response.json(
        { reply: "请求超时或已中断。" },
        { status: 504 },
      );
    }
    return Response.json(
      {
        reply: `无法连接到上游 AI 服务：${err instanceof Error ? err.message : "未知错误"}`,
      },
      { status: 502 },
    );
  }

  // 连上了：清理超时定时器
  clearTimeout(timeoutId);

  // 把 LangChain 的 async iterable 转成 Web ReadableStream 返回给前端
  // 前端读取方式不变（response.body.getReader() + decoder.decode）
  const encoder = new TextEncoder();

  const webStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // ChatOpenAI.stream 返回的 iterable，遍历拿 AIMessageChunk
        // 每个 chunk.content 是这轮新增的文本片段
        for await (const chunk of stream) {
          const content = chunk.content;
          if (typeof content === "string" && content) {
            controller.enqueue(encoder.encode(content));
          }
        }
        controller.close();
      } catch (err) {
        // 中断时 LangChain 抛 AbortError（DOMException）
        // 这种情况下流正常结束（前端知道是用户主动停的），不当错误处理
        if (
          err instanceof Error &&
          (err.name === "AbortError" || upstreamController.signal.aborted)
        ) {
          controller.close();
        } else {
          controller.error(new Error("解析流式响应失败。"));
        }
      } finally {
        request.signal.removeEventListener("abort", onClientAbort);
      }
    },
    // 客户端取消（点"停止"）→ 触发 request.signal abort → 联动 upstreamController
    // → model.stream 抛 AbortError → 上面的 catch 捕获 → controller.close()
    cancel() {
      upstreamController.abort();
    },
  });

  return new Response(webStream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
