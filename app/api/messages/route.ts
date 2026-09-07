// POST /api/messages  ——  保存一轮对话（user 消息 + assistant 回复）
//
// 请求体：{
//   conversationId: string,
//   userMessage: string,        // 这轮用户说的
//   assistantMessage: string,   // AI 回复的完整内容（流式结束后拼好的）
// }
// 返回：{ ok: true, messageIds: [number, number] }
//
// 设计说明：这里一次性保存两条消息（user + assistant），而不是分两次调用。
// 因为这是"一轮对话"的原子单位——要么都存，要么都不存，避免半截状态。
// 原子性由 queries.saveMessagePair 保证（阶段 18：本地 SQLite 用事务，
// Turso 用 batch，两后端行为一致）。
//
// 改进点（标记在 待学与待办.md）：
//   当前"前端断了就不存"是简化处理。理想方案是后端在流式时边写边存（tee 流），
//   这样即使前端断开，已生成的部分也能保留。留后续改进。

import { saveMessagePair } from "@/lib/queries";

export async function POST(request: Request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体不是合法的 JSON" }, { status: 400 });
  }

  const { conversationId, userMessage, assistantMessage } = body;

  if (
    typeof conversationId !== "string" ||
    typeof userMessage !== "string" ||
    typeof assistantMessage !== "string"
  ) {
    return Response.json({ error: "参数缺失或类型错误" }, { status: 400 });
  }

  // 原子保存（内部会校验会话存在；不存在返回 null → 404）
  try {
    const saved = await saveMessagePair({
      conversationId,
      userMessage,
      assistantMessage,
    });

    if (!saved) {
      return Response.json({ error: "会话不存在" }, { status: 404 });
    }

    return Response.json({
      ok: true,
      messageIds: [saved.userMsgId, saved.assistantMsgId],
    });
  } catch (err) {
    return Response.json(
      { error: `保存失败：${err instanceof Error ? err.message : "未知错误"}` },
      { status: 500 },
    );
  }
}
