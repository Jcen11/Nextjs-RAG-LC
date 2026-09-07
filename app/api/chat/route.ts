const apiKey = process.env.SILICONFLOW_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL || "https://api.siliconflow.cn/v1";
const model = process.env.OPENAI_MODEL || "Qwen/Qwen3-8B";

// 上游连接超时：30 秒还没连上/没首字节，就当中断处理
const UPSTREAM_TIMEOUT_MS = 30000;

// 阶段 15：RAG 检索的 top-k（每次检索返回最相关的几个片段）
const RAG_TOP_K = 3;

export async function POST(request: Request) {
  /* 旧：直接 await request.json()，如果请求体不是合法 JSON 会抛错且无人接住
  const body = await request.json();
  const messages = body.messages;
  const system = body.system;
  */

  // 新：解析请求体加 try/catch，非法 JSON 直接返回 400
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        reply: "请求体不是合法的 JSON。",
      },
      { status: 400 },
    );
  }

  const messages = body.messages;
  const system = body.system;
  const kbId = typeof body.kbId === "string" ? body.kbId : null; // 阶段 15：RAG 知识库 id

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json(
      {
        reply: "没有收到有效的消息列表。",
      },
      { status: 400 },
    );
  }

  if (!apiKey) {
    return Response.json(
      {
        reply: "服务端还没有配置 SILICONFLOW_API_KEY。",
      },
      { status: 500 },
    );
  }

  // 阶段 15：RAG 前置——如果带了 kbId，检索相关片段拼进 system
  // 这一步在调用 LLM 之前完成，LLM 调用逻辑（下面的 fetch）零改动
  // 关键设计：RAG 只增强 system（注入知识上下文），不接管 chat 流程
  let finalSystem = typeof system === "string" ? system : "";

  if (kbId) {
    // 用最新一条 user 消息作为检索 query
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const query = lastUserMsg?.content;

    if (query) {
      try {
        const { retrieveContext, buildRagSystemPrompt } = await import("@/lib/rag");
        const context = await retrieveContext(kbId, query, RAG_TOP_K);
        if (context) {
          // 检索到了相关片段，拼进 system
          finalSystem = buildRagSystemPrompt(context, finalSystem);
        }
      } catch {
        // 检索失败不阻断对话，降级为普通对话（不带知识上下文）
        // 实际产品可以在这里加日志，监控 RAG 失败率
      }
    }
  }

  // 如果带了 system 提示词（可能含 RAG 上下文），拼到 messages 最前面
  // system 是协议层的概念，由后端组装更合理；前端 messages 数组保持只装对话历史
  const messagesWithSystem =
    finalSystem.trim()
      ? [{ role: "system", content: finalSystem }, ...messages]
      : messages;

  // 新：一个 AbortController 同时管两件事——"上游超时"和"客户端中断"
  // - 30 秒上游没响应 → setTimeout 触发 abort（防止请求一直挂着）
  // - 客户端点"停止" → request.signal 触发 → 同步 abort 上游 fetch
  const upstreamController = new AbortController();
  const timeoutId = setTimeout(() => {
    upstreamController.abort();
  }, UPSTREAM_TIMEOUT_MS);
  const onClientAbort = () => upstreamController.abort();
  request.signal.addEventListener("abort", onClientAbort);

  /* 旧：fetch 没有 signal，连不上游或卡住时只能干等
  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: messagesWithSystem,
      stream: true,
    }),
  });
  */

  // 新：fetch 包 try/catch + signal；连不上 / 超时 / 客户端中断都能接住
  let response: Response;
  try {
    response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: messagesWithSystem,
        stream: true,
      }),
      signal: upstreamController.signal,
    });
  } catch {
    clearTimeout(timeoutId);
    request.signal.removeEventListener("abort", onClientAbort);
    // 区分：是超时/中断（我们主动 abort），还是真网络错误
    const aborted = upstreamController.signal.aborted;
    return Response.json(
      {
        reply: aborted ? "请求超时或已中断。" : "无法连接到上游 AI 服务。",
      },
      { status: aborted ? 504 : 502 },
    );
  }

  // 连上了：清理超时定时器，避免误杀已经在正常流的请求
  clearTimeout(timeoutId);

  if (!response.ok) {
    /* 旧：直接 await response.json()，上游返回非 JSON 错误体时会再次抛错
    const data = await response.json();

    return Response.json(
      {
        reply: `上游接口报错：${data?.error?.message || "未知错误"}`,
      },
      { status: 500 },
    );
    */

    // 新：错误体也做容错，解析失败就给个兜底文案
    let errorText = "未知错误";
    try {
      const data = await response.json();
      errorText = data?.error?.message || errorText;
    } catch {
      // 上游返回的不是 JSON（比如 HTML 错误页），维持"未知错误"
    }
    request.signal.removeEventListener("abort", onClientAbort);
    return Response.json(
      {
        reply: `上游接口报错：${errorText}`,
      },
      { status: 500 },
    );
  }

  if (!response.body) {
    request.signal.removeEventListener("abort", onClientAbort);
    return Response.json(
      {
        reply: "上游接口没有返回流式内容。",
      },
      { status: 500 },
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let buffer = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();

            if (!trimmedLine || !trimmedLine.startsWith("data:")) {
              continue;
            }

            const jsonText = trimmedLine.slice(5).trim();

            if (jsonText === "[DONE]") {
              controller.close();
              return;
            }

            /* 旧：直接 JSON.parse，一行坏数据会让整条流崩掉
            const data = JSON.parse(jsonText);
            */

            // 新：单行容错，解析失败的行直接跳过，不影响后续行
            let data;
            try {
              data = JSON.parse(jsonText);
            } catch {
              continue;
            }

            const content = data.choices?.[0]?.delta?.content;

            if (typeof content === "string" && content) {
              controller.enqueue(encoder.encode(content));
            }
          }
        }

        controller.close();
      } catch {
        controller.error(new Error("解析流式响应失败。"));
      } finally {
        reader.releaseLock();
        request.signal.removeEventListener("abort", onClientAbort);
      }
    },
    // 新：客户端取消响应流（比如点"停止"）→ 取消上游读取，立刻释放连接
    cancel() {
      reader.cancel();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
