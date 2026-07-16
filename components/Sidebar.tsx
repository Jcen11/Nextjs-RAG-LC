"use client";

// 会话侧边栏：列出所有会话，支持切换/重命名/删除/新建
//
// 这是一个 client component，因为它有大量交互（点击、编辑、删除）和客户端导航。
// 数据来源：GET /api/conversations（列表）。
// 刷新机制：usePathname 监听路由变化 → 路由变了就重新拉列表。
//   这样用户切换会话/新建会话后，侧边栏自动同步（事件驱动，不轮询）。

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

type Conversation = {
  id: string;
  title: string;
  createdAt: string;
};

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  // 当前正在重命名的会话 id（null = 没在重命名）
  const [editingId, setEditingId] = useState<string | null>(null);
  // 重命名 input 的临时值
  const [editTitle, setEditTitle] = useState("");

  // 从 URL 提取当前会话 id（/chat/xxx → xxx；/chat → 无）
  // pathname 形如 "/chat/f47ac10b-..." 或 "/chat"
  const currentId = pathname.startsWith("/chat/") ? pathname.slice("/chat/".length) : null;

  // 拉取会话列表
  async function loadConversations() {
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations);
    } catch {
      // 静默失败，侧边栏空着也不影响聊天
    }
  }

  // mount 时拉一次 + pathname 变化时重新拉
  // pathname 变化 = 用户切换了会话或新建了会话，此时列表可能需要更新
  // （新建会话保存后才有标题，切换会话不需要更新但拉一下也无妨）
  useEffect(() => {
    loadConversations();
  }, [pathname]);

  // 新建会话：跳到 /chat（无 id），ChatBox 会进入新建流程
  function handleNew() {
    router.push("/chat");
  }

  // 切换会话：跳到 /chat/[id]
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
        loadConversations();
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
      loadConversations();
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
