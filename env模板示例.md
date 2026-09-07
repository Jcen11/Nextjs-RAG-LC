# 聊天接口环境变量示例

当前 `app/api/chat/route.ts` 已改为 OpenAI 兼容方式，并默认适配硅基流动。

## 硅基流动 OpenAI 兼容方式

```env
SILICONFLOW_API_KEY=你的硅基流动 key
OPENAI_BASE_URL=https://api.siliconflow.cn/v1
OPENAI_MODEL=Qwen/Qwen3-8B
```

## 当前代码的读取方式

`app/api/chat/route.ts` 当前逻辑：

1. 读取 `SILICONFLOW_API_KEY`
2. 读取 `OPENAI_BASE_URL`，默认值是 `https://api.siliconflow.cn/v1`
3. 读取 `OPENAI_MODEL`，默认值是 `Qwen/Qwen3-8B`
4. 服务端向 `${OPENAI_BASE_URL}/chat/completions` 发送 OpenAI 兼容格式请求

## 请求格式说明

当前服务端发送的是：

```json
{
  "model": "你的模型名",
  "messages": [
    {
      "role": "user",
      "content": "用户输入的消息"
    }
  ],
  "stream": false
}
```

这就是标准的 OpenAI 兼容聊天请求格式。

## 最小建议

你现在最重要的是确认两件事：

1. 硅基流动给你的真实模型名是什么
2. 你本地 `.env.local` 里的变量名已经切换为 `OPENAI_BASE_URL` 和 `OPENAI_MODEL`

只要这两点正确，前端页面结构和 `fetch('/api/chat')` 都不需要改。
