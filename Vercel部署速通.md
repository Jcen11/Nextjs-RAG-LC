# Vercel 部署速通（Next.js 项目上线）

> 这份文档假设你没部署过 Next.js。看完能：理解 Vercel 是什么、知道你的项目部署要改什么、能照着步骤上线。
>
> **目的**：阶段 18 部署准备。你的项目有几个部署障碍（SQLite、MemoryVectorStore、env），这份讲清楚怎么处理。

---

## 一、Vercel 是什么（一句话）

**Vercel 是 Next.js 的官方托管平台**——把代码推上去，它自动构建、部署、给一个公网网址，别人就能访问你的应用。

Vercel 和 Next.js 是同一家公司做的，所以 Next.js 在 Vercel 上部署是最顺滑的（零配置）。

### Vercel vs 自己买服务器

| | Vercel | 自己买服务器（VPS） |
|---|---|---|
| 配置 | 零配置，推代码就部署 | 要装 Node/Nginx/配域名/HTTPS |
| 计费 | 免费额度够个人项目，超出按量 | 固定月费（不管用不用） |
| 扩容 | 自动 | 手动 |
| 文件系统 | **临时的**（serverless，关键限制） | 持久的 |
| 适合 | Web 应用、流量波动大 | 要持久文件/数据库/特殊环境 |

**Vercel 的核心特点**：它是 **serverless**（无服务器）——你的代码跑在临时的"函数实例"里，请求来了启动、处理完可能就销毁。这带来一个**致命限制**，下面专门讲。

---

## 二、⚠️ 你项目的部署障碍（最重要的一节）

你的项目现在有三个东西**不能直接部署到 Vercel**，必须改：

### 障碍 1：SQLite（node:sqlite）不能用 ❌

**原因**：Vercel 的 serverless 函数**文件系统是临时/只读的**。SQLite 是文件型数据库（chat.db 文件），函数实例销毁后文件就没了，下次请求是新实例，文件不存在。而且 node:sqlite 是实验性原生模块，Vercel 的 serverless 环境可能不支持。

**解决**：换**云数据库**，通过 HTTP 连接：
| 方案 | 说明 | 改动 |
|---|---|---|
| **Turso**（推荐） | SQLite 的云托管版（libSQL），SQL 几乎一样 | 改 lib/db.ts 的连接方式 |
| Supabase / Neon | 托管 Postgres，免费额度够用 | 改 SQL（大部分通用）+ 连接 |
| PlanetScale | 托管 MySQL | 类似 |

**推荐 Turso**：因为它是 SQLite 协议兼容，你的 SQL 语句几乎不用改，只改连接层（lib/db.ts）。

### 障碍 2：MemoryVectorStore 不能用 ❌

**原因**：同样——serverless 函数没有持久内存，每次请求是新实例，MemoryVectorStore 里的向量全丢。而且不同请求之间实例不共享内存。

**解决**：换**持久化向量库**：
| 方案 | 说明 |
|---|---|
| **Chroma**（自托管） | 用 Docker 跑 Chroma 服务，Vercel 通过 HTTP 连（见 Docker 速通） |
| Pinecone / Weaviate Cloud | 托管向量库，HTTP 连，免运维 |
| pgvector | 用 Postgres 存向量（如果选了 Supabase/Neon） |

**推荐 Chroma 自托管**：因为阶段 18 你本来就要换 Chroma，配一个云服务器跑 Chroma，Vercel 连它。

### 障碍 3：环境变量要重新配 ⚠️

**原因**：Vercel 不读你本地的 `.env.local`（那是本机开发用的）。部署时要手动配到 Vercel 后台。

**解决**：在 Vercel 项目设置里加环境变量（见第六节）。

### 改动总结

```
lib/db.ts        node:sqlite → Turso 客户端（SQL 不变）
lib/vectorstore.ts  MemoryVectorStore → Chroma HTTP 客户端（接口不变）
.env.local       → Vercel 后台配环境变量
额外服务          → 一个云服务器跑 Chroma（Docker）
```

---

## 三、部署前要把代码推到 GitHub

Vercel 从 Git 仓库拉代码自动部署。所以第一步是把项目推到 GitHub。

### 步骤
1. 在 GitHub 建个仓库（比如 `ai-knowledge-assistant`）
2. 本地项目连远程：
```bash
git remote add origin https://github.com/你的用户名/ai-knowledge-assistant.git
git push -u origin main
```
3. **重要**：确认 `.env.local` 没被推上去（`.gitignore` 里有 `.env*.local`）。在 GitHub 上看不到你的 key 才对。

### ⚠️ API key 安全
你的 `.env.local` 里有真实 API key。即使 `.gitignore` 拦住了，也要检查**历史提交**里有没有泄露过（之前阶段 12 重建过 git 历史，应该清了，但值得确认一次）。如果历史里有，去硅基流动控制台**重新生成 key**。

---

## 四、在 Vercel 部署（核心步骤）

### 步骤 1：导入项目
1. 注册/登录 https://vercel.com（用 GitHub 账号登录最方便）
2. 点 "Add New Project" → 选你的 GitHub 仓库 → Import

### 步骤 2：配置（Vercel 通常自动识别 Next.js）
- Framework Preset：自动识别为 Next.js（不用改）
- Build Command：`next build`（自动）
- Output Directory：`.next`（自动）
- 这些都不用动，Vercel 对 Next.js 零配置

### 步骤 3：配环境变量（关键）
在 "Environment Variables" 里逐个加（对应你 .env.local 的内容）：

| Key | Value | 说明 |
|---|---|---|
| `SILICONFLOW_API_KEY` | sk-xxx... | 硅基流动 key |
| `OPENAI_BASE_URL` | https://api.siliconflow.cn/v1 | |
| `OPENAI_MODEL` | Qwen/Qwen3-8B | |
| `OPENAI_EMBEDDING_MODEL` | BAAI/bge-m3 | |
| `CHROMA_URL` | http://你的Chroma服务器:8000 | 阶段18加了Chroma才需要 |

**注意**：
- 这些是**服务端变量**（不带 `NEXT_PUBLIC_` 前缀），只在 serverless 函数里能用，客户端 bundle 看不到，安全
- 如果某个变量要在**客户端**用，必须加 `NEXT_PUBLIC_` 前缀（比如 `NEXT_PUBLIC_APP_NAME`）

### 步骤 4：点 Deploy
Vercel 自动 build。成功后给你一个网址：`https://你的项目名.vercel.app`。

第一次部署大概率会**失败**（因为还没改 db/vectorstore）。这正常——先看报错，按第二节把障碍改了再重新部署。

---

## 五、环境变量的三个作用域（容易混）

| 前缀 | 在哪能用 | 例子 |
|---|---|---|
| 无前缀（`SILICONFLOW_API_KEY`） | **只服务端** | API key、数据库连接、模型名 |
| `NEXT_PUBLIC_` | 服务端 + 客户端 | 网站名、公开的 API 地址 |
| `VERCEL_` 开头 | Vercel 自动注入 | 部署信息，一般不用 |

**判断标准**：这个变量会让用户看到吗/暴露给浏览器危险吗？
- 危险（key、密码）→ 无前缀，只服务端
- 公开信息 → `NEXT_PUBLIC_`

你项目的变量全是服务端的（API key、模型名、连接串），都不加前缀。

---

## 六、部署后更新：自动 CI/CD

Vercel 最爽的一点：**你 push 代码到 GitHub，Vercel 自动重新部署**。

```
本地改代码 → git commit → git push
  → GitHub 收到
    → Vercel 检测到 push
      → 自动 build + 部署
        → 几分钟后新版本上线
```

不用手动操作。这就是 CI/CD（持续集成/持续部署）。每次 push，Vercel 还会给一个**预览地址**（Preview Deployment），可以先看效果再决定要不要正式上线。

---

## 七、Vercel 的免费额度（够个人项目吗）

个人项目（Hobby 计划，免费）：
- 带宽：100GB/月
- 函数执行：100GB-hours/月（够用）
- 构建时长：6000 分钟/月
- 部署：无限

对你的项目（聊天 + RAG，个人用/简历展示）**完全够用**。除非有真实大量用户，否则不会超。

---

## 八、部署架构（阶段 18 目标）

```
用户浏览器
  ↓ HTTPS
Vercel（你的 Next.js 应用，serverless）
  ├── 读会话/消息 → Turso（云 SQLite，HTTP 连）
  ├── RAG 向量检索 → Chroma（你的云服务器 Docker，HTTP 连）
  └── 调 LLM → 硅基流动（HTTP 连）
```

三个外部服务（Turso/Chroma/硅基流动）都是 HTTP 连接，Vercel 的 serverless 完全能用。这是"serverless + 托管服务"的标准架构。

### 为什么不把所有东西放一台服务器（Docker 自托管）

| | Vercel + 托管服务 | 全自托管（Docker） |
|---|---|---|
| 运维 | 几乎零（Vercel/Turso 管扩容、备份） | 全自己管（挂了要修、要备份） |
| 免费 | Vercel+Turso 都有免费额度 | 要买服务器（月费） |
| 简历 | "部署在 Vercel，用了 Turso/Chroma" | "Docker 自托管" |
| 学习 | serverless 架构 | 完整运维 |

**推荐起步用 Vercel + 托管**：省心、免费、简历能写。等流量大了再考虑自托管。

---

## 九、域名（可选，简历加分）

默认网址是 `项目名.vercel.app`。想用自己域名（比如 `ai.yourname.com`）：
1. 买个域名（阿里云/Cloudflare/Namecheap）
2. Vercel 项目设置 → Domains → 加你的域名
3. 按提示去域名商那里加 CNAME 记录
4. Vercel 自动配 HTTPS

简历上写"已部署，访问 xxx.com"比"vercel.app"更正式。

---

## 十、常见部署报错

### 报错：Module not found / node:sqlite
阶段 18 没改 db.ts 时会报。换成 Turso 客户端就好。

### 报错：Function timeout
Vercel serverless 默认 10 秒超时。RAG 嵌入/检索慢的话可能超时。解决：在 `vercel.json` 配 `maxDuration`：
```json
{
  "functions": {
    "app/api/chat/route.ts": { "maxDuration": 60 }
  }
}
```
Hobby 计划最长 60 秒。

### 报错：Environment variable not found
忘了在 Vercel 后台配变量。去 Settings → Environment Variables 检查。

### 报错：连接 Chroma 失败
Chroma 服务器没跑/地址错/没开外网访问。检查 `CHROMA_URL` 配的对不对、Chroma 容器在跑。

---

## 十一、和你项目的关系（阶段 18 步骤预告）

```
阶段 18 部署步骤：
1. 换 SQLite → Turso（改 lib/db.ts，SQL 不变）
2. 换 MemoryVectorStore → Chroma（改 lib/vectorstore.ts，接口不变）
3. 跑 Chroma 容器（云服务器，见 Docker 速通）
4. 代码推 GitHub
5. Vercel 导入项目 + 配环境变量
6. 部署 → 拿到公网网址
7. （可选）绑域名
```

每步都有对应的速通文档（本文档 + Docker 速通 + 项目里的 db.ts/vectorstore.ts）。

---

## 十二、常见疑问

### Q：Vercel 和 Netlify 什么区别？
都是 serverless 托管。Vercel 是 Next.js 官方的，对 Next.js 特性（SSR、ISR、App Router）支持最好。Netlify 也支持但不如 Vercel 顺。你这个 Next.js 项目首选 Vercel。

### Q：能不能不用 Vercel，自己部署？
能。用 Docker 把 Next.js + SQLite + Chroma 全打包，跑在 VPS 上（阿里云/腾讯云/Vultr）。好处是能用 SQLite（持久文件系统）、不用改 db.ts；坏处是要自己运维。见 Docker 速通第七节。

### Q：serverless 到底是什么？
传统服务器：一个长期运行的进程，等着处理请求。
Serverless：请求来了才启动一个临时实例处理，处理完销毁。按请求次数计费，没请求不花钱。缺点是没有持久状态（文件/内存都没了），所以 SQLite/MemoryVectorStore 用不了。

### Q：部署后别人能白嫖我的 API key 吗？
不会。服务端环境变量（无 `NEXT_PUBLIC_` 前缀）只在 serverless 函数里能用，不会打进客户端 bundle。别人 F12 看不到。但 key 的调用额度会被消耗（如果有人狂刷你的应用），可以加 rate limiting。

---

## 速查（一页纸）

```
Vercel = Next.js 官方托管平台，推代码自动部署
核心限制：serverless，文件系统临时 → SQLite/MemoryVectorStore 不能用

部署障碍与解决：
  SQLite → Turso（云 SQLite，SQL 不变）
  MemoryVectorStore → Chroma（自托管 Docker，HTTP 连）
  .env.local → Vercel 后台配环境变量

部署步骤：
  1. 代码推 GitHub
  2. Vercel 导入项目（自动识别 Next.js）
  3. 配环境变量（服务端的不加前缀）
  4. Deploy → 拿到 xxx.vercel.app

环境变量前缀：
  无前缀 = 只服务端（key、连接串）
  NEXT_PUBLIC_ = 客户端也能用（公开信息）

更新：git push → Vercel 自动重新部署（CI/CD）
免费额度：个人项目够用
超时：vercel.json 配 maxDuration（Hobby 最长 60s）
域名：买个域名 + Vercel Domains 配 CNAME
```
