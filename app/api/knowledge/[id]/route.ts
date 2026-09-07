// GET    /api/knowledge/[id]  —— 取知识库详情 + 它下面的文档列表
// DELETE /api/knowledge/[id]  —— 删除知识库（连带删文档元数据 + 向量库里的向量）

import {
  getKnowledgeBase,
  listDocuments,
  deleteKnowledgeBase,
} from "@/lib/queries";
import { vectorStore } from "@/lib/vectorstore";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;

  const kb = getKnowledgeBase(id);
  if (!kb) {
    return Response.json({ error: "知识库不存在" }, { status: 404 });
  }

  const documents = listDocuments(id);
  return Response.json({ knowledgeBase: kb, documents });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;

  const kb = getKnowledgeBase(id);
  if (!kb) {
    return Response.json({ error: "知识库不存在" }, { status: 404 });
  }

  // 先删向量库里的向量（异步），再删 SQLite 元数据
  // SQLite 的 ON DELETE CASCADE 会连带删 documents 表的元数据
  try {
    await vectorStore.delete(id);
  } catch {
    // 向量库删除失败不阻断（可能本来就空），继续删元数据
  }
  deleteKnowledgeBase(id);

  return Response.json({ ok: true });
}
