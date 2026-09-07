// POST /api/conversations  ——  新建一个空会话
//
// 请求体：{ systemPrompt?: string }
// 返回：{ id: string, title: "", systemPrompt: string }
//
// id 用 crypto.randomUUID() 生成（Web 标准 API，Node/浏览器都有），
// 产生形如 "f47ac10b-58cc-4372-a567-0e02b2c3d479" 的 UUID，作为 URL 标识。

import { createConversation } from "@/lib/queries";
import { randomUUID } from "node:crypto";

export async function POST(request: Request) {
  let systemPrompt = "";

  try {
    const body = await request.json();
    if (typeof body?.systemPrompt === "string") {
      systemPrompt = body.systemPrompt;
    }
  } catch {
    // 没有请求体或非 JSON，按无 systemPrompt 处理（不报错）
  }

  const id = randomUUID();

  createConversation({ id, systemPrompt });

  return Response.json({
    id,
    title: "",
    systemPrompt,
  });
}
