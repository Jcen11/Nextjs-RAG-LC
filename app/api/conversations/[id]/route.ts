// GET  /api/conversations/[id]  ——  取一个会话的所有消息（用于页面加载时恢复历史）
// DELETE /api/conversations/[id]  ——  删除一个会话（外键 CASCADE 会连带删消息）

import {
  getConversation,
  getMessages,
  deleteConversation,
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

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;

  const conversation = getConversation(id);
  if (!conversation) {
    return Response.json({ error: "会话不存在" }, { status: 404 });
  }

  deleteConversation(id);

  return Response.json({ ok: true });
}
