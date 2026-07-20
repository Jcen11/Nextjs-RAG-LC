"use client";

// 知识库选择器（ChatBox 内的下拉）
//
// 用户在这里选当前会话绑定哪个知识库：
// - 选"纯对话"：currentKbId = null，发消息不走 RAG
// - 选某知识库：currentKbId = 该库 id，发消息走 RAG（检索+注入）
//
// 切换知识库时：
// 1. 立即更新 store.currentKbId（前端马上响应，下次发消息就走新模式）
// 2. PATCH 后端，把会话的 kb_id 持久化（刷新后保持）
//
// 为什么 currentKbId 放 store：ChatBox 发请求时要从 store 读它（带进 /api/chat body）
// 为什么同时 PATCH 后端：刷新页面时 useEffect 从数据库加载会话，要能恢复绑定的知识库

import { useChatStore } from "@/lib/store";
import type { KnowledgeBase } from "@/lib/queries";

export default function KbSelector({ conversationId }: { conversationId: string | null }) {
  const knowledgeBases = useChatStore((s) => s.knowledgeBases);
  const currentKbId = useChatStore((s) => s.currentKbId);
  const setCurrentKbId = useChatStore((s) => s.setCurrentKbId);

  // 还没创建会话时，不允许选知识库（先发条消息创建会话再说）
  // 因为知识库是绑在会话上的，没会话就没地方绑
  const disabled = !conversationId;

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newKbId = e.target.value || null; // 空字符串 = 纯对话 = null
    setCurrentKbId(newKbId);

    // 持久化到后端（会话已存在才 PATCH）
    if (conversationId) {
      try {
        await fetch(`/api/conversations/${conversationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kbId: newKbId }),
        });
      } catch {
        // 持久化失败不影响前端使用（最多刷新后恢复成旧值）
      }
    }
  }

  return (
    <div className="kb-selector-wrap">
      <label className="kb-selector-label">📚 知识库：</label>
      <select
        className="kb-selector"
        value={currentKbId ?? ""}
        onChange={handleChange}
        disabled={disabled}
        title={disabled ? "先发送一条消息创建会话" : "选择当前会话绑定的知识库"}
      >
        <option value="">纯对话（不检索知识库）</option>
        {knowledgeBases.map((kb: KnowledgeBase) => (
          <option key={kb.id} value={kb.id}>
            {kb.name}
          </option>
        ))}
      </select>
    </div>
  );
}
