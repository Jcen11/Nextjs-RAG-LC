# JS / Web 工程面试八股

> 对应项目：Nextjs-RAG-LC（阶段 5/10/11/14/16）
> 配套文档：`10.中止生成与错误处理.md`、`14.全局状态管理.md`、`Zustand使用文档.md`、`16.路线B重构.md`
>
> 这份是"工程能力"八股——流式、中断、竞态、状态管理。这些是中高级前端岗的区分题。

---

## 一、流式响应（SSE / Stream）

### 【概念⭐⭐】什么是 SSE？和 WebSocket 的区别？
SSE（Server-Sent Events）是服务器单向推消息给浏览器的协议，基于 HTTP。WebSocket 是双向通信。

| | SSE | WebSocket |
|---|---|---|
| 方向 | 服务器→浏览器（单向） | 双向 |
| 协议 | HTTP | 独立协议（ws://） |
| 适合 | 服务器推（AI 回复、通知） | 实时双向（聊天室、游戏） |
| 复杂度 | 低（就是 HTTP） | 高 |

**项目举例**：AI 聊天的流式回复用 SSE——服务器边生成边推 token，浏览器边接收边显示。

---

### 【概念⭐⭐】ReadableStream / getReader 是什么？怎么消费一个流？
Web 标准的流式数据结构。`response.body` 是个 ReadableStream，用 `getReader()` 拿到 reader，循环 `reader.read()` 取数据块：
```ts
const reader = response.body.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const text = decoder.decode(value, { stream: true });
  // 处理 text
}
```

**项目举例**：ChatBox 流式接收 AI 回复（`10.中止生成与错误处理.md`）。

---

### 【追问⭐⭐⭐】`decoder.decode(value, { stream: true })` 的 `stream: true` 干嘛的？
告诉 TextDecoder"后面还有数据"。多字节字符（如中文）可能被分包切断——第一个 chunk 末尾是半个 UTF-8 序列。`stream: true` 让 decoder 把不完整的部分缓冲，等下一个 chunk 拼完整再输出。不加会导致中文乱码。

---

### 【决策⭐⭐⭐】（路线 A vs B 对比）裸 fetch 解析 SSE 和 LangChain 的 model.stream 有什么区别？
**裸 fetch（Nextjs-RAG 项目）**：
```ts
const response = await fetch(`${baseURL}/chat/completions`, { body: ... });
const reader = response.body.getReader();
while (true) {
  const { done, value } = await reader.read();
  // 手动按 \n 分行、找 data: 前缀、JSON.parse、取 delta.content
}
```

**ChatOpenAI（Nextjs-RAG-LC 项目）**：
```ts
const stream = await model.stream(messages);
for await (const chunk of stream) {
  const token = chunk.content;  // LangChain 已经解析好了
}
```

差异：
- 裸 fetch 要手写 SSE 协议解析（data: 行、[DONE]、JSON 容错）
- ChatOpenAI 返回 async iterable，直接遍历取 `.content`
- 裸 fetch 更底层、可控；ChatOpenAI 更简洁、但要依赖 LangChain

详见 `16.路线B重构.md`。

---

## 二、中断（AbortController）

### 【概念⭐⭐】AbortController 是什么？怎么用？
Web 标准 API，用来中断异步操作（fetch）。
```ts
const controller = new AbortController();
fetch(url, { signal: controller.signal });
controller.abort();  // 中断
```

三件套：`signal`（传给 fetch 挂号）、`abort()`（中断）、`signal.aborted`（判断是否已中断）。

---

### 【决策⭐⭐】为什么 abortRef 用 useRef 不用 useState？
AbortController 是组件内部"遥控器"，用户看不到、改它不该触发重渲染。且 state 更新异步，点停止那一刻可能拿不到最新 controller。useRef 同步、不触发渲染。详见 `React-Nextjs八股.md`。

---

### 【排查⭐⭐⭐】（杀手锏题）讲一下你项目里"停止生成"的完整中断链路
**讲五环链路**（`10.中止生成与错误处理.md` 第六节）：
1. 用户点"停止" → handleStop 调 `abortRef.current.abort()`
2. fetch 被 abort，前端到后端的 HTTP 连接断
3. 后端 `request.signal` 触发，调 `upstreamController.abort()`，后端到上游的 fetch 也断
4. 后端那条返回给前端的 ReadableStream 失去消费者，运行时调 `stream.cancel()`
5. `cancel()` 里调 `reader.cancel()`，解除后端读上游的 reader 阻塞

**关键点**：少了任何一环，中断都不彻底。`stream.cancel` + `reader.cancel` 是双保险（防 reader 卡在 await）。

---

### 【追问⭐⭐⭐】如果 100 个用户同时点停止，你的中断设计有什么价值？
没有 `stream.cancel`，每个中断的后端 reader 要等上游信号传过来才释放，可能卡几十 ms~几秒。100 个用户同时停 = 100 个 reader 堆积，占用连接池。有 cancel 立刻释放。这是"业余项目 vs 工程项目"的分水岭。

---

### 【追问⭐⭐】前端用 `controller.signal.aborted` 判断中止，为什么不用 `error.name === 'AbortError'`？
不同运行时 abort 抛的 error 可能不同，靠 error 类型判断不可靠。`controller.signal.aborted` 是我们自己创建的对象，状态完全可靠。详见 `10.中止生成与错误处理.md`。

---

### 【决策⭐⭐】中止后保留已生成内容（加"已停止"标记），而不是清空——为什么？
用户主动中止是**预期行为**，不是错误。已生成部分可能有用，保留 + 加标记比用错误样式覆盖合理。体现"区分预期中断和意外失败"的设计原则。

---

## 三、竞态条件

### 【概念⭐⭐】什么是竞态条件（race condition）？
多个异步操作抢同一个资源，执行顺序不固定，导致结果不确定。特征：**偶发、不稳定**——同样操作有时出 bug 有时不出。

---

### 【排查⭐⭐⭐】（必练故事）你项目里遇到过什么竞态 bug？怎么解决的？
**讲五轮 debug**（`12b.会话持久化补充.md`）。要点：
- 现象：消息显示后消失（闪烁）
- 用日志定位：清标记触发 useEffect 自我重跑，覆盖了消息
- 根因：useEffect 依赖数组自我触发
- 修复：justCreatedId 移出依赖，用 getState 读

---

### 【追问⭐⭐】解决竞态的通用思路有哪些？
1. **加标记/锁**（项目的 justCreatedId）：告诉一方"现在别动"
2. **取消旧操作**（useEffect 的 cancelled 标志）：让旧的失效
3. **串行化**：强制顺序执行
4. **单一数据源**（Zustand store）：避免多处 state 互相覆盖

---

### 【决策⭐⭐】useEffect 里的 `cancelled` 标志解决什么问题？
竞态：快速切换会话 A→B，A 的请求还没回就发了 B 的。如果 A 后回来，会把 A 的消息覆盖到 B 上。cleanup 函数设 `cancelled = true`，旧请求回来直接 return 不 setState。

---

## 四、错误处理

### 【决策⭐⭐⭐】你的 chat 路由有哪几层错误处理？为什么要分层？
分层 try/catch（`10.中止生成与错误处理.md`）：
1. **请求体解析**（`request.json()` 包 try/catch）——防非法 JSON
2. **上游 fetch**（包 try/catch + AbortController signal）——防连不上/超时
3. **上游错误体**（`response.json()` 包 try/catch）——防上游返回非 JSON
4. **SSE 单行解析**（每行 JSON.parse 包 try/catch + continue）——防一行坏数据崩整条流

原则：**局部失败不拖垮全局**。每层独立兜底。

---

### 【决策⭐⭐】HTTP 状态码 400/500/502/504 你怎么用？为什么区分？
- 400 Bad Request：请求体非法（JSON 格式错、参数缺失）
- 500 Internal Error：服务端自己出错（没配 key、上游返回非 ok）
- 502 Bad Gateway：连不上上游（网络层）
- 504 Gateway Timeout：上游超时/客户端中断

区分状态码方便监控/日志系统一眼看出是哪类问题。

---

### 【追问⭐⭐】"Failed to fetch" 和"服务端返回 500"在前端怎么分别处理？
- 500：fetch 正常 resolve，`response.ok === false`，走 `if (!response.ok)` 分支，读 `data.reply` 显示后端提示
- "Failed to fetch"：fetch 根本没连上，抛 TypeError，进 catch 块，显示"网络连接失败"

两者是两条不同的处理路径。

---

## 五、TypeScript

### 【概念⭐】catch 的 error 为什么是 `unknown` 类型？怎么处理？
TS 严格模式下 catch 的 error 默认是 `unknown`，不能直接 `error.message`。要先类型判断：
```ts
catch (error: unknown) {
  const isNetworkError = error instanceof TypeError && error.message === "Failed to fetch";
}
```
强迫你先确认 error 是什么再访问属性，更安全。

---

### 【概念⭐】`as unknown as T` 双重类型断言是什么？为什么要两次？
绕过 TS 检查强制当成类型 T。一次 `as T` 如果类型差异太大会报错，先转 `unknown`（任何类型都能转 unknown）再转 T 就绕过了。

**项目举例**：`globalThis as unknown as { db: DatabaseSync }`——globalThis 默认类型没有 db 属性，直接写会报错。详见 `12.会话持久化.md` db.ts 解读。

---

### 【概念⭐】`A ?? B`（空值合并）是什么？
A 是 `null` 或 `undefined` 才用 B，否则用 A。和 `||` 的区别：`||` 对所有 falsy 值（0、""、false）都触发，`??` 只对 null/undefined 触发。

**项目举例**：`globalForDb.db ?? new DatabaseSync(...)`——有现成连接就复用，没有才新建。

---

## 六、闭包 / 作用域

### 【概念⭐⭐】什么是闭包？项目里哪里用到了？
函数捕获其定义时的作用域变量。即使外层函数返回，内层函数仍能访问那些变量。

**项目举例**：
- `onClick={() => handleSelect(conv.id)}`——每次 map 循环的箭头函数捕获了当前的 conv，用户点哪个 button 就传哪个 conv.id
- catch 块里读 messages 是闭包旧值（捕获的是渲染时的），所以改用 getState 读实时值

---

### 【追问⭐⭐】为什么 `onClick={handleSelect(conv.id)}`（没有外层箭头函数）是错的？
那样会在**渲染时立刻执行** handleSelect，不是点击时才执行。外层 `() =>` 是"等点击时才调用"的关键。

---

## 七、进阶追问

### 【追问⭐⭐⭐】你的项目"前端流式结束后才保存消息"，如果用户中途关浏览器，数据怎么办？
**会丢**——前端不发 POST /api/messages，这轮对话完全丢失。改进：后端 tee 流边写边存，即使前端断了后端也能保留。这是已知改进点（`待学与待办.md`），面试可讲"考虑了数据完整性，规划用后端 tee 流解决"。

---

### 【追问⭐⭐⭐】如果上游 AI 服务挂了，你的项目怎么降级？
当前：返回 502 + 错误提示。可改进：
- 重试机制（指数退避）
- 多模型 fallback（主模型挂了切备用）
- 缓存上次成功响应
- 前端降级提示"AI 暂不可用，已保存您的消息"

---

### 【追问⭐⭐】流式响应里，如果某个 chunk 解析失败，整个聊天会崩吗？
不会。SSE 单行解析包了 try/catch + continue（`10.中止生成与错误处理.md` 3.4 节）。一行坏数据跳过，后续 token 照常显示。体现"局部失败不拖垮全局"。

---

## 速查（一页纸）

```
SSE：服务器单向推，基于 HTTP；WebSocket 双向
ReadableStream：getReader + 循环 read，done 表示结束
decode(value, {stream:true})：处理多字节字符分包

AbortController：signal 挂号 / abort 中断 / aborted 判断
五环中断链路：前端abort→fetch断→request.signal→上游abort→reader.cancel
保留中止内容：预期行为不当错误

竞态特征：偶发不稳定
解决：标记/锁、取消旧操作、串行化、单一数据源
useEffect cancelled 标志：防切换会话的旧请求覆盖

错误分层：请求体/上游fetch/错误体/SSE单行 各自 try/catch
状态码：400参数错/500服务端/502连不上/504超时
Failed to fetch：进 catch；500：进 !response.ok 分支

TS：catch 的 error 是 unknown，要先类型判断
as unknown as T：双重断言绕过检查
A ?? B：A 是 null/undefined 才用 B

闭包：函数捕获定义时的变量
onClick={() => fn(x)}：等点击才调；onClick={fn(x)}：渲染时立刻调
```
