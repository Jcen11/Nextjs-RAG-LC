// GET  /api/knowledge        —— 列出所有知识库
// POST /api/knowledge        —— 新建知识库
//
// 请求体（POST）：{ name: string }
// 返回（POST）：{ id, name, createdAt }

import { createKnowledgeBase, listKnowledgeBases } from "@/lib/queries";
import { randomUUID } from "node:crypto";

export async function GET() {
  const knowledgeBases = listKnowledgeBases();
  return Response.json({ knowledgeBases });
}

export async function POST(request: Request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体不是合法的 JSON" }, { status: 400 });
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!name) {
    return Response.json({ error: "知识库名不能为空" }, { status: 400 });
  }

  const id = randomUUID();
  createKnowledgeBase({ id, name });

  return Response.json({ id, name, createdAt: new Date().toISOString() });
}
