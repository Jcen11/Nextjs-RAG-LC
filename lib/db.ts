// 数据库连接与初始化
//
// 用的是 Node.js 22+ 内置的 node:sqlite 模块（实验性，需 Node >= 22）。
// 它的 API 和 better-sqlite3 几乎一样（同步 API + prepared statements），
// 以后若换 better-sqlite3，只需改这里的 import 和类名，queries.ts 不用动。
//
// 为什么用单例（globalThis.db）：
// Next.js 开发模式下会热重载，每次重载会重新执行模块代码。如果不做单例，
// 每次热重载都会 new 一个新的数据库连接，旧连接没释放，最终耗尽资源。
// 挂到 global 上，整个进程只保留一个连接，热重载复用它。
//
// node:sqlite 是服务端专属模块（依赖 Node 的原生能力），绝不能进客户端 bundle。
// 这个文件只在 route.ts（服务端）里被 import，Next.js 会自动判定不打包进客户端。

import { DatabaseSync } from "node:sqlite";

const DB_PATH = "chat.db";

// 用类型断言绕过 TS 对 global 自定义属性的报错
const globalForDb = globalThis as unknown as {
  db: DatabaseSync | undefined;
};

export const db =
  globalForDb.db ??
  new DatabaseSync(DB_PATH, {
    // WAL 模式：写入性能更好，支持并发读。SQLite 推荐的生产配置。
    // 注意：node:sqlite 目前对 options 的支持有限，这里先不强制开启，
    // 用默认的 journal mode。后续如有性能需求再调。
  });

// 开启外键约束（SQLite 默认关闭外键，必须显式开启，否则 ON DELETE CASCADE 不生效）
db.exec("PRAGMA foreign_keys = ON;");

// 建表（IF NOT EXISTS 保证重复执行不报错）
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    system_prompt TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);

  -- 阶段 15 新增：知识库 + 文档表（RAG 用）
  -- 知识库表：一个知识库 = 一组文档，可被会话绑定
  CREATE TABLE IF NOT EXISTS knowledge_bases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- 文档表：每个上传的文件一条，记录元数据
  -- 注意：向量本身不存这里（存向量库），SQLite 只存元数据
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    kb_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    chunk_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_documents_kb ON documents(kb_id);
`);

// 阶段 15：给 conversations 表加 kb_id 列（会话绑定知识库）
// 用 try/catch 包 ALTER TABLE：SQLite 的 ADD COLUMN 不支持 IF NOT EXISTS，
// 列已存在时会报错。首次添加才执行，已有列则忽略（热重载/已有数据库会走到 catch）
try {
  db.exec("ALTER TABLE conversations ADD COLUMN kb_id TEXT REFERENCES knowledge_bases(id)");
} catch {
  // 列已存在，忽略
}

// 开发模式下挂到 global，避免热重载重复建连接
if (process.env.NODE_ENV !== "production") {
  globalForDb.db = db;
}

// === 事务辅助函数 ===
// SQLite 的事务靠 SQL 语句控制：BEGIN 开启，COMMIT 提交，ROLLBACK 回滚。
// better-sqlite3 有 db.transaction() 包装函数，node:sqlite 目前没有，
// 这里手动封装三个函数。用法见 app/api/messages/route.ts。
//
// 事务的意义：把多条语句"打包"成一个原子操作——中间任意一步失败，
// 之前已执行的也会回滚，保证不会留下半截数据。
export function db_begin(): void {
  db.exec("BEGIN");
}

export function db_commit(): void {
  db.exec("COMMIT");
}

export function db_rollback(): void {
  db.exec("ROLLBACK");
}
