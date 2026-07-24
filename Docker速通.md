# Docker 速通（为换 Chroma + 部署做准备）

> 这份文档假设你几乎没用过 Docker。看完能：看懂 Docker 命令、自己跑起一个 Chroma 容器、理解"容器化部署"是怎么回事。
>
> **目的**：阶段 18 要把向量库从 MemoryVectorStore 换成 Chroma，Chroma 需要 Docker 跑服务。这份是前置知识。

---

## 一、Docker 是什么（一句话心智模型）

**Docker 是"把应用 + 它的运行环境打包成一个可移植的盒子"的工具**。

举个例子：你要跑 Chroma（向量数据库）。不用 Docker 的话，你要装 Python、装 Chroma 的依赖、配环境变量、处理版本冲突……换台电脑再来一遍。用 Docker：

```bash
docker run -p 8000:8000 chromadb/chroma
```

一行命令，Chroma 就跑起来了——因为 Docker 镜像里已经打包了"Chroma + 它需要的所有东西"。你在任何装了 Docker 的机器上跑这行，结果一样。

### 三个核心概念

| 概念 | 类比 | 说明 |
|---|---|---|
| **镜像（Image）** | 安装包/光盘 | 只读的模板，包含应用 + 环境。`chromadb/chroma` 就是一个镜像 |
| **容器（Container）** | 运行中的程序 | 镜像"跑起来"就是容器。一个镜像可以跑多个容器 |
| **仓库（Registry）** | 应用商店 | 存镜像的地方，Docker Hub 是最大的公共仓库 |

```
镜像（Image）──docker run──> 容器（Container）
  chromadb/chroma              正在跑的 Chroma 服务
  （静态模板）                  （活的进程）
```

---

## 二、安装 Docker

### Windows（你的环境）
1. 装 **Docker Desktop for Windows**：https://www.docker.com/products/docker-desktop/
2. 前提：Win10/11 64位，**开启 WSL2**（Windows Subsystem for Linux），BIOS 开虚拟化
3. 装完启动 Docker Desktop，等右下角鲸鱼图标变绿

### 验证安装
```bash
docker --version          # 看到 Docker version 2x.x.x 说明装好
docker run hello-world    # 跑个测试镜像，看到 "Hello from Docker!" 就成功
```

### ⚠️ 常见坑（Windows）
- **WSL2 没装**：Docker Desktop 会提示，按指引装
- **BIOS 虚拟化没开**：重启进 BIOS，开 VT-x/AMD-V
- **公司机器锁权限**：有些公司机器不让装虚拟化，这种情况只能换自己电脑或用云服务器

---

## 三、最常用的命令（记住这几个就够起步）

### 拉取镜像
```bash
docker pull chromadb/chroma      # 从 Docker Hub 下载镜像到本地
```

### 运行容器（最常用）
```bash
docker run -d -p 8000:8000 --name chroma chromadb/chroma
```
拆解每个参数：
- `run`：基于镜像创建并启动容器
- `-d`：后台运行（detach），不占终端
- `-p 8000:8000`：端口映射，`主机端口:容器端口`。把容器内的 8000 端口映射到主机 8000，这样你访问 `localhost:8000` 就能用到容器里的服务
- `--name chroma`：给容器起个名字（不写的话 Docker 随机起）
- `chromadb/chroma`：用的镜像名

### 查看容器
```bash
docker ps                # 看正在运行的容器
docker ps -a             # 看所有容器（包括已停止的）
```

### 停止/启动/删除容器
```bash
docker stop chroma       # 停止容器（数据还在，能再启动）
docker start chroma      # 再启动
docker rm chroma         # 删除容器（数据没了，除非挂了卷）
```

### 查看日志（调试用）
```bash
docker logs chroma       # 看容器的输出日志
docker logs -f chroma    # 实时跟踪日志（像 tail -f）
```

### 删除镜像
```bash
docker rmi chromadb/chroma    # 删镜像（要先删掉用它的容器）
```

---

## 四、数据持久化：Volume（重点）

**容器是临时的**——删掉容器，里面的数据就没了。这对数据库是致命的（Chroma 存的向量会丢）。

### 解决：挂载 Volume

Volume = 把主机的某个目录"挂"到容器里，容器往里写数据实际写到主机上。容器删了，主机的数据还在。

```bash
docker run -d -p 8000:8000 \
  -v chroma_data:/chroma/chroma \
  --name chroma \
  chromadb/chroma
```
- `-v chroma_data:/chroma/chroma`：`主机卷名:容器内路径`。容器往 `/chroma/chroma` 写的数据，实际存在 Docker 管理的 `chroma_data` 卷里

### Volume 的两种形式

| 形式 | 例子 | 说明 |
|---|---|---|
| **命名卷**（推荐） | `-v chroma_data:/path` | Docker 管理的卷，名字是 chroma_data，迁移方便 |
| **绑定挂载** | `-v ./mydata:/path` | 直接挂主机的某个目录，能看到文件，但跨平台路径易出错 |

---

## 五、实战：跑起 Chroma 向量数据库

这是阶段 18 要做的事的预演。

### 完整命令（带持久化）
```bash
docker run -d \
  -p 8000:8000 \
  -v chroma_data:/chroma/chroma \
  --name chroma \
  chromadb/chroma
```

### 验证
```bash
# 看容器在跑
docker ps

# 测试 API（Chroma 默认有个 heartbeat 接口）
curl http://localhost:8000/api/v1/heartbeat
# 返回类似 {"nanosecond heartbeat":...} 说明服务正常
```

### 在你的项目里连 Chroma
Chroma 跑起来后，你的 `lib/vectorstore.ts` 用 HTTP 客户端连它（这就是 Chroma 的 client/server 模式 vs MemoryVectorStore 的 embedded 模式的区别）：

```ts
// 阶段 18 会改成类似这样
import { Chroma } from "@langchain/community/vectorstores/chroma";
const vectorStore = new Chroma(embeddings, {
  collectionName: kbId,
  url: process.env.CHROMA_URL || "http://localhost:8000",  // Docker 跑的地址
});
```

部署时把 `CHROMA_URL` 指向你的 Chroma 服务器地址。

---

## 六、docker-compose：多容器编排（进阶）

当你要同时跑多个服务（比如 Chroma + Postgres + 你的 Next.js 应用），一个个 `docker run` 太麻烦。`docker-compose` 用一个 YAML 文件定义所有服务，一条命令全启动。

### docker-compose.yml 例子（Chroma + 应用）
```yaml
version: "3.8"
services:
  chroma:
    image: chromadb/chroma
    ports:
      - "8000:8000"
    volumes:
      - chroma_data:/chroma/chroma

  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - CHROMA_URL=http://chroma:8000   # 容器间用服务名通信
    depends_on:
      - chroma

volumes:
  chroma_data:
```

### 启动/停止
```bash
docker-compose up -d      # 后台启动所有服务
docker-compose down       # 停止并删除所有容器
docker-compose logs -f    # 看所有服务日志
```

阶段 18 如果要自托管（不用 Vercel），用 docker-compose 把 Chroma + 应用一起管会很方便。

---

## 七、Docker vs 直接装在本机（为什么要用 Docker）

| | 直接装 | Docker |
|---|---|---|
| 装环境 | 手动装 Python/依赖/配版本 | 镜像里全包了 |
| 换机器 | 重装一遍 | 装 Docker 就行，`docker run` 一致 |
| 隔离 | 多个应用版本冲突 | 每个容器独立环境 |
| 卸载 | 要清理一堆东西 | `docker rm` 干净 |
| 学习成本 | 低（但每个应用不同） | 中（要学一套命令，但通用） |

**Chroma 用 Docker 的原因**：Chroma 的 server 模式依赖 Python 环境，自己装麻烦；官方提供 Docker 镜像，一行命令跑起来，环境统一。

---

## 八、和你项目的关系（阶段 18 预告）

```
当前（阶段 15-17）：
  lib/vectorstore.ts 用 MemoryVectorStore（进程内存）
  ↓ 问题：重启重嵌入、不能持久化、不能 serverless 部署

阶段 18 计划：
  1. Docker 跑 Chroma 容器（本文档教的）
  2. lib/vectorstore.ts 加 ChromaStore 实现（接口不变，业务代码零改动）
  3. 抽象层让换实现只改一个文件
```

**前提**：你这台机器要能装 Docker Desktop（见第二节的坑）。如果公司机器装不了，换自己电脑再做这步。

---

## 九、常见疑问

### Q：容器和虚拟机什么区别？
虚拟机虚拟整个操作系统（重，GB 级）。容器共享主机内核，只隔离应用和它的依赖（轻，MB 级）。容器启动秒级，虚拟机分钟级。

### Q：Docker 装在 Windows 会不会很卡？
Docker Desktop 用 WSL2 跑 Linux 容器，性能比老的 Hyper-V 好很多。日常开发够用。但磁盘 IO 密集的场景（大量向量写入）可能比原生 Linux 慢一些。

### Q：删容器数据就没了，那 Chroma 的向量不是每次重启都要重新嵌入？
不会，只要挂了 Volume（`-v chroma_data:/chroma/chroma`）。容器删了重建，卷里的向量还在。`docker rm` 删容器不会删命名卷；要删卷要 `docker volume rm chroma_data`。

### Q：Docker 和 Vercel 矛盾吗？
不矛盾，是两种部署方式：
- **Vercel**：托管你的 Next.js 应用（serverless），但 SQLite/MemoryVectorStore 不能用
- **Docker**：自托管（VPS/云服务器），可以跑 Chroma + SQLite + 应用一起，但要自己运维
阶段 18 要选其一（或组合）。

---

## 速查（一页纸）

```
三概念：镜像(模板) → docker run → 容器(运行中)
装：Docker Desktop + WSL2（Windows）
验证：docker --version / docker run hello-world

常用命令：
  docker pull <镜像>           拉镜像
  docker run -d -p 8000:8000 -v 卷:/路径 --name 名 <镜像>   跑容器
  docker ps / docker ps -a     看容器
  docker stop/start/rm <名>    停/启/删容器
  docker logs -f <名>          看日志
  docker rmi <镜像>            删镜像

持久化：-v 卷名:容器内路径（不然删容器数据没）
多服务：docker-compose up -d（一个 YAML 管所有服务）

跑 Chroma：
  docker run -d -p 8000:8000 -v chroma_data:/chroma/chroma --name chroma chromadb/chroma
  curl http://localhost:8000/api/v1/heartbeat 验证
```
