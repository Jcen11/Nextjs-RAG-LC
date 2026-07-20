"use client";

// 知识库管理面板（模态框）
//
// 功能：
// 1. 列出所有知识库 + 每个库下的文档
// 2. 新建知识库
// 3. 给知识库上传文档（读 .txt 文件 → POST 文本 → 后端切块+嵌入+存）
// 4. 删除知识库（连带删文档元数据 + 向量库里的向量）
//
// 数据来源：从 store 读 knowledgeBases（Sidebar mount 时已 refreshKnowledgeBases）
// 刷新机制：新建/删除后主动调 refreshKnowledgeBases 更新 store
//
// 为什么用模态框而不是独立路由：改动小，且知识库管理是"偶尔用"的功能，
// 不值得给它单独一个页面。点 Sidebar 的"📚 知识库"按钮打开，操作完关闭。

import { useEffect, useRef, useState } from "react";
import { useChatStore } from "@/lib/store";
import type { KnowledgeBase, KnowledgeDocument } from "@/lib/queries";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function KnowledgePanel({ open, onClose }: Props) {
  const knowledgeBases = useChatStore((s) => s.knowledgeBases);
  const refreshKnowledgeBases = useChatStore((s) => s.refreshKnowledgeBases);

  // 展开的库 id（手风琴效果，一次看一个库的文档）
  const [expandedKbId, setExpandedKbId] = useState<string | null>(null);
  // 当前展开库的文档列表
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);

  // 新建知识库
  const [newKbName, setNewKbName] = useState("");

  // 上传状态
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 面板打开时刷新一次列表
  useEffect(() => {
    if (open) {
      refreshKnowledgeBases();
    }
  }, [open, refreshKnowledgeBases]);

  // 不渲染时返回 null（模态框关闭）
  if (!open) return null;

  // 新建知识库
  async function handleCreateKb() {
    const name = newKbName.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setNewKbName("");
        await refreshKnowledgeBases();
      }
    } catch {
      // 静默失败
    }
  }

  // 展开/收起某个库，展开时加载它的文档列表
  async function toggleExpand(kb: KnowledgeBase) {
    if (expandedKbId === kb.id) {
      setExpandedKbId(null);
      return;
    }
    setExpandedKbId(kb.id);
    try {
      const res = await fetch(`/api/knowledge/${kb.id}`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents);
      } else {
        setDocuments([]);
      }
    } catch {
      setDocuments([]);
    }
  }

  // 上传文档到当前展开的库
  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !expandedKbId) return;

    setUploading(true);
    setUploadMsg(`正在上传并索引 ${file.name}...`);

    try {
      // 读文件内容（起步只支持文本文件）
      const content = await file.text();

      const res = await fetch(`/api/knowledge/${expandedKbId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, content }),
      });

      if (res.ok) {
        const data = await res.json();
        setUploadMsg(`✓ ${file.name} 已索引（${data.chunkCount} 块）`);
        // 刷新文档列表
        const docsRes = await fetch(`/api/knowledge/${expandedKbId}`);
        if (docsRes.ok) {
          setDocuments((await docsRes.json()).documents);
        }
      } else {
        const err = await res.json();
        setUploadMsg(`✗ 上传失败：${err.error || "未知错误"}`);
      }
    } catch (err) {
      setUploadMsg(`✗ 上传失败：${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setUploading(false);
      // 清空 input，允许重复上传同一文件
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // 删除知识库
  async function handleDeleteKb(kb: KnowledgeBase) {
    if (!window.confirm(`确定删除知识库「${kb.name}」吗？所有文档和向量都会删除。`)) {
      return;
    }
    try {
      const res = await fetch(`/api/knowledge/${kb.id}`, { method: "DELETE" });
      if (res.ok) {
        if (expandedKbId === kb.id) {
          setExpandedKbId(null);
          setDocuments([]);
        }
        await refreshKnowledgeBases();
      }
    } catch {
      // 静默失败
    }
  }

  return (
    <div className="kb-panel-overlay" onClick={onClose}>
      {/* 点遮罩关闭；点内容不关闭（stopPropagation） */}
      <div className="kb-panel" onClick={(e) => e.stopPropagation()}>
        <div className="kb-panel-header">
          <h2>📚 知识库管理</h2>
          <button className="kb-panel-close" onClick={onClose} type="button">
            ✕
          </button>
        </div>

        {/* 新建知识库 */}
        <div className="kb-create">
          <input
            className="kb-create-input"
            value={newKbName}
            onChange={(e) => setNewKbName(e.target.value)}
            placeholder="知识库名（如：前端面试资料）"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateKb();
            }}
          />
          <button
            className="kb-create-btn"
            onClick={handleCreateKb}
            disabled={!newKbName.trim()}
            type="button"
          >
            新建
          </button>
        </div>

        {/* 知识库列表 */}
        <ul className="kb-list">
          {knowledgeBases.length === 0 && (
            <li className="kb-empty">还没有知识库，新建一个试试</li>
          )}
          {knowledgeBases.map((kb) => {
            const isExpanded = expandedKbId === kb.id;
            return (
              <li key={kb.id} className="kb-item">
                <div className="kb-item-header">
                  <button
                    className="kb-item-name"
                    onClick={() => toggleExpand(kb)}
                    type="button"
                  >
                    {isExpanded ? "▼" : "▶"} {kb.name}
                  </button>
                  <button
                    className="kb-action-btn"
                    onClick={() => handleDeleteKb(kb)}
                    type="button"
                    title="删除知识库"
                  >
                    🗑
                  </button>
                </div>

                {isExpanded && (
                  <div className="kb-item-body">
                    {/* 文档列表 */}
                    {documents.length === 0 ? (
                      <p className="kb-docs-empty">还没有文档</p>
                    ) : (
                      <ul className="kb-docs">
                        {documents.map((doc) => (
                          <li key={doc.id} className="kb-doc">
                            📄 {doc.filename}
                            <span className="kb-doc-meta">{doc.chunkCount} 块</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* 上传文档 */}
                    <div className="kb-upload">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".txt,.md,.markdown"
                        onChange={handleUpload}
                        disabled={uploading}
                      />
                      {uploadMsg && <p className="kb-upload-msg">{uploadMsg}</p>}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
