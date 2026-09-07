import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // chromadb 内部有一个指向 devDependencies 的动态 import
  // （@chroma-core/default-embed，Chroma 自带的默认嵌入函数），
  // 安装 chromadb 时不会带上它；但 Vercel 打包时会静态解析该 import，
  // 报 "Module not found: Can't resolve '@chroma-core/default-embed'"。
  //
  // 我们只用 chromadb 的客户端功能（ChromaClient/CloudClient），
  // 嵌入由 LangChain + bge-m3 完成，永远不会触发默认嵌入函数。
  // 所以把它标记为服务端外部包：构建时不打包，运行时由 Node 直接加载，
  // webpack 不会碰它内部的 import，问题从根上绕开。
  serverExternalPackages: ["chromadb"],
};

export default nextConfig;
