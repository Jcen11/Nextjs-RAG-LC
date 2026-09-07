// POST /api/conversations  ——  新建一个空会话
//
// 请求体：{ systemPrompt?: string }
// 返回：{ id: string, title: "", systemPrompt: string }
//
// id 用 crypto.randomUUID() 生成（Web 标准 API，Node/浏览器都有），
// 产生形如 "f47ac10b-58cc-4372-a567-0e02b2c3d479" 的 UUID，作为 URL 标识。

import { createConversation, listConversations } from "@/lib/queries";
import { randomUUID } from "node:crypto";

// GET /api/conversations —— 列出所有会话（供侧边栏显示）
// 不含消息内容，只返回会话元信息（id/title/createdAt）
// 按 created_at DESC 排序（最新的在最前），由 listConversations 保证
export async function GET() {
  const conversations = await listConversations();
  return Response.json({ conversations });
}

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

  await createConversation({ id, systemPrompt });

  return Response.json({
    id,
    title: "",
    systemPrompt,
  });
}
