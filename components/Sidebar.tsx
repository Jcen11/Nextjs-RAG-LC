"use client";

// 会话侧边栏：列出所有会话，支持切换/重命名/删除/新建
//
// 阶段 14 改造：从全局 store 读 conversations 和 currentId，不再用 usePathname 解析 URL。
// 列表数据由 store 管理，create/rename/delete 后主动刷新（不再依赖 pathname 变化触发）。
// 详见 14.全局状态管理.md。

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useChatStore } from "@/lib/store";
import type { Conversation } from "@/lib/queries";

export default function Sidebar() {
  const router = useRouter();

  // 从 store 读状态（currentId 由 [id]/page.tsx 的 SyncConversationId 同步进来）
  const conversations = useChatStore((s) => s.conversations);
  const currentId = useChatStore((s) => s.currentId);
  const refreshConversations = useChatStore((s) => s.refreshConversations);

  // 纯 UI 临时状态留在组件 useState
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  // mount 时拉一次列表（后续由 ChatBox 保存消息后调 refreshConversations 刷新）
  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  // 新建会话：跳到 /chat（无 id），store.currentId 会被清空（见 /chat/page.tsx 的逻辑）
  function handleNew() {
    router.push("/chat");
  }

  // 切换会话：跳到 /chat/[id]（store→URL），URL 变化后 SyncConversationId 同步回 store
  function handleSelect(id: string) {
    if (id === currentId) return; // 已经在当前会话，不重复跳
    router.push(`/chat/${id}`);
  }

  // 开始重命名：把对应会话标题填进 input，进入编辑态
  function startEdit(conv: Conversation) {
    setEditingId(conv.id);
    setEditTitle(conv.title);
  }

  // 提交重命名：PATCH 后端，然后刷新列表
  async function commitEdit(id: string) {
    const title = editTitle.trim();
    setEditingId(null);

    if (!title) return; // 空标题不提交

    try {
      const res = await fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        // 刷新列表显示新标题
        refreshConversations();
      }
    } catch {
      // 静默失败
    }
  }

  // 删除会话
  async function handleDelete(id: string) {
    if (!window.confirm("确定删除这个会话吗？删除后无法恢复。")) {
      return;
    }

    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) return;

      // 如果删的是当前会话，跳回 /chat（新建会话入口）
      if (id === currentId) {
        router.push("/chat");
      }
      // 刷新列表（删的非当前会话也要更新列表）
      refreshConversations();
    } catch {
      // 静默失败
    }
  }

  return (
    <aside className="sidebar">
      <button className="sidebar-new-btn" onClick={handleNew} type="button">
        + 新建会话
      </button>

      <ul className="sidebar-list">
        {conversations.length === 0 && (
          <li className="sidebar-empty">还没有会话</li>
        )}
        {conversations.map((conv) => {
          const isActive = conv.id === currentId;
          const isEditing = editingId === conv.id;

          return (
            <li
              key={conv.id}
              className={`sidebar-item${isActive ? " active" : ""}`}
            >
              {isEditing ? (
                // 重命名态：显示 input
                <input
                  className="sidebar-edit-input"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  // 回车提交
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit(conv.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  // 失焦提交
                  onBlur={() => commitEdit(conv.id)}
                  // 自动聚焦
                  autoFocus
                />
              ) : (
                // 正常态：显示标题 + 操作按钮
                <>
                  <button
                    className="sidebar-item-title"
                    onClick={() => handleSelect(conv.id)}
                    type="button"
                    title={conv.title || "新会话"}
                  >
                    {conv.title || "新会话"}
                  </button>
                  <span className="sidebar-actions">
                    <button
                      className="sidebar-action-btn"
                      onClick={() => startEdit(conv)}
                      type="button"
                      title="重命名"
                    >
                      ✏
                    </button>
                    <button
                      className="sidebar-action-btn"
                      onClick={() => handleDelete(conv.id)}
                      type="button"
                      title="删除"
                    >
                      🗑
                    </button>
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
