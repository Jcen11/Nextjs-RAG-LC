// GET  /api/conversations/[id]  ——  取一个会话的所有消息（用于页面加载时恢复历史）
// DELETE /api/conversations/[id]  ——  删除一个会话（外键 CASCADE 会连带删消息）

import {
  getConversation,
  getMessages,
  deleteConversation,
  updateConversationTitle,
} from "@/lib/queries";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;

  const conversation = getConversation(id);

  if (!conversation) {
    return Response.json({ error: "会话不存在" }, { status: 404 });
  }

  const messages = getMessages(id);

  return Response.json({ conversation, messages });
}

// PATCH /api/conversations/[id] —— 重命名会话
// 请求体：{ title: string }
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体不是合法的 JSON" }, { status: 400 });
  }

  if (typeof body?.title !== "string" || !body.title.trim()) {
    return Response.json({ error: "title 不能为空" }, { status: 400 });
  }

  const conversation = getConversation(id);
  if (!conversation) {
    return Response.json({ error: "会话不存在" }, { status: 404 });
  }

  updateConversationTitle(id, body.title.trim());

  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;

  const conversation = getConversation(id);
  if (!conversation) {
    return Response.json({ error: "会话不存在" }, { status: 404 });
  }

  deleteConversation(id);

  return Response.json({ ok: true });
}
