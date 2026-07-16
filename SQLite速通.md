# SQLite 速通（看懂本项目代码专用）

> 这份文档假设你"略懂 SQL 语法"——知道 SELECT/INSERT 大概是干嘛的，但没实际写过项目，细节记不清。
>
> 目标：看完这份，能**完全看懂**本项目的 `lib/db.ts`、`lib/queries.ts`、和 schema 里的每一行 SQL，知道为什么这么写、不这么写会出什么问题。
>
> 这是一份**参考资料**，不是阶段文档，不带阶段编号。随时回查。

---

## 一、先建立心智模型：SQLite 是什么

SQLite 是一个**单文件的数据库**。不像 MySQL/PostgreSQL 那样要装服务、开端口、有专门进程，SQLite 就是**一个文件**（本项目里叫 `chat.db`），所有数据都在这个文件里。

```
MySQL/PostgreSQL：  单独的服务进程，监听端口，你的代码通过网络连过去
SQLite：            就是一个文件，你的代码直接读写这个文件，没有中间人
```

代码怎么操作这个文件？通过 **SQL 语句**。比如"查 id 为 5 的消息"：

```sql
SELECT * FROM messages WHERE id = 5;
```

数据库引擎（SQLite）收到这句话，去文件里翻找，把结果给你。

### SQLite vs 其它数据库

| | SQLite | MySQL / Postgres |
|---|---|---|
| 存储 | 单文件 | 服务进程 + 独立存储 |
| 安装 | 装个库就行 | 要装服务、配端口、建用户 |
| 并发 | 单写入者，多读者 | 多写入者并发强 |
| 适合 | 本地应用、学习、小型项目、测试 | 中大型项目、多用户并发 |
| 部署 | 文件随项目走 | 要单独部署数据库服务 |

**本项目为什么用 SQLite**：学习项目 + 单机使用 + 不想装服务。一个 `chat.db` 文件搞定。生产环境上量了再换 Postgres，SQL 语句大部分通用。

### 表（Table）是什么

表就是**结构化的数据**，想象成 Excel 表格：

```
messages 表（存所有消息）
┌────┬──────────────────┬──────┬──────────────┬────────────────────────┐
│ id │ conversation_id  │ role │ content      │ created_at             │
├────┼──────────────────┼──────┼──────────────┼────────────────────────┤
│ 1  │ f47ac10b-...     │ user │ 你好         │ 2026-07-14T10:30:00Z   │
│ 2  │ f47ac10b-...     │ bot  │ 你好啊！...  │ 2026-07-14T10:30:01Z   │
│ 3  │ a8c2f3...        │ user │ 解释一下 X   │ 2026-07-14T11:00:00Z   │
└────┴──────────────────┴──────┴──────────────┴────────────────────────┘
```

- **列（column）**：id、role、content 这些，定义数据的字段。建表时用 `CREATE TABLE` 声明
- **行（row）**：每一行就是一条具体数据（一条消息）。`INSERT` 加行，`DELETE` 删行
- **主键（primary key）**：能唯一标识一行的列。这里 `id` 是主键，每行的 id 不重复

---

## 二、本项目用到的全部 SQL（逐条拆解）

项目里用到的 SQL 其实很少。下面把每一类都拆开讲，对应到 `lib/queries.ts` 里的具体函数。

### 2.1 建表：CREATE TABLE

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  system_prompt TEXT,
  created_at TEXT NOT NULL
);
```

逐行解释：
- `CREATE TABLE IF NOT EXISTS` —— 建表，如果表已存在就跳过（不报错）。`IF NOT EXISTS` 很重要：项目每次启动都会跑这行，没这个修饰第二次启动就报"表已存在"
- `id TEXT PRIMARY KEY` —— id 列，类型是 TEXT（字符串），`PRIMARY KEY` 表示主键（唯一 + 不能为空）
- `title TEXT` —— title 列，字符串，**可空**（没写 NOT NULL，所以允许 NULL）
- `created_at TEXT NOT NULL` —— created_at 列，字符串，`NOT NULL` 表示必须有值

#### SQLite 的数据类型（很少）

SQLite 是**弱类型**数据库，只有 5 种存储类型：

| 类型 | 存什么 | 本项目用在 |
|---|---|---|
| **TEXT** | 字符串 | id、title、role、content、created_at |
| **INTEGER** | 整数 | messages.id（自增主键） |
| REAL | 浮点数 | （没用） |
| BLOB | 二进制 | （没用，比如存图片） |
| NULL | 空 | （可空列的默认值） |

**注意一个反直觉的点**：SQLite 没有专门的"日期类型"。存日期有三种做法，本项目用 TEXT 存 ISO 字符串（见后面"时间戳"一节）。

#### PRIMARY KEY 和 AUTOINCREMENT

```sql
-- conversations 表：id 是我们代码生成的 UUID（字符串）
id TEXT PRIMARY KEY

-- messages 表：id 是数据库自动递增的数字
id INTEGER PRIMARY KEY AUTOINCREMENT
```

- `PRIMARY KEY` = 主键，唯一标识一行，不能重复、不能为空
- `AUTOINCREMENT` = 自动递增。插入新行时不用给 id，数据库自动分配 1、2、3...

```
INSERT INTO messages (conversation_id, role, content, created_at)
VALUES ('xxx', 'user', '你好', '...');
-- 没传 id，数据库自动给这行分配 id = 1
-- 下一条 id = 2，再下一条 id = 3...
```

#### NOT NULL

```sql
created_at TEXT NOT NULL
```

`NOT NULL` = 这列必须有值，不能为空。如果插入时没给 created_at，数据库会拒绝插入并报错。这是一种数据保护——防止某些行缺关键字段。

### 2.2 插入：INSERT

```sql
INSERT INTO conversations (id, title, system_prompt, created_at)
VALUES (?, ?, ?, ?)
```

- `INSERT INTO 表名 (列1, 列2, ...) VALUES (值1, 值2, ...)`
- 问号 `?` 是**占位符**——真正执行时由代码传参填入（见后面"防注入"）
- 列的顺序要和 VALUES 对应

对应代码（`queries.ts`）：
```ts
db.prepare(
  "INSERT INTO conversations (id, title, system_prompt, created_at) VALUES (?, ?, ?, ?)"
).run(params.id, params.title ?? null, params.systemPrompt ?? null, now);
//  四个 ? 依次填入: id,     title,         systemPrompt,         now
```

### 2.3 查询：SELECT

```sql
-- 查所有列、满足条件的行
SELECT * FROM conversations WHERE id = ?

-- 查指定列
SELECT id, role, content FROM messages WHERE conversation_id = ?

-- 按某列排序
SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC
```

- `SELECT *` —— 查所有列（`*` 是通配符）。生产代码里建议写明列名（`SELECT id, role`），但学习项目用 `*` 没问题
- `FROM 表名` —— 从哪个表查
- `WHERE 条件` —— 筛选行，只返回满足条件的。`=` 是等于，还有 `>`、`<`、`!=`、`LIKE`（模糊匹配）等
- `ORDER BY 列名 ASC` —— 按某列排序。`ASC` 升序（小→大），`DESC` 降序（大→小）

对应代码：
```ts
// 取一个会话：get() 只取第一行
db.prepare("SELECT * FROM conversations WHERE id = ?").get(id)

// 取一个会话的所有消息：all() 取所有行
db.prepare(
  "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
).all(conversationId)
```

#### get() vs all()（node:sqlite / better-sqlite3 的 API）

| 方法 | 返回 | 用在 |
|---|---|---|
| `.get()` | 第一行（对象）或 undefined | 知道只匹配一行的查询（按主键查） |
| `.all()` | 所有行（数组） | 可能匹配多行的查询 |

```ts
// 查 id = 'xxx' 的会话，最多一行，用 get()
const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get('xxx');
// conv = { id: 'xxx', title: '...', ... } 或 undefined

// 查 conversation_id = 'xxx' 的所有消息，可能很多行，用 all()
const msgs = db.prepare("SELECT * FROM messages WHERE conversation_id = ?").all('xxx');
// msgs = [ {id:1, ...}, {id:2, ...}, ... ]
```

### 2.4 更新：UPDATE

```sql
UPDATE conversations SET title = ? WHERE id = ?
```

- `UPDATE 表名 SET 列 = 值 WHERE 条件`
- **WHERE 很重要！** 没 WHERE 会更新**所有行**——`UPDATE conversations SET title = '新'` 会让所有会话的 title 都变成"新"

对应代码：
```ts
db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(title, id);
```

### 2.5 删除：DELETE

```sql
DELETE FROM conversations WHERE id = ?
```

- `DELETE FROM 表名 WHERE 条件`
- 同样 **WHERE 很重要！** 没 WHERE 会删掉整张表的所有行

对应代码：
```ts
db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
```

---

## 三、看懂 schema 设计（项目里最值得学的部分）

### 3.1 两张表 + 外键关联

本项目有两张表，它们通过**外键**关联：

```
conversations 表（会话）              messages 表（消息）
┌────────────┬────────┐              ┌────┬──────────────────┬──────┐
│ id（主键） │ title  │    一个      │ id │ conversation_id  │ role │
├────────────┼────────┤   会话  →   ├────┼──────────────────┼──────┤
│ f47ac10b   │ 你好   │    多条      │ 1  │ f47ac10b         │ user │
│ a8c2f3     │ 解释X  │    消息      │ 2  │ f47ac10b         │ bot  │
└────────────┴────────┘              │ 3  │ a8c2f3           │ user │
       ↑                              └────┴──────┬───────────┴──────┘
       │                                     外键 │ 指向 conversations.id
       └─────────────────────────────────────────┘
```

**外键**就是 messages 表里的 `conversation_id` 列——它的值必须在 conversations 表的 `id` 里存在。这保证了"每条消息都属于一个真实的会话"，不会出现指向不存在的会话的"孤儿消息"。

```sql
-- messages 表里的外键声明
conversation_id TEXT NOT NULL,
FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
```

- `FOREIGN KEY (conversation_id)` —— 声明 conversation_id 是外键
- `REFERENCES conversations(id)` —— 它引用 conversations 表的 id 列
- `ON DELETE CASCADE` —— 删被引用的行时，连带删引用它的行（见下）

### 3.2 ON DELETE CASCADE（级联删除）

```sql
ON DELETE CASCADE
```

意思是：**删一个会话时，它名下的所有消息自动连带删除**。

```
DELETE FROM conversations WHERE id = 'f47ac10b'
  ↓
CASCADE 触发：messages 表里 conversation_id = 'f47ac10b' 的行全部自动删除
  ↓
结果：会话没了，它下面的消息也没了，不留垃圾
```

如果没有 CASCADE，删会话后消息会变成**孤儿数据**——指向一个不存在的会话。

### 3.3 ⚠️ 坑：SQLite 默认不开启外键

这是个**必须记住的坑**。SQLite 为了向后兼容，**默认关闭外键约束**——你写了 `FOREIGN KEY` 和 `ON DELETE CASCADE`，但如果不显式开启，它们**都是摆设**：

- 能插入 conversation_id 指向不存在会话的消息（外键不检查）
- 删会话时消息不会被连带删（CASCADE 不生效）

必须在代码里显式开启：
```ts
db.exec("PRAGMA foreign_keys = ON;");  // 本项目 db.ts 里这行
```

`PRAGMA` 是 SQLite 的配置命令，`foreign_keys = ON` 开启外键约束。**这行不写，外键和 CASCADE 全失效。**

### 3.4 索引（INDEX）：让查询变快

```sql
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
```

先拆解这句：
- `CREATE INDEX` —— 建索引（固定语法）
- `IF NOT EXISTS` —— 索引已存在就跳过（和建表同理）
- `idx_messages_conv` —— **索引的名字，自己起的**。约定俗成以 `idx_` 开头，后面跟"哪张表_哪列"（messages 表的 conversation 列），方便日后一眼认出
- `ON messages(conversation_id)` —— 给 messages 表的 conversation_id 列建索引

#### 核心概念：索引不是"给数据排序"，是"旁边建一本目录"

这是最容易误解的点。**建索引不会改变表里的数据顺序**，而是在表的旁边**单独造一个查找用的目录**。表的数据原封不动，目录是额外的数据结构。

用具体例子讲透。假设 messages 表里有这些数据（注意：表里的行是按插入顺序物理存储的，是乱的）：

```
messages 表（数据原封不动，按插入顺序乱排着）
┌──────┬──────────────────┐
│ 行号 │ conversation_id  │
├──────┼──────────────────┤
│  1   │ a8c2f3           │  ← 会话A
│  2   │ f47ac10b         │  ← 会话B
│  3   │ a8c2f3           │  ← 会话A
│  4   │ b9e1d7           │  ← 会话C
│  5   │ f47ac10b         │  ← 会话B
│  6   │ a8c2f3           │  ← 会话A
│ ...  │ ...              │  ← 假设有 10000 行
└──────┴──────────────────┘
```

**没索引时**查 `WHERE conversation_id = 'f47ac10b'`（全表扫描）：
```
数据库只能从第 1 行开始，一行一行检查：
  第 1 行：a8c2f3    → 不是 B，跳过
  第 2 行：f47ac10b  → 是 B！收下
  第 3 行：a8c2f3    → 不是，跳过
  ...一直检查到第 10000 行...
  → 为了找 2 条匹配，扫了整张表 10000 次（O(n)）
```

**建了索引后**，数据库在表旁边单独造了一本目录（**表的数据一个字没动**）：

```
索引 idx_messages_conv —— 一本独立于表的、按 conversation_id 排好序的目录
┌──────────────────┬──────┐
│ conversation_id  │ 行号 │   ← 目录按 conversation_id 排好序
├──────────────────┼──────┤    （同样的值排在一起）
│ a8c2f3           │  1   │
│ a8c2f3           │  3   │
│ a8c2f3           │  6   │
│ b9e1d7           │  4   │
│ f47ac10b         │  2   │
│ f47ac10b         │  5   │
└──────────────────┴──────┘
        ↑
  这本目录才是"排好序的"
   表里的数据还是乱的
```

查 `WHERE conversation_id = 'f47ac10b'`（走索引）：
```
1. 数据库先翻索引（目录）：
   目录是排好序的 → 用二分查找（像查字典那样翻）
   几步就定位到 f47ac10b 在目录的第 5-6 条

2. 目录告诉数据库：行 2 和行 5 是 f47ac10b

3. 数据库回到表，直接取行 2 和行 5 → 搞定
   → 10000 行只要约 14 次（O(log n)），不用扫全表
```

#### 两种"排序"务必区分（防误解）

| | 表数据被排序 | 索引（目录）被排序 |
|---|---|---|
| 动了什么 | 表里行的物理顺序被改变 | **单独建一本目录**，表数据不动 |
| 后果 | 插入新行时表要重新排，很慢 | 表的插入不受影响，只是多占空间存目录 |
| 是索引吗 | ❌ 不是，这是另一种操作 | ✅ 这才是索引 |

**索引 = 表数据原封不动，旁边多一本"按某列排好序、记着对应行号"的目录。** 查询时先翻目录快速定位行号，再回表取数据。

#### 为什么排序这么重要：二分查找

排序的价值在于能用**二分查找**。想象查字典：
- 字典按部首/拼音**排好序**，找"海"字：翻到 H → hai → 几秒定位
- 字典**乱序**的，找"海"字：从第一页一页页翻，可能翻几百页

排序让查找从"逐个检查"（O(n)，10000 行检查 10000 次）变成"二分"（O(log n)，10000 行只要约 14 次）。

**索引就是那个排好序的目录**。表数据还在原位乱着，但你想按 conversation_id 查时，先翻目录秒定位，不用一行行扫。

#### 索引的代价（不是免费的）

1. **占空间**：索引是额外的数据结构，要占磁盘空间
2. **写入变慢**：每次 INSERT 新消息，除了写进表，还要**更新索引目录**（把新行的 conversation_id 插到目录的正确位置）。写入工作量翻倍

但本项目值得建——因为"按 conversation_id 查消息"（读）远比"插入消息"（写）频繁，而且消息表会越来越大，没索引每次查历史都全表扫描，越用越慢。

#### 什么时候建索引 / 不建

- **该建**：经常用某列做 WHERE 查询（本项目按 conversation_id 查消息，所以建）
- **不建**：不常查的列、数据量很小的表（建了反而增加写入开销，没收益）

---

## 四、prepared statement（防 SQL 注入，最重要！）

### 4.1 什么是 SQL 注入

如果用**字符串拼接**构造 SQL，用户输入会直接进到 SQL 里，非常危险：

```ts
// ❌ 危险写法：字符串拼接
const userInput = "你好";  // 正常用户
db.exec(`SELECT * FROM messages WHERE content = '${userInput}'`);
// 生成的 SQL：SELECT * FROM messages WHERE content = '你好'  ← 正常

const maliciousInput = "x' OR '1'='1";  // 恶意用户
db.exec(`SELECT * FROM messages WHERE content = '${maliciousInput}'`);
// 生成的 SQL：SELECT * FROM messages WHERE content = 'x' OR '1'='1'
//                                                    ↑ 注入成功！'1'='1' 永真
// → 返回整张表所有数据！
```

更严重的注入能 DROP TABLE（删表）、甚至拿到管理员权限。

### 4.2 prepared statement 怎么防

```ts
// ✅ 安全写法：prepared statement + ? 占位符
db.prepare("SELECT * FROM messages WHERE content = ?").run(userInput);
```

工作原理：
1. `db.prepare(SQL)` 先**预编译** SQL 语句（解析结构、生成执行计划）
2. 预编译时 `?` 是"参数位置"，**SQL 结构已经固定**，不能再被改变
3. `.run(userInput)` 把参数传进去，参数被当作**纯数据**处理，不会被解析成 SQL 语法

```
恶意输入 "x' OR '1'='1" 经过 prepared statement：
  → 数据库不会把它当 SQL 解析，而是当普通字符串 'x\' OR \'1\'=\'1' 查找
  → 查不到 content 完全等于这个串的行，返回空
  → 注入失败
```

**一句话记忆**：永远用 `?` 占位符 + `.run()` 传参，**永远不要字符串拼接 SQL**。

### 4.3 node:sqlite / better-sqlite3 的三件套

```ts
const stmt = db.prepare("SELECT * FROM messages WHERE conversation_id = ?");

stmt.get(id);       // 取第一行（对象）或 undefined
stmt.all(id);       // 取所有行（数组）
stmt.run(params);   // 执行 INSERT/UPDATE/DELETE，返回 { changes, lastInsertRowid }
```

`run()` 的返回值：
```ts
const result = db.prepare("INSERT INTO messages ...").run(...);
result.changes;          // 受影响的行数（INSERT 通常是 1）
result.lastInsertRowid;  // 新插入行的自增 id（AUTOINCREMENT 用到）
```

---

## 五、事务（Transaction）

### 5.1 事务解决什么问题

事务保证**一组操作要么全成功，要么全回滚**——不留半截状态。

本项目保存一轮对话时要写两条消息（user + assistant）：

```
不用事务：
  1. INSERT user 消息  → 成功 ✓
  2. INSERT assistant 消息  → 失败 ✗（比如磁盘满了）
  结果：留下一条没回复的 user 消息（半截状态）

用事务：
  BEGIN
  1. INSERT user 消息  → 成功 ✓
  2. INSERT assistant 消息  → 失败 ✗
  ROLLBACK  → 第 1 条也撤销
  结果：两条都没存，干干净净
```

### 5.2 三个命令

```sql
BEGIN;       -- 开启事务
-- 这里放多条 SQL
COMMIT;      -- 全部成功，提交（永久写入）
ROLLBACK;    -- 有失败，回滚（全部撤销）
```

对应代码（`db.ts` + `messages/route.ts`）：
```ts
// db.ts 导出三个辅助函数
export function db_begin() { db.exec("BEGIN"); }
export function db_commit() { db.commit("COMMIT"); }
export function db_rollback() { db.exec("ROLLBACK"); }

// messages/route.ts 用法
try {
  db_begin();
  addMessage({ ..., role: "user", ... });
  addMessage({ ..., role: "assistant", ... });
  db_commit();
} catch (err) {
  db_rollback();  // 任一条失败，全部撤销
}
```

> **注意**：better-sqlite3 有 `db.transaction(fn)` 的包装函数（自动管 BEGIN/COMMIT/ROLLBACK），node:sqlite 目前没有，本项目手动写了三个辅助函数。

---

## 六、时间戳：SQLite 怎么存日期

### 6.1 SQLite 没有日期类型

这是新手常困惑的点。SQLite **没有 DATE/DATETIME 类型**（写了也会被当成 TEXT/NUMERIC 处理）。存日期有三种主流做法：

| 存法 | 例 | 本项目用 | 说明 |
|---|---|---|---|
| TEXT（ISO 8601） | `"2026-07-14T10:30:00.000Z"` | ✅ 用这个 | 可读、排序正确、跨语言友好 |
| INTEGER（Unix 秒） | `1720950600` | | 省空间，不可读 |
| INTEGER（Unix 毫秒） | `1720950600000` | | 同上 |

本项目用 TEXT：
```ts
const now = new Date().toISOString();
// now = "2026-07-14T10:30:00.000Z"（ISO 8601 标准格式）
```

### 6.2 为什么 TEXT 能正确排序

ISO 8601 字符串有个巧妙特性——**字符串排序正好对应时间排序**：

```
"2026-07-14T10:30:00.000Z"  ← 早
"2026-07-14T10:30:01.000Z"
"2026-07-14T11:00:00.000Z"  ← 晚
```

因为 ISO 格式是"年-月-日-时-分-秒"，高位在前，字典序比较时高位先比较。所以：
```sql
ORDER BY created_at ASC  -- 字符串升序 = 时间从早到晚，正确
```

如果用 `"07/14/2026"` 这种格式，字符串排序就乱了（"07" > "06" 但年份可能不同）。所以**存时间一定用 ISO 8601**。

---

## 七、PRAGMA：SQLite 的配置开关

`PRAGMA` 是 SQLite 专用的配置命令，项目里用到一条：

```ts
db.exec("PRAGMA foreign_keys = ON;");  // 开启外键约束
```

其它你可能见到的 PRAGMA（本项目没用，了解即可）：
```sql
PRAGMA journal_mode = WAL;   -- WAL 模式，提升并发写入性能
PRAGMA table_info(messages); -- 查看表结构（调试用）
```

---

## 八、node:sqlite API 速查表

本项目用的所有 node:sqlite API，一张表搞定：

| API | 作用 | 用在 |
|---|---|---|
| `new DatabaseSync(path)` | 打开/创建数据库文件 | db.ts 初始化 |
| `db.exec(SQL字符串)` | 执行 SQL（不带参数，不返回行） | 建表、PRAGMA、BEGIN/COMMIT |
| `db.prepare(SQL).get(...params)` | 查询，返回第一行或 undefined | 按主键查单条 |
| `db.prepare(SQL).all(...params)` | 查询，返回所有行的数组 | 查多条 |
| `db.prepare(SQL).run(...params)` | 执行 INSERT/UPDATE/DELETE | 增删改 |
| `result.changes` | run() 返回，受影响行数 | 判断是否成功 |
| `result.lastInsertRowid` | run() 返回，新插入的自增 id | 拿到 AUTOINCREMENT 的 id |

### prepare + exec 的区别（容易混）

| | `db.exec(SQL)` | `db.prepare(SQL)` |
|---|---|---|
| 能否传参数（? 占位符） | ❌ 不能 | ✅ 能 |
| 返回数据 | ❌ 不返回行 | ✅ get/all 返回行 |
| 适合 | 建表、配置、事务控制 | 查询、带参数的增删改 |

```ts
// exec：执行不返回数据的 SQL
db.exec("CREATE TABLE ...");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("BEGIN");

// prepare：执行需要参数或要返回数据的 SQL
db.prepare("SELECT * FROM messages WHERE id = ?").get(5);
db.prepare("INSERT INTO messages ... VALUES (?, ?, ?)").run(...);
```

---

## 九、对照项目代码：把以上串起来

带着上面的知识，重新看 `lib/queries.ts`，每行都应该能看懂：

```ts
// 建表（db.ts）
db.exec("PRAGMA foreign_keys = ON;");          // §7 开启外键
db.exec(`CREATE TABLE IF NOT EXISTS messages ( // §2.1 建表
  id INTEGER PRIMARY KEY AUTOINCREMENT,        // §2.1 主键+自增
  conversation_id TEXT NOT NULL,               // §2.1 NOT NULL
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE  // §3.1/3.2 外键+级联
)`);
db.exec("CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);");  // §3.4 索引

// 插入（queries.ts）
db.prepare(                                    // §4.3 prepared statement
  "INSERT INTO conversations (id, title, system_prompt, created_at) VALUES (?, ?, ?, ?)"  // §2.2 INSERT + §4 ?占位符
).run(params.id, params.title ?? null, params.systemPrompt ?? null, now);  // §6 now 是 ISO 字符串

// 查询单条
db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);  // §2.3 SELECT + get()

// 查询多条（排序）
db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(conversationId);
//                                                                         §2.3 ORDER BY    §6 字符串排序=时间排序

// 更新
db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(title, id);  // §2.4 UPDATE

// 删除（CASCADE 自动连带删消息）
db.prepare("DELETE FROM conversations WHERE id = ?").run(id);  // §2.5 DELETE + §3.2 CASCADE

// 事务（messages/route.ts）
db.exec("BEGIN");                              // §5.2 开启事务
addMessage(...);                               //   INSERT user
addMessage(...);                               //   INSERT assistant
db.exec("COMMIT");                             //   提交
// 出错时：
db.exec("ROLLBACK");                           //   回滚
```

---

## 十、常见疑问

### Q：为什么 conversations.id 用 TEXT（UUID），messages.id 用 INTEGER（自增）？
**答**：conversations.id 要暴露在 URL 里（`/chat/xxx`），用 UUID 防泄露规模、防遍历（见文档 12）。messages.id 只在数据库内部用（前端渲染的 key），不需要对外，用自增整数更省空间、更快。

### Q：NULL 和空字符串 `""` 一样吗？
**答**：不一样。`NULL` 表示"未知/没有值"，`""` 表示"值为空"。本项目里 `title` 列允许 NULL（新建会话时还没标题）；`content` 列是 NOT NULL，即使是 `""` 也必须有值。查询时 `WHERE title = NULL` 是错的（永远查不到），要写 `WHERE title IS NULL`。

### Q：为什么 .run() 里的参数有时传 null 有时不传？
**答**：看列是不是 NOT NULL。`title TEXT`（可空）允许传 null；`content TEXT NOT NULL` 必须传实际值，传 null 会报错。代码里 `params.title ?? null` 是"如果有 title 就用，没有就 null"。

### Q：聊天记录会无限增长吗？
**答**：会。本项目没有做清理机制。长期运行的话，可以加"超过 N 条自动归档"或"按时间清理"的逻辑。学习项目先不管。

### Q：如何直接看 chat.db 里有什么？
**答**：装个 DB Browser for SQLite（免费 GUI 工具），打开 chat.db 文件就能看表、跑 SQL。或者命令行：
```bash
# 如果装了 sqlite3 命令行工具
sqlite3 chat.db
sqlite> .tables              # 列出所有表
sqlite> SELECT * FROM conversations;
sqlite> SELECT * FROM messages;
sqlite> .quit
```

---

## 十一、学习路径建议

如果看完这份还想深入：

1. **练手**：用 DB Browser for SQLite 打开本项目的 chat.db，手动跑几条 SELECT/INSERT/UPDATE/DELETE，感受每条 SQL 的效果
2. **进阶概念**（本项目没用到，但真实项目常见）：
   - **JOIN**：跨表查询（比如"查所有消息 + 它所属会话的标题"）
   - **聚合函数**：COUNT/SUM/AVG（比如"每个会话有多少条消息"）
   - **LIMIT/OFFSET**：分页查询
   - **迁移（migration）**：表结构变更管理
3. **换数据库**：本项目用的是 SQLite，学完可以试试 Postgres（语法大部分通用），理解服务型数据库的区别

---

## 速查总结（一页纸）

```
建表：   CREATE TABLE IF NOT EXISTS 表名 (列定义, 约束)
插入：   INSERT INTO 表名 (列...) VALUES (?, ?, ...)
查询：   SELECT */列 FROM 表名 WHERE 条件 ORDER BY 列 ASC/DESC
更新：   UPDATE 表名 SET 列 = ? WHERE 条件
删除：   DELETE FROM 表名 WHERE 条件

主键：   PRIMARY KEY（唯一标识一行）
自增：   INTEGER PRIMARY KEY AUTOINCREMENT
非空：   NOT NULL
外键：   FOREIGN KEY (列) REFERENCES 表(列) ON DELETE CASCADE
索引：   CREATE INDEX 名 ON 表(列)

防注入： 永远用 ? 占位符 + .run(params)，不要字符串拼接
事务：   BEGIN / COMMIT / ROLLBACK（原子性）
时间：   用 TEXT 存 ISO 8601 字符串（new Date().toISOString()）

外键坑： SQLite 默认关闭外键，必须 PRAGMA foreign_keys = ON
```
