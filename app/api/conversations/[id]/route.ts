// GET  /api/conversations/[id]  ——  取一个会话的所有消息（用于页面加载时恢复历史）
// DELETE /api/conversations/[id]  ——  删除一个会话（外键 CASCADE 会连带删消息）
// PATCH /api/conversations/[id]  ——  改会话属性（title 重命名 / kbId 绑定知识库）

import {
  getConversation,
  getMessages,
  deleteConversation,
  updateConversationTitle,
  setConversationKb,
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

// PATCH /api/conversations/[id] —— 改会话属性
// 请求体：{ title?: string, kbId?: string | null }
//   - 带 title：重命名
//   - 带 kbId：绑定知识库（null 解绑）
// 两个字段可单独传，也可同时传
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体不是合法的 JSON" }, { status: 400 });
  }

  const conversation = getConversation(id);
  if (!conversation) {
    return Response.json({ error: "会话不存在" }, { status: 404 });
  }

  // 处理 title（重命名）
  if (typeof body?.title === "string" && body.title.trim()) {
    updateConversationTitle(id, body.title.trim());
  }

  // 处理 kbId（绑定/解绑知识库）
  // 允许的值：字符串（绑定）、null（解绑）；undefined 表示没传这个字段，不动
  if (body && "kbId" in body) {
    const kbId =
      typeof body.kbId === "string" ? body.kbId : null;
    setConversationKb(id, kbId);
  }

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
