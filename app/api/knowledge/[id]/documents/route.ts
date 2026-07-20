// POST /api/knowledge/[id]/documents  —— 上传文档到指定知识库
//
// 请求体：{ filename: string, content: string, chunkSize?: number, chunkOverlap?: number }
//   - filename：文件名（存元数据，方便用户识别）
//   - content：文档的纯文本内容（前端读文件后传过来；起步只支持文本，PDF/Word 留后续）
//   - chunkSize/chunkOverlap：可选，覆盖默认切块参数
//
// 流程：切块 → 嵌入 → 存向量库 → 存 SQLite 元数据
// 返回：{ id, filename, chunkCount }
//
// 性能说明：嵌入要调外部 API（bge-m3），文档大时会慢（几百字约 200ms，几千字几秒）。
// 当前是同步等待完成才返回——简单但用户要等。
// 优化方向（留后续）：改成异步任务，立即返回 taskId，前端轮询进度。

import { getKnowledgeBase, addDocument } from "@/lib/queries";
import { indexDocument } from "@/lib/rag";
import { randomUUID } from "node:crypto";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;

  // 校验知识库存在
  const kb = getKnowledgeBase(id);
  if (!kb) {
    return Response.json({ error: "知识库不存在" }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体不是合法的 JSON" }, { status: 400 });
  }

  const filename =
    typeof body?.filename === "string" ? body.filename.trim() : "";
  const content = typeof body?.content === "string" ? body.content : "";

  if (!filename) {
    return Response.json({ error: "文件名不能为空" }, { status: 400 });
  }
  if (!content.trim()) {
    return Response.json({ error: "文档内容为空" }, { status: 400 });
  }

  const chunkSize = typeof body?.chunkSize === "number" ? body.chunkSize : undefined;
  const chunkOverlap =
    typeof body?.chunkOverlap === "number" ? body.chunkOverlap : undefined;

  // 核心：切块 + 嵌入 + 存向量库
  const documentId = randomUUID();
  let chunkCount: number;
  try {
    chunkCount = await indexDocument(
      id,
      content,
      { documentId, filename },
      { chunkSize, chunkOverlap },
    );
  } catch (err) {
    return Response.json(
      {
        error: `文档索引失败：${err instanceof Error ? err.message : "未知错误"}`,
      },
      { status: 500 },
    );
  }

  // 存元数据到 SQLite
  addDocument({ id: documentId, kbId: id, filename, chunkCount });

  return Response.json({
    id: documentId,
    filename,
    chunkCount,
  });
}
