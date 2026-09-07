// 数据库查询封装层
//
// 所有函数都用 prepared statements（预编译语句）防 SQL 注入：
// dbPrepare("...?...").run(param) 里的 ? 是占位符，参数会被安全转义，
// 即使内容含 ' OR 1=1 这种注入串也只会被当普通字符串处理。
//
// 这一层的意义：route.ts 只调用这些函数，不直接写 SQL。
// 好处是 SQL 逻辑集中、可测试、改 schema 时只动这里。
//
// 阶段 18 起所有函数都是 async：
// 本地后端（node:sqlite）是同步 API 包成 Promise，Turso 后端（HTTP）天生 async。
// 对调用方来说统一 await 即可，换后端零改动。

import { dbPrepare, dbRunBatch } from "./db";

// === 类型定义（和数据库表结构对应）===
// get() 返回的行是 [Object: null prototype]，转成普通对象方便前端用
type ConversationRow = {
  id: string;
  title: string | null;
  system_prompt: string | null;
  created_at: string;
  kb_id: string | null; // 阶段 15 新增：绑定的知识库 id（可空）
};

type MessageRow = {
  id: number;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
};

// 知识库行
type KnowledgeBaseRow = {
  id: string;
  name: string;
  created_at: string;
};

// 文档行
type DocumentRow = {
  id: string;
  kb_id: string;
  filename: string;
  chunk_count: number;
  created_at: string;
};

// 对外暴露的类型（剥掉数据库字段名差异，前端友好）
export type Conversation = {
  id: string;
  title: string;
  systemPrompt: string;
  createdAt: string;
  kbId: string | null; // 阶段 15：绑定的知识库 id（null = 纯对话）
};

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

// 阶段 15：知识库 + 文档对外类型
export type KnowledgeBase = {
  id: string;
  name: string;
  createdAt: string;
};

export type KnowledgeDocument = {
  id: string;
  kbId: string;
  filename: string;
  chunkCount: number;
  createdAt: string;
};

// === 会话相关 ===

export async function createConversation(params: {
  id: string;
  title?: string;
  systemPrompt?: string;
}): Promise<void> {
  const now = new Date().toISOString();
  // INSERT 用 prepared statement，? 是位置占位符
  await dbPrepare(
    "INSERT INTO conversations (id, title, system_prompt, created_at) VALUES (?, ?, ?, ?)",
  ).run(params.id, params.title ?? null, params.systemPrompt ?? null, now);
}

export async function getConversation(id: string): Promise<Conversation | null> {
  // get() 返回一行或 undefined；用 as 断言类型
  const row = (await dbPrepare("SELECT * FROM conversations WHERE id = ?").get(
    id,
  )) as ConversationRow | undefined;

  if (!row) {
    return null;
  }

  // 把数据库字段名（下划线风格）映射成前端字段名（驼峰）
  return {
    id: row.id,
    title: row.title ?? "",
    systemPrompt: row.system_prompt ?? "",
    createdAt: row.created_at,
    kbId: row.kb_id ?? null,
  };
}

export async function listConversations(): Promise<Conversation[]> {
  // ORDER BY created_at DESC：最新的在最前面（侧边栏从上到下是新→旧）
  const rows = (await dbPrepare(
    "SELECT * FROM conversations ORDER BY created_at DESC",
  ).all()) as ConversationRow[];

  // 映射逻辑和 getConversation 一样：下划线 → 驼峰
  return rows.map((row) => ({
    id: row.id,
    title: row.title ?? "",
    systemPrompt: row.system_prompt ?? "",
    createdAt: row.created_at,
    kbId: row.kb_id ?? null,
  }));
}

export async function updateConversationTitle(
  id: string,
  title: string,
): Promise<void> {
  await dbPrepare("UPDATE conversations SET title = ? WHERE id = ?").run(
    title,
    id,
  );
}

// 阶段 15：设置会话绑定的知识库（传 null 解绑）
export async function setConversationKb(
  conversationId: string,
  kbId: string | null,
): Promise<void> {
  await dbPrepare("UPDATE conversations SET kb_id = ? WHERE id = ?").run(
    kbId,
    conversationId,
  );
}

export async function deleteConversation(id: string): Promise<void> {
  // 外键开了 ON DELETE CASCADE，删会话时它的消息会被自动删掉
  await dbPrepare("DELETE FROM conversations WHERE id = ?").run(id);
}

// === 消息相关 ===

export async function addMessage(params: {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
}): Promise<number> {
  const now = new Date().toISOString();
  const result = await dbPrepare(
    "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
  ).run(params.conversationId, params.role, params.content, now);
  // lastInsertRowid 是自增主键 id
  return result.lastInsertRowid;
}

// 阶段 18：原子保存一轮对话（user + assistant 两条 + 可能的标题更新）
//
// 为什么不用"两次 addMessage + 手动事务"：
// 阶段 12 用 db_begin/commit/rollback（node:sqlite 同步连接上的 BEGIN/COMMIT）。
// Turso 的 HTTP 客户端没有同一连接的 BEGIN 模式，但有 batch（一次请求原子执行）。
// 这里把三条语句打包成一次原子调用，两个后端行为一致。
//
// 返回新插入的两条消息 id；会话不存在返回 null（调用方回 404）。
export async function saveMessagePair(params: {
  conversationId: string;
  userMessage: string;
  assistantMessage: string;
}): Promise<{ userMsgId: number; assistantMsgId: number } | null> {
  // 校验会话存在（防止伪造 conversationId 写入孤儿消息）
  const conversation = await getConversation(params.conversationId);
  if (!conversation) {
    return null;
  }

  const now = new Date().toISOString();
  const statements: { sql: string; args: (string | number | bigint | null)[] }[] = [
    {
      sql: "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
      args: [params.conversationId, "user", params.userMessage, now],
    },
    {
      sql: "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
      args: [params.conversationId, "assistant", params.assistantMessage, now],
    },
  ];

  // 会话还没标题时，用首条 user 消息前 20 字作标题（供侧边栏显示）。
  // 判断在批次前完成（conversation 已读出），语句一次性原子执行。
  if (!conversation.title && params.userMessage.trim()) {
    const title = params.userMessage.trim().slice(0, 20);
    statements.push({
      sql: "UPDATE conversations SET title = ? WHERE id = ?",
      args: [title, params.conversationId],
    });
  }

  const results = await dbRunBatch(statements);

  return {
    userMsgId: results[0].lastInsertRowid,
    assistantMsgId: results[1].lastInsertRowid,
  };
}

export async function getMessages(conversationId: string): Promise<ChatMessage[]> {
  // 按时间正序（ASC）取，前端按顺序渲染
  const rows = (await dbPrepare(
    "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
  ).all(conversationId)) as MessageRow[];

  return rows.map((row) => ({
    id: row.id,
    role: row.role as "user" | "assistant",
    content: row.content,
    createdAt: row.created_at,
  }));
}

// === 知识库相关（阶段 15 新增）===

export async function createKnowledgeBase(params: {
  id: string;
  name: string;
}): Promise<void> {
  const now = new Date().toISOString();
  await dbPrepare(
    "INSERT INTO knowledge_bases (id, name, created_at) VALUES (?, ?, ?)",
  ).run(params.id, params.name, now);
}

export async function getKnowledgeBase(id: string): Promise<KnowledgeBase | null> {
  const row = (await dbPrepare("SELECT * FROM knowledge_bases WHERE id = ?").get(
    id,
  )) as KnowledgeBaseRow | undefined;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  };
}

export async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  const rows = (await dbPrepare(
    "SELECT * FROM knowledge_bases ORDER BY created_at DESC",
  ).all()) as KnowledgeBaseRow[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  }));
}

export async function deleteKnowledgeBase(id: string): Promise<void> {
  // 外键 ON DELETE CASCADE 会连带删除 documents 表里 kb_id = id 的文档元数据
  // 注意：向量库里的向量要单独删（调 vectorStore.delete），这里只删 SQLite 元数据
  await dbPrepare("DELETE FROM knowledge_bases WHERE id = ?").run(id);
}

// === 文档相关（阶段 15 新增）===

export async function addDocument(params: {
  id: string;
  kbId: string;
  filename: string;
  chunkCount: number;
}): Promise<void> {
  const now = new Date().toISOString();
  await dbPrepare(
    "INSERT INTO documents (id, kb_id, filename, chunk_count, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(params.id, params.kbId, params.filename, params.chunkCount, now);
}

export async function listDocuments(kbId: string): Promise<KnowledgeDocument[]> {
  const rows = (await dbPrepare(
    "SELECT * FROM documents WHERE kb_id = ? ORDER BY created_at DESC",
  ).all(kbId)) as DocumentRow[];

  return rows.map((row) => ({
    id: row.id,
    kbId: row.kb_id,
    filename: row.filename,
    chunkCount: row.chunk_count,
    createdAt: row.created_at,
  }));
}

export async function deleteDocument(id: string): Promise<void> {
  await dbPrepare("DELETE FROM documents WHERE id = ?").run(id);
  // 注意：向量库里的对应向量暂不删（Memory 实现不支持单文档级删除，整个 kb 删时才清）
  // 这是 Memory 实现的已知局限，换 Chroma 后可精确删
}
