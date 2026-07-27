import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type Connect, type Plugin } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import type { IncomingMessage, ServerResponse } from "http"

// ============================================================
// LLM 代理中间件
// 优先级：请求头 x-llm-key（用户自带密钥 → api.moonshot.cn）
//        → 环境变量 MOONSHOT_API_KEY（→ api.moonshot.cn）
//        → 内置 KIMI_API_KEY 网关（本地兜底）
// ============================================================

const PUBLIC_BASE = "https://api.moonshot.cn/v1"

function resolveUpstream(req: IncomingMessage, env: Record<string, string>) {
  const headerKey = (req.headers["x-llm-key"] as string | undefined)?.trim()
  const headerBase = (req.headers["x-llm-base"] as string | undefined)?.trim()
  if (headerKey) {
    // 用户自带密钥：可用 x-llm-base 指定任意 OpenAI 兼容端点
    let base = (headerBase || PUBLIC_BASE).replace(/\/+$/, "")
    if (!/^https?:\/\//.test(base)) base = `https://${base}`
    return { url: `${base}/chat/completions`, key: headerKey, mode: "byok" as const }
  }
  if (env.MOONSHOT_API_KEY) {
    const base = (env.MOONSHOT_BASE_URL || PUBLIC_BASE).replace(/\/+$/, "")
    return { url: `${base}/chat/completions`, key: env.MOONSHOT_API_KEY, mode: "env" as const }
  }
  if (env.KIMI_API_KEY && env.KIMI_BASE_URL) {
    const base = env.KIMI_BASE_URL.replace(/\/+$/, "")
    return { url: `${base}/v1/chat/completions`, key: env.KIMI_API_KEY, mode: "builtin" as const }
  }
  return null
}

function llmProxyPlugin(env: Record<string, string>): Plugin {
  const statusHandler: Connect.NextHandleFunction = (_req, res: ServerResponse) => {
    const fakeReq = { headers: {} } as IncomingMessage
    const up = resolveUpstream(fakeReq, env)
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({
      configured: !!up,
      mode: up?.mode ?? "none",
    }))
  }

  const chatHandler: Connect.NextHandleFunction = (req: IncomingMessage, res: ServerResponse) => {
    const up = resolveUpstream(req, env)
    if (!up) {
      res.statusCode = 503
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({ error: { message: "未配置任何 LLM 密钥" } }))
      return
    }
    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", async () => {
      try {
        let outBody = body
        // 内置网关（kimi-for-coding）对 temperature 有严格限制，移除客户端自定义值
        if (up.mode === "builtin") {
          try {
            const parsed = JSON.parse(body) as Record<string, unknown>
            delete parsed.temperature
            outBody = JSON.stringify(parsed)
          } catch {
            /* 解析失败则透传原始 body */
          }
        }
        const upstream = await fetch(up.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${up.key}`,
          },
          body: outBody,
        })
        res.statusCode = upstream.status
        const contentType = upstream.headers.get("content-type") ?? "application/json"
        res.setHeader("Content-Type", contentType)
        if (!upstream.body) {
          res.end()
          return
        }
        // 流式透传
        const reader = upstream.body.getReader()
        const pump = async () => {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            res.write(value)
          }
          res.end()
        }
        pump().catch(() => res.end())
      } catch (e) {
        res.statusCode = 502
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify({ error: { message: `上游请求失败: ${String(e)}` } }))
      }
    })
  }

  return {
    name: "medpaper-llm-proxy",
    configureServer(server) {
      server.middlewares.use("/api/llm/status", statusHandler)
      server.middlewares.use("/api/llm/chat", chatHandler)
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/llm/status", statusHandler)
      server.middlewares.use("/api/llm/chat", chatHandler)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), "") } as Record<string, string>
  return {
    base: './',
    plugins: [inspectAttr(), react(), llmProxyPlugin(env)],
    server: {
      port: 3000,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  }
});
