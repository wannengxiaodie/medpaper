// ============================================================
// LLM 客户端（经 Vite 中间件代理，密钥不落前端代码）
// 未配置密钥时所有函数优雅降级（返回 null / 抛错由调用方回退）
// ============================================================

export interface LlmStatus {
  configured: boolean;
  mode: "byok" | "env" | "builtin" | "none";
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const LS_KEY = "medpaper.llmKey";
const LS_MODEL = "medpaper.llmModel";
const LS_BASE = "medpaper.llmBase";

export const DEFAULT_BASE = "https://api.moonshot.cn/v1";

/** 常用 OpenAI 兼容服务商预设 */
export interface ProviderPreset {
  id: string;
  name: string;
  base: string;
  models: string[];
  keyHint: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "moonshot", name: "Kimi (Moonshot)",
    base: "https://api.moonshot.cn/v1",
    models: ["kimi-k2.6", "kimi-k3", "moonshot-v1-32k", "moonshot-v1-128k"],
    keyHint: "platform.moonshot.cn",
  },
  {
    id: "deepseek", name: "DeepSeek",
    base: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    keyHint: "platform.deepseek.com",
  },
  {
    id: "qwen", name: "通义千问",
    base: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-plus", "qwen-max", "qwen-turbo"],
    keyHint: "bailian.console.aliyun.com",
  },
  {
    id: "openai", name: "OpenAI",
    base: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini"],
    keyHint: "platform.openai.com",
  },
  {
    id: "custom", name: "自定义",
    base: "",
    models: [],
    keyHint: "任意 OpenAI 兼容端点",
  },
];

export function getSavedKey(): string {
  return localStorage.getItem(LS_KEY) ?? "";
}
export function saveKey(key: string) {
  if (key) localStorage.setItem(LS_KEY, key);
  else localStorage.removeItem(LS_KEY);
}
export function getSavedModel(): string {
  return localStorage.getItem(LS_MODEL) ?? "kimi-k2.6";
}
export function saveModel(model: string) {
  localStorage.setItem(LS_MODEL, model);
}
export function getSavedBase(): string {
  return localStorage.getItem(LS_BASE) ?? DEFAULT_BASE;
}
export function saveBase(base: string) {
  if (base && base !== DEFAULT_BASE) localStorage.setItem(LS_BASE, base);
  else localStorage.removeItem(LS_BASE);
}

export async function checkStatus(apiKey: string): Promise<LlmStatus> {
  // 用户在前端输入了密钥时，视为 byok 已配置（静态托管下 /api 不存在，必须先判断）
  if (apiKey.trim()) return { configured: true, mode: "byok" };
  try {
    const res = await fetch("/api/llm/status");
    const data = (await res.json()) as LlmStatus;
    return data;
  } catch {
    return { configured: false, mode: "none" };
  }
}

async function postChat(body: Record<string, unknown>, apiKey: string, apiBase?: string): Promise<Response> {
  const key = apiKey.trim();
  // 填了自有 Key：浏览器直连服务商（线上静态托管无代理，必须直连；本地开发同样可用）
  if (key) {
    const base = (apiBase?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
    // 与本地代理保持一致：不透传 temperature（Kimi k2 系模型会拒绝该字段）
    const directBody = { ...body };
    delete directBody.temperature;
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(directBody),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`LLM 直连失败 (${res.status}): ${text.slice(0, 200)}`);
      }
      return res;
    } catch (e) {
      // 业务错误（4xx/5xx）直接抛出；网络/CORS 错误回退本地代理（仅本地开发存在）
      if (!(e instanceof TypeError)) throw e;
    }
  }
  // 本地代理（内置引擎网关，仅本地开发环境存在）
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const res = await fetch("/api/llm/chat", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM 请求失败 (${res.status}): ${text.slice(0, 200)}`);
  }
  return res;
}

/** 非流式对话，返回完整文本；空内容（推理耗尽额度）时加倍 max_tokens 重试一次 */
export async function chat(messages: ChatMessage[], opts: { apiKey: string; model: string; base?: string; maxTokens?: number }): Promise<string> {
  let budget = opts.maxTokens ?? 4096;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await postChat(
      {
        model: opts.model,
        messages,
        max_tokens: budget,
        temperature: 0.6,
      },
      opts.apiKey,
      opts.base,
    );
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    if (content) return content;
    // 推理模型可能把额度全部耗在 reasoning 上导致 content 为空，加倍额度重试
    budget = Math.min(budget * 2, 16384);
  }
  throw new Error("LLM 返回空内容");
}

/** 流式对话，逐 token 回调，返回完整文本；空输出时加倍 max_tokens 重试一次 */
export async function chatStream(
  messages: ChatMessage[],
  opts: { apiKey: string; model: string; base?: string; maxTokens?: number; onToken: (full: string) => void; signal?: AbortSignal },
): Promise<string> {
  let budget = opts.maxTokens ?? 4096;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await postChat(
      {
        model: opts.model,
        messages,
        max_tokens: budget,
        temperature: 0.6,
        stream: true,
      },
      opts.apiKey,
      opts.base,
    );
    const reader = res.body?.getReader();
    if (!reader) throw new Error("响应不可读");
    const decoder = new TextDecoder();
    let full = "";
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta: string = json?.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            full += delta;
            opts.onToken(full);
          }
        } catch {
          /* 忽略不完整的分片 */
        }
      }
    }
    if (full) return full;
    // 推理模型可能把额度全部耗在 reasoning 上导致零输出，加倍额度重试
    budget = Math.min(budget * 2, 16384);
  }
  throw new Error("LLM 返回空内容");
}

/** 让模型输出 JSON，并从回复中稳健提取 */
export async function chatJson<T>(
  messages: ChatMessage[],
  opts: { apiKey: string; model: string; base?: string; maxTokens?: number },
): Promise<T> {
  const text = await chat(messages, opts);
  return extractJson<T>(text);
}

function extractJson<T>(text: string): T {
  // 去掉 markdown 代码围栏
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  // 尝试直接解析
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    /* fallthrough */
  }
  // 提取第一个 {...} 或 [...] 块（贪婪到配平）
  const start = cleaned.search(/[{[]/);
  if (start === -1) throw new Error("LLM 回复中未找到 JSON");
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === open) depth++;
    else if (cleaned[i] === close) {
      depth--;
      if (depth === 0) {
        return JSON.parse(cleaned.slice(start, i + 1)) as T;
      }
    }
  }
  throw new Error("LLM 回复 JSON 不完整");
}
