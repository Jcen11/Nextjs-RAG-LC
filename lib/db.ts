// 数据库连接与初始化（阶段 18：双后端 —— 本地 SQLite / Turso 云数据库）
//
// 后端选择（由环境变量决定，对外接口统一，业务层零感知）：
// - 没配 DATABASE_URL → node:sqlite 本地 chat.db 文件（开发环境，阶段 12 起的方式）
// - 配了 DATABASE_URL（libsql://...）→ Turso 云 SQLite（部署 Vercel 用：
//   serverless 文件系统是临时的，本地文件存不住；Turso 是 SQLite 的云托管版，
//   SQL 完全一样，只换连接层）
//
// 为什么把同步 API 改成 async（阶段 18 的关键改动）：
// node:sqlite 是同步 API；Turso 客户端走 HTTP，只能是 async。
// 两个后端要共用一套 queries.ts，只能统一成 async——本地后端在 async
// 函数里包一层同步调用，语义不变。
//
// 为什么用单例（globalThis）：
// Next.js 开发模式下会热重载，每次重载会重新执行模块代码。如果不做单例，
// 每次热重载都会 new 一个新的数据库连接，旧连接没释放，最终耗尽资源。
// 挂到 global 上，整个进程只保留一个连接，热重载复用它。
//
// 这两个文件只在 route.ts（服务端）里被 import，Next.js 会自动判定不打包进客户端。

import { DatabaseSync } from "node:sqlite";
import { createClient, type Client } from "@libsql/client";

const DATABASE_URL = process.env.DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

const useTurso = Boolean(DATABASE_URL);

// === 统一接口（queries.ts 只认这些）===
export interface DbStatement {
  run(...params: (string | number | bigint | null)[]): Promise<{
    changes: number;
    lastInsertRowid: number;
  }>;
  get(...params: (string | number | bigint | null)[]): Promise<Record<string, unknown> | undefined>;
  all(...params: (string | number | bigint | null)[]): Promise<Record<string, unknown>[]>;
}

export interface DbBatchResult {
  changes: number;
  lastInsertRowid: number;
}

// === 建表 SQL（两个后端共用）===
const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    system_prompt TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id)`,
  `CREATE TABLE IF NOT EXISTS knowledge_bases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    kb_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    chunk_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_documents_kb ON documents(kb_id)`,
];

// 阶段 15：给 conversations 表加 kb_id 列（会话绑定知识库）。
// ADD COLUMN 不支持 IF NOT EXISTS，单独处理：先查列是否存在，没有才加。
const KB_ID_COLUMN_SQL =
  "ALTER TABLE conversations ADD COLUMN kb_id TEXT REFERENCES knowledge_bases(id)";

// ============================================================
// 后端 A：本地 SQLite（node:sqlite，开发环境默认）
// ============================================================

// 用类型断言绕过 TS 对 global 自定义属性的报错
const globalForDb = globalThis as unknown as {
  db: DatabaseSync | undefined;
};

const sqliteDb = globalForDb.db ?? new DatabaseSync("chat.db");

// 开启外键约束（SQLite 默认关闭外键，必须显式开启，否则 ON DELETE CASCADE 不生效）
sqliteDb.exec("PRAGMA foreign_keys = ON;");

// 建表（同步执行，模块加载时完成；IF NOT EXISTS 保证重复执行不报错）
for (const statement of SCHEMA_STATEMENTS) {
  sqliteDb.exec(statement);
}

// kb_id 列：列已存在时会报错（try/catch 忽略；热重载/已有数据库会走到这里）
try {
  sqliteDb.exec(KB_ID_COLUMN_SQL);
} catch {
  // 列已存在，忽略
}

if (process.env.NODE_ENV !== "production") {
  globalForDb.db = sqliteDb;
}

function sqlitePrepare(sql: string): DbStatement {
  // node:sqlite 的 prepared statement（同步 API，外面包成 Promise）
  const stmt = sqliteDb.prepare(sql);
  return {
    run: (...params) => {
      const result = stmt.run(...params);
      return Promise.resolve({
        changes: Number(result.changes),
        lastInsertRowid: Number(result.lastInsertRowid),
      });
    },
    get: (...params) =>
      Promise.resolve(stmt.get(...params) as Record<string, unknown> | undefined),
    all: (...params) =>
      Promise.resolve(stmt.all(...params) as Record<string, unknown>[]),
  };
}

// ============================================================
// 后端 B：Turso（@libsql/client，部署 Vercel 用）
// ============================================================

const globalForTurso = globalThis as unknown as {
  turso: Client | undefined;
};

// 惰性创建：createClient 会在构造时校验 URL 合法性，
// 没配 DATABASE_URL 时不能提前 new（本地开发用不到 Turso，构造了反而报错）
let tursoClient: Client | null = null;

function getTursoClient(): Client {
  if (!tursoClient) {
    tursoClient =
      globalForTurso.turso ??
      createClient({
        url: DATABASE_URL as string,
        authToken: TURSO_AUTH_TOKEN,
      });
    if (process.env.NODE_ENV !== "production") {
      globalForTurso.turso = tursoClient;
    }
  }
  return tursoClient;
}

// Turso 走 HTTP，建表不能像 node:sqlite 那样模块加载时同步执行，
// 用懒初始化：第一次用到数据库时才建表，只跑一次（promise 缓存）。
let tursoReady: Promise<void> | null = null;

function ensureTursoSchema(): Promise<void> {
  if (!tursoReady) {
    tursoReady = (async () => {
      const client = getTursoClient();
      // 外键：Turso 默认已开，这里显式设置；个别环境不支持连接级 pragma，失败忽略
      try {
        await client.execute("PRAGMA foreign_keys = ON;");
      } catch {
        // 忽略：不支持时沿用服务端默认
      }
      for (const statement of SCHEMA_STATEMENTS) {
        await client.execute(statement);
      }
      // kb_id 列：先查表结构，没有才 ALTER（幂等）
      const cols = await client.execute("PRAGMA table_info(conversations)");
      const hasKbId = (cols.rows as Record<string, unknown>[]).some(
        (row) => row.name === "kb_id",
      );
      if (!hasKbId) {
        await client.execute(KB_ID_COLUMN_SQL);
      }
    })();
  }
  return tursoReady;
}

function tursoPrepare(sql: string): DbStatement {
  return {
    run: async (...params) => {
      await ensureTursoSchema();
      const result = await getTursoClient().execute({ sql, args: params });
      return {
        changes: Number(result.rowsAffected),
        lastInsertRowid: Number(result.lastInsertRowid ?? 0),
      };
    },
    get: async (...params) => {
      await ensureTursoSchema();
      const result = await getTursoClient().execute({ sql, args: params });
      return (result.rows[0] as Record<string, unknown>) ?? undefined;
    },
    all: async (...params) => {
      await ensureTursoSchema();
      const result = await getTursoClient().execute({ sql, args: params });
      return result.rows as unknown as Record<string, unknown>[];
    },
  };
}

// ============================================================
// 对外函数
// ============================================================

export function dbPrepare(sql: string): DbStatement {
  return useTurso ? tursoPrepare(sql) : sqlitePrepare(sql);
}

// 原子执行多条语句（阶段 18 替代 db_begin/commit/rollback 的手动事务写法）
//
// 为什么换掉手动 BEGIN/COMMIT：
// node:sqlite 的事务靠 BEGIN/COMMIT/ROLLBACK 语句控制（同步连接上可行）；
// Turso 的 HTTP 客户端没有"同一连接发 BEGIN 再发语句"的模式，但有 batch：
// 一次 HTTP 请求内原子执行多条语句（服务端包在隐式事务里）。
// 两个后端语义一致：要么全部成功，要么全部回滚。
//
// 返回每条语句的 changes/lastInsertRowid（调用方用 lastInsertRowid 取新插入行的 id）
export async function dbRunBatch(
  statements: { sql: string; args: (string | number | bigint | null)[] }[],
): Promise<DbBatchResult[]> {
  if (useTurso) {
    await ensureTursoSchema();
    const results = await getTursoClient().batch(
      statements.map((s) => ({ sql: s.sql, args: s.args })),
      "write",
    );
    return results.map((r) => ({
      changes: Number(r.rowsAffected),
      lastInsertRowid: Number(r.lastInsertRowid ?? 0),
    }));
  }

  // SQLite：手动事务
  sqliteDb.exec("BEGIN");
  try {
    const results = statements.map((s) => {
      const result = sqliteDb.prepare(s.sql).run(...s.args);
      return {
        changes: Number(result.changes),
        lastInsertRowid: Number(result.lastInsertRowid),
      };
    });
    sqliteDb.exec("COMMIT");
    return results;
  } catch (err) {
    sqliteDb.exec("ROLLBACK");
    throw err;
  }
}
