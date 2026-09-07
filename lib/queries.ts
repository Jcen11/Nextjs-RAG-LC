// 数据库查询封装层
//
// 所有函数都用 prepared statements（预编译语句）防 SQL 注入：
// db.prepare("...?...").run(param) 里的 ? 是占位符，参数会被安全转义，
// 即使内容含 ' OR 1=1 这种注入串也只会被当普通字符串处理。
//
// 这一层的意义：route.ts 只调用这些函数，不直接写 SQL。
// 好处是 SQL 逻辑集中、可测试、改 schema 时只动这里。

import { db } from "./db";
import type { DatabaseSync } from "node:sqlite";

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

export function createConversation(params: {
  id: string;
  title?: string;
  systemPrompt?: string;
}): void {
  const now = new Date().toISOString();
  // INSERT 用 prepared statement，? 是位置占位符（node:sqlite 也支持 :name 命名占位符）
  db.prepare(
    "INSERT INTO conversations (id, title, system_prompt, created_at) VALUES (?, ?, ?, ?)",
  ).run(params.id, params.title ?? null, params.systemPrompt ?? null, now);
}

export function getConversation(id: string): Conversation | null {
  // get() 返回一行或 undefined；用 as 断言类型
  const row = db
    .prepare("SELECT * FROM conversations WHERE id = ?")
    .get(id) as ConversationRow | undefined;

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

export function listConversations(): Conversation[] {
  // ORDER BY created_at DESC：最新的在最前面（侧边栏从上到下是新→旧）
  const rows = db
    .prepare("SELECT * FROM conversations ORDER BY created_at DESC")
    .all() as ConversationRow[];

  // 映射逻辑和 getConversation 一样：下划线 → 驼峰
  return rows.map((row) => ({
    id: row.id,
    title: row.title ?? "",
    systemPrompt: row.system_prompt ?? "",
    createdAt: row.created_at,
    kbId: row.kb_id ?? null,
  }));
}

export function updateConversationTitle(id: string, title: string): void {
  db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(title, id);
}

// 阶段 15：设置会话绑定的知识库（传 null 解绑）
export function setConversationKb(conversationId: string, kbId: string | null): void {
  db.prepare("UPDATE conversations SET kb_id = ? WHERE id = ?").run(kbId, conversationId);
}

export function deleteConversation(id: string): void {
  // 外键开了 ON DELETE CASCADE，删会话时它的消息会被自动删掉
  db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
}

// === 消息相关 ===

export function addMessage(params: {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
}): number {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
  );
  const result = stmt.run(params.conversationId, params.role, params.content, now);
  // node:sqlite 的 run() 返回 { changes, lastInsertRowid }
  // lastInsertRowid 是自增主键 id
  return Number(result.lastInsertRowid);
}

export function getMessages(conversationId: string): ChatMessage[] {
  // 按时间正序（ASC）取，前端按顺序渲染
  const rows = db
    .prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
    )
    .all(conversationId) as MessageRow[];

  return rows.map((row) => ({
    id: row.id,
    role: row.role as "user" | "assistant",
    content: row.content,
    createdAt: row.created_at,
  }));
}

// === 知识库相关（阶段 15 新增）===

export function createKnowledgeBase(params: { id: string; name: string }): void {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO knowledge_bases (id, name, created_at) VALUES (?, ?, ?)",
  ).run(params.id, params.name, now);
}

export function getKnowledgeBase(id: string): KnowledgeBase | null {
  const row = db
    .prepare("SELECT * FROM knowledge_bases WHERE id = ?")
    .get(id) as KnowledgeBaseRow | undefined;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  };
}

export function listKnowledgeBases(): KnowledgeBase[] {
  const rows = db
    .prepare("SELECT * FROM knowledge_bases ORDER BY created_at DESC")
    .all() as KnowledgeBaseRow[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  }));
}

export function deleteKnowledgeBase(id: string): void {
  // 外键 ON DELETE CASCADE 会连带删除 documents 表里 kb_id = id 的文档元数据
  // 注意：向量库里的向量要单独删（调 vectorStore.delete），这里只删 SQLite 元数据
  db.prepare("DELETE FROM knowledge_bases WHERE id = ?").run(id);
}

// === 文档相关（阶段 15 新增）===

export function addDocument(params: {
  id: string;
  kbId: string;
  filename: string;
  chunkCount: number;
}): void {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO documents (id, kb_id, filename, chunk_count, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(params.id, params.kbId, params.filename, params.chunkCount, now);
}

export function listDocuments(kbId: string): KnowledgeDocument[] {
  const rows = db
    .prepare(
      "SELECT * FROM documents WHERE kb_id = ? ORDER BY created_at DESC",
    )
    .all(kbId) as DocumentRow[];

  return rows.map((row) => ({
    id: row.id,
    kbId: row.kb_id,
    filename: row.filename,
    chunkCount: row.chunk_count,
    createdAt: row.created_at,
  }));
}

export function deleteDocument(id: string): void {
  db.prepare("DELETE FROM documents WHERE id = ?").run(id);
  // 注意：向量库里的对应向量暂不删（Memory 实现不支持单文档级删除，整个 kb 删时才清）
  // 这是 Memory 实现的已知局限，换 Chroma 后可精确删
}
