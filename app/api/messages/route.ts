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
//
// 改进点（标记在 待学与待办.md）：
//   当前"前端断了就不存"是简化处理。理想方案是后端在流式时边写边存（tee 流），
//   这样即使前端断开，已生成的部分也能保留。留到阶段 14 合入 LangChain 时改进。

import {
  addMessage,
  getConversation,
  updateConversationTitle,
} from "@/lib/queries";
import { db_begin, db_commit, db_rollback } from "@/lib/db";

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

  // 校验会话存在（防止伪造 conversationId 写入孤儿消息）
  const conversation = getConversation(conversationId);
  if (!conversation) {
    return Response.json({ error: "会话不存在" }, { status: 404 });
  }

  // 用事务保证原子性：两条 INSERT 要么都成功，要么都回滚
  // 注意 node:sqlite 的事务靠 BEGIN/COMMIT/ROLLBACK 语句控制（better-sqlite3 有 .transaction() 包装，这里手动写）
  try {
    db_begin();
    const userMsgId = addMessage({
      conversationId,
      role: "user",
      content: userMessage,
    });
    const assistantMsgId = addMessage({
      conversationId,
      role: "assistant",
      content: assistantMessage,
    });

    // 如果会话还没标题，用首条 user 消息前 20 字作为标题（供阶段 13 侧边栏显示）
    if (!conversation.title && userMessage.trim()) {
      const title = userMessage.trim().slice(0, 20);
      updateConversationTitle(conversationId, title);
    }

    db_commit();
    return Response.json({ ok: true, messageIds: [userMsgId, assistantMsgId] });
  } catch (err) {
    db_rollback();
    return Response.json(
      { error: `保存失败：${err instanceof Error ? err.message : "未知错误"}` },
      { status: 500 },
    );
  }
}
