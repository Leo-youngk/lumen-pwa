import { handleEpub } from './epub.mjs';
import { createParser } from 'eventsource-parser';
import { goBaseUrl, isOpenCodeGo, providerRoute, providerReasoningParams, providerChatUrl, providerModelsUrl, providerSessionHeaders, parseProviderUsage, usageEvent } from './provider.mjs';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/index.ts
var DEFAULT_BASE_URL = goBaseUrl;
var MAX_MESSAGES = 80;
var MAX_CONTENT_LENGTH = 4e5;
var MAX_TOTAL_CONTENT_LENGTH = 6e5;
var MAX_SYSTEM_LENGTH = 2e6;
var AUTH_COOKIE = "lumen_session";
var SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
var FIRST_BYTE_TIMEOUT_MS = 15e4;
var IDLE_TIMEOUT_MS = 12e4;
const HEARTBEAT_MS = 12_000;
function supportsReasoning(model) {
  const lower = model.toLowerCase();
  return lower.startsWith("deepseek-");
}
__name(supportsReasoning, "supportsReasoning");
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
__name(json, "json");
function providerRedirect(response) {
  return [301, 302, 303, 307, 308].includes(response.status);
}
function parseCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || null;
}
__name(parseCookie, "parseCookie");
function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(encodeBase64Url, "encodeBase64Url");
function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
__name(decodeBase64Url, "decodeBase64Url");
async function sessionSignature(secret, timestamp) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp));
  return encodeBase64Url(new Uint8Array(signature));
}
__name(sessionSignature, "sessionSignature");
async function createSession(secret) {
  const timestamp = String(Date.now());
  return `${timestamp}.${await sessionSignature(secret, timestamp)}`;
}
__name(createSession, "createSession");
async function verifySession(value, secret) {
  if (!value) return false;
  const [timestamp, signature] = value.split(".");
  const issuedAt = Number(timestamp);
  if (!timestamp || !signature || !Number.isFinite(issuedAt) || Date.now() - issuedAt > SESSION_TTL_SECONDS * 1e3 || issuedAt > Date.now() + 6e4) return false;
  const expected = await sessionSignature(secret, timestamp);
  try {
    const actualBytes = decodeBase64Url(signature);
    const expectedBytes = decodeBase64Url(expected);
    if (actualBytes.length !== expectedBytes.length) return false;
    let difference = 0;
    for (let index = 0; index < actualBytes.length; index += 1) difference |= actualBytes[index] ^ expectedBytes[index];
    return difference === 0;
  } catch {
    return false;
  }
}
__name(verifySession, "verifySession");
function constantTimeEqual(a, b) {
  const bytes = new TextEncoder();
  const actual = bytes.encode(a);
  const expected = bytes.encode(b);
  const length = Math.max(actual.length, expected.length, 1);
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < length; index += 1) difference |= (actual[index] ?? 0) ^ (expected[index] ?? 0);
  return difference === 0;
}
__name(constantTimeEqual, "constantTimeEqual");
async function isAuthenticated(request, env) {
  return Boolean(env.APP_ACCESS_TOKEN && await verifySession(parseCookie(request, AUTH_COOKIE), env.APP_ACCESS_TOKEN));
}
__name(isAuthenticated, "isAuthenticated");
async function handleAuth(request, env) {
  if (!env.APP_ACCESS_TOKEN) return json({ error: "\u670D\u52A1\u7AEF\u5C1A\u672A\u914D\u7F6E APP_ACCESS_TOKEN\u3002" }, 503);
  if (request.method === "GET") return json({ authenticated: await isAuthenticated(request, env) });
  if (request.method !== "POST") return json({ error: "\u4E0D\u652F\u6301\u7684\u8BA4\u8BC1\u65B9\u6CD5\u3002" }, 405);
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "\u8BF7\u6C42\u4F53\u4E0D\u662F\u6709\u6548 JSON\u3002" }, 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json({ error: "请求体必须是 JSON 对象。" }, 400);
  if (typeof payload.token !== "string" || !constantTimeEqual(payload.token, env.APP_ACCESS_TOKEN)) return json({ error: "\u8BBF\u95EE\u4EE4\u724C\u4E0D\u6B63\u786E\u3002" }, 401);
  const session = await createSession(env.APP_ACCESS_TOKEN);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return new Response(JSON.stringify({ authenticated: true }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Set-Cookie": `${AUTH_COOKIE}=${session}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}` }
  });
}
__name(handleAuth, "handleAuth");
function normalizeMessages(value) {
  if (!Array.isArray(value)) return null;
  const messages = value.slice(-MAX_MESSAGES).filter((item) => {
    if (!item || typeof item !== "object") return false;
    const candidate = item;
    return (candidate.role === "user" || candidate.role === "assistant") && typeof candidate.content === "string";
  }).map((item) => ({
    role: item.role,
    content: item.content.slice(0, MAX_CONTENT_LENGTH),
    // 思考模型(如 DeepSeek)在 thinking 模式下要求把 history 里的 reasoning_content
    // 原样回传，否则 400。这里只做透传，不解析、不丢弃。
    reasoning_content: typeof item.reasoning_content === "string" && item.reasoning_content ? item.reasoning_content.slice(0, MAX_CONTENT_LENGTH) : void 0
  }));
  if (!messages.length) return null;
  let total = 0;
  const limited = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const size = message.content.length + (message.reasoning_content?.length ?? 0);
    if (total + size > MAX_TOTAL_CONTENT_LENGTH) break;
    limited.unshift(message);
    total += size;
  }
  return limited.length ? limited : null;
}
__name(normalizeMessages, "normalizeMessages");
function deltaText(event) {
  const content = event.choices?.[0]?.delta?.content ?? event.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = part.text;
      return typeof text === "string" ? text : "";
    }).join("");
  }
  return typeof event.delta?.text === "string" ? event.delta.text : "";
}
__name(deltaText, "deltaText");
function deltaReasoning(event) {
  const reasoning = event.choices?.[0]?.delta?.reasoning_content;
  if (typeof reasoning === "string") return reasoning;
  if (event.type === "content_block_delta" && typeof event.delta?.thinking === "string") return event.delta.thinking;
  return "";
}
__name(deltaReasoning, "deltaReasoning");
class ChatFailure extends Error {
  constructor(message, code, status = 502, retryAfterMs) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}
function providerFailure(data, status, retryAfter) {
  const detail = data?.response?.error ?? data?.error ?? data;
  const message = typeof detail === "string" ? detail : detail?.message;
  const code = detail?.code ?? detail?.type ?? data?.response?.incomplete_details?.reason;
  if (status === 401 || status === 403) {
    return new ChatFailure("模型服务拒绝了请求，请检查 API Key 或模型权限。", "provider_auth");
  }
  if (/insufficient_quota|quota_exceeded|usage_limit_reached/i.test(code ?? "")) {
    return new ChatFailure("该模型的使用额度已用完，请检查额度或选择其他模型。", "provider_quota");
  }
  if (status === 429 || /rate_limit|too_many_requests/i.test(code ?? "")) {
    const ms = !retryAfter ? undefined : /^\d+$/.test(retryAfter)
      ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
    return new ChatFailure("模型服务请求过多，请稍等片刻。", "rate_limit", 429,
      Number.isFinite(ms) ? Math.max(0, ms) : undefined);
  }
  if (status === 413 || /context[_ ](?:length|window)|input[_ ]too[_ ]large|too many input tokens/i.test((code ?? "") + " " + (message ?? ""))) {
    return new ChatFailure("这次输入超过了模型可处理的上下文。", "context_limit", 413);
  }
  if (status === 408 || status === 504 || /timeout/i.test(code ?? "")) {
    return new ChatFailure("模型服务等待超时。", "upstream_timeout", 504);
  }
  if (status >= 500 || /overloaded|server_error|service_unavailable/i.test(code ?? "")) {
    return new ChatFailure("模型服务暂时繁忙，请稍后重试。", "upstream_unavailable", 503);
  }
  return new ChatFailure(typeof message === "string" && message.trim()
    ? message.slice(0, 350) : status ? "模型服务未完成这次回答（HTTP " + status + "）。" : "模型服务未完成这次回答。",
    "upstream_error", status);
}
function withDeadline(work, ms, onTimeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(onTimeout), ms);
    const settle = /* @__PURE__ */ __name((value) => {
      clearTimeout(timer);
      resolve(value);
    }, "settle");
    work.then(settle, error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
__name(withDeadline, "withDeadline");
async function keyFingerprint(key) {
  if (!key) return "none";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest).slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(keyFingerprint, "keyFingerprint");
function diag(event, data) {
  console.log(`[diag] ${event} ${JSON.stringify(data)}`);
}
__name(diag, "diag");
function upstreamApiKey(request, env) {
  const client = request.headers.get("X-Api-Key")?.trim().replace(/^Bearer\s+/i, "");
  const configured = env.OPENCODE_GO_API_KEY?.trim().replace(/^Bearer\s+/i, "");
  return { key: client || configured, source: client ? "client" : "server" };
}
__name(upstreamApiKey, "upstreamApiKey");
function upstreamBaseUrl(request, env) {
  const fallback = (env.OPENCODE_GO_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const client = request.headers.get("X-Api-Base")?.trim();
  if (!client) return { baseUrl: fallback, source: "server", error: null };
  if (!request.headers.get("X-Api-Key")?.trim() && client.replace(/\/+$/, "") !== fallback) {
    return { baseUrl: fallback, source: "server", error: "自定义接口需要填写该服务的 API Key。" };
  }
  let parsed;
  try {
    parsed = new URL(client);
  } catch {
    return { baseUrl: fallback, source: "server", error: "\u63A5\u53E3\u5730\u5740\u4E0D\u662F\u5408\u6CD5\u7684 URL\u3002" };
  }
  if (parsed.protocol !== "https:") return { baseUrl: fallback, source: "server", error: "\u63A5\u53E3\u5730\u5740\u5FC5\u987B\u662F https\u3002" };
  const host = parsed.hostname.toLowerCase();
  const isPrivate = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || /^(\[)?::1(\])?$/.test(host) || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (isPrivate) return { baseUrl: fallback, source: "server", error: "\u63A5\u53E3\u5730\u5740\u4E0D\u80FD\u6307\u5411\u5185\u7F51\u5730\u5740\u3002" };
  return { baseUrl: `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, ""), source: "client", error: null };
}
__name(upstreamBaseUrl, "upstreamBaseUrl");
async function handleLog(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "\u8BF7\u6C42\u4F53\u4E0D\u662F\u6709\u6548 JSON\u3002" }, 400);
  }
  diag("client", { ua: request.headers.get("User-Agent")?.slice(0, 120) ?? "", payload });
  return json({ ok: true });
}
__name(handleLog, "handleLog");
async function handleChat(request, env) {
  const startedAt = Date.now();
  const { key: apiKey, source: keySource } = upstreamApiKey(request, env);
  const keyId = await keyFingerprint(apiKey);
  if (!apiKey) {
    diag("chat.no-key", { keySource });
    return json({ error: "\u670D\u52A1\u7AEF\u8FD8\u6CA1\u6709\u914D\u7F6E OPENCODE_GO_API_KEY\uFF0C\u6216\u672A\u5728\u8BF7\u6C42\u5934\u4E2D\u643A\u5E26 X-Api-Key\u3002" }, 503);
  }
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "\u8BF7\u6C42\u4F53\u4E0D\u662F\u6709\u6548 JSON\u3002" }, 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json({ error: "请求体必须是 JSON 对象。" }, 400);
  const latestUser = Array.isArray(payload.messages) && payload.messages.findLast(message =>
    message?.role === "user" && typeof message.content === "string"
  );
  if (latestUser && latestUser.content.length > MAX_CONTENT_LENGTH) {
    return json({ error: "这条消息（含选中的引用）过长，请缩短后重试。" }, 413);
  }
  const messages = normalizeMessages(payload.messages);
  if (!messages) return json({ error: "\u81F3\u5C11\u9700\u8981\u4E00\u6761\u6709\u6548\u7684 user \u6216 assistant \u6D88\u606F\u3002" }, 400);
  const system = typeof payload.system === "string" ? payload.system : "";
  if (system.length > MAX_SYSTEM_LENGTH) return json({ error: "原文请求过大，无法完整发送。" }, 413);
  const { baseUrl, source: baseUrlSource, error: baseUrlError } = upstreamBaseUrl(request, env);
  if (baseUrlError) {
    diag("chat.bad-base-url", { error: baseUrlError });
    return json({ error: baseUrlError }, 400);
  }
  const model = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : env.OPENCODE_GO_MODEL || "deepseek-v4-pro";
  const lowerModel = model.toLowerCase();
  const endpointPath = providerRoute(baseUrl, lowerModel, payload.provider_protocol);
  const usesAnthropicEndpoint = endpointPath === "/messages";
  const usesResponses = endpointPath === "/responses";
  const modelSupportsReasoning = supportsReasoning(model);
  const maxTokens = Number.isSafeInteger(payload.max_tokens) && payload.max_tokens > 0
    ? payload.max_tokens
    : void 0;
  const reasoningParams = providerReasoningParams(endpointPath, payload.reasoning_effort, maxTokens ?? 65536);
  const openAiMessages = [
    // OpenAI 兼容端点用 system 角色；Anthropic 兼容端点用顶层 system 字段（见下）。
    ...system ? [{ role: "system", content: system }] : [],
    ...messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...modelSupportsReasoning && message.role === "assistant" && message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}
    }))
  ];
  const firstUserIndex = messages.findIndex((message) => message.role === "user");
  const anthropicRaw = messages.slice(firstUserIndex === -1 ? messages.length : firstUserIndex).map(({ role, content }) => ({ role, content }));
  const anthropicMessages = [];
  for (const message of anthropicRaw) {
    const last = anthropicMessages[anthropicMessages.length - 1];
    if (last && last.role === message.role) last.content += "\n\n" + message.content;
    else anthropicMessages.push({ ...message });
  }
  if (usesAnthropicEndpoint && !anthropicMessages.length) return json({ error: "\u81F3\u5C11\u9700\u8981\u4E00\u6761 user \u6D88\u606F\u3002" }, 400);
  const upstreamBody = usesAnthropicEndpoint ? JSON.stringify({
    model,
    messages: anthropicMessages,
    ...system ? { system } : {},
    max_tokens: maxTokens ?? 65536,
    ...reasoningParams,
    // Anthropic 兼容端点只接受 0~1 的温度；开启思考时通常要求不传温度，这里只做钳制。
    ...typeof payload.temperature === "number" ? { temperature: Math.min(1, Math.max(0, payload.temperature)) } : {},
    stream: true
  }) : usesResponses ? JSON.stringify({
    model,
    input: openAiMessages.filter(message => message.role !== "system").map(({ role, content }) => ({ role, content })),
    ...(system ? { instructions: system } : {}),
    max_output_tokens: Math.max(16, maxTokens ?? 8192),
    ...reasoningParams,
    stream: true
  }) : JSON.stringify({
    model,
    messages: openAiMessages,
    stream: true,
    stream_options: { include_usage: true },
    // reasoning 仅对支持的模型透传：true 开启思考，false 显式关闭。
    ...!payload.reasoning_effort && modelSupportsReasoning && typeof payload.reasoning === "boolean" ? { reasoning: payload.reasoning } : {},
    ...reasoningParams,
    ...typeof payload.temperature === "number" ? { temperature: payload.temperature } : {},
    ...maxTokens === void 0 ? {} : { max_tokens: maxTokens }
  });
  const totalChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  diag("chat.request", {
    model,
    endpoint: endpointPath,
    baseUrl,
    baseUrlSource,
    keySource,
    keyId,
    messages: messages.length,
    totalChars,
    systemChars: system.length,
    temperature: payload.temperature,
    maxTokens: payload.max_tokens,
    reasoning: payload.reasoning_effort ?? payload.reasoning
  });
  const upstreamController = new AbortController();
  const abortUpstream = () => upstreamController.abort(request.signal.reason);
  request.signal.addEventListener("abort", abortUpstream, { once: true });
  if (request.signal.aborted) abortUpstream();
  const firstContentTimeout = system || maxTokens >= 32768 || (payload.reasoning_effort && payload.reasoning_effort !== "none")
    ? 300_000 : FIRST_BYTE_TIMEOUT_MS;
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let reader;
  let pendingWrites = 0;
  async function write(text) {
    pendingWrites++;
    try {
      await writer.write(encoder.encode(text));
    } finally {
      pendingWrites--;
    }
  }
  const sse = data => "data: " + JSON.stringify(data) + "\n\n";

  // Flush the downstream response while the upstream is still preparing headers.
  void write(": connected\n\n").catch(() => {});
  const heartbeat = setInterval(() => {
    if (!pendingWrites) {
      void write(": keepalive\n\n").catch(() => {});
    }
  }, HEARTBEAT_MS);
  const connectionTimer = setTimeout(
    () => upstreamController.abort(new DOMException("连接模型服务超时。", "TimeoutError")),
    FIRST_BYTE_TIMEOUT_MS,
  );
  void writer.closed.catch(() => {
    upstreamController.abort();
    void reader?.cancel().catch(() => {});
  });

  void (async () => {
    let receivedText = 0;
    let receivedReasoning = 0;
    let eventCount = 0;
    let failure;
    let usage = null;
    let ended = false;
    let finishedAt = null;
    let truncated = false;
    let pending = [];
    let eof = false;
    try {
      upstreamController.signal.throwIfAborted();
      const sessionHeaders = providerSessionHeaders(baseUrl, payload.session_id);
      const fetchUpstream = body => fetch(providerChatUrl(baseUrl, endpointPath), {
        redirect: "manual",
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...sessionHeaders
        },
        body,
        signal: upstreamController.signal
      });
      let upstream = await fetchUpstream(upstreamBody);
      let detail;
      if (endpointPath === "/chat/completions" && [400, 422].includes(upstream.status)) {
        detail = await upstream.text();
        if (/stream_options|include_usage/i.test(detail)) {
          const retryBody = JSON.parse(upstreamBody);
          delete retryBody.stream_options;
          upstream = await fetchUpstream(JSON.stringify(retryBody));
          detail = undefined;
        }
      }
      if (providerRedirect(upstream)) {
        void upstream.body?.cancel().catch(() => {});
        throw new ChatFailure("模型服务要求跳转，请在设置中填写模型 API 的实际地址。", "provider_redirect");
      }
      if (!upstream.ok) {
        let data;
        try { data = JSON.parse(detail ?? await upstream.text()); } catch {}
        throw providerFailure(data, upstream.status, upstream.headers.get("Retry-After"));
      }
      if (!upstream.body) throw new ChatFailure("模型服务没有返回内容。", "upstream_interrupted");
      if (/^(application\/json|text\/html)\b/i.test(upstream.headers.get("Content-Type") ?? "")) {
        const data = await upstream.json().catch(() => null);
        if (data?.error) throw providerFailure(data);
        throw new ChatFailure("模型接口没有返回流式回复，请检查模型服务地址。", "bad_stream");
      }

      clearTimeout(connectionTimer);
      reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let lastContentAt = Date.now();
      const parser = createParser({
        maxBufferSize: 8 * 1024 * 1024,
        onError(error) {
          if (error.type === "max-buffer-size-exceeded") throw new ChatFailure("模型返回的单条数据过大。", "bad_stream");
        },
        onEvent({ data }) {
          if (ended || !data) return;
          if (data === "[DONE]") {
            ended = true;
            if (!usesAnthropicEndpoint && !usesResponses) finishedAt ??= Date.now();
            return;
          }
          let event;
          try { event = JSON.parse(data); } catch {
            throw eof
              ? new ChatFailure("模型连接在返回数据时中断。", "upstream_interrupted")
              : new ChatFailure("模型返回的数据格式异常。", "bad_stream");
          }
          if (!event || typeof event !== "object" || Array.isArray(event)) {
            throw new ChatFailure("模型返回的数据格式异常。", "bad_stream");
          }
          eventCount++;
          usage = parseProviderUsage(event, usage);
          if (event.type === "error" || event.error || event.type === "response.failed") throw providerFailure(event);

          if (usesResponses) {
            if (event.type === "response.completed") {
              finishedAt = Date.now();
              ended = true;
            }
            if (event.type === "response.incomplete") {
              const reason = event.response?.incomplete_details?.reason;
              if (reason !== "max_output_tokens") throw providerFailure(event);
              truncated = true;
              ended = true;
            }
          } else if (usesAnthropicEndpoint) {
            if (event.type === "message_stop") {
              finishedAt = Date.now();
              ended = true;
            }
            const reason = event.type === "message_delta" ? event.delta?.stop_reason : undefined;
            truncated ||= reason === "max_tokens" || reason === "model_context_window_exceeded";
            if (reason === "tool_use") throw new ChatFailure("模型返回了工具调用，当前对话无法完成这条回答。", "tool_call");
            if (reason === "pause_turn") throw new ChatFailure("模型暂停了回答。", "upstream_interrupted");
          } else {
            const reason = event.choices?.[0]?.finish_reason;
            if (reason === "content_filter") throw new ChatFailure("模型服务因内容限制中止了回答。", "content_filter");
            if (reason === "tool_calls" || reason === "function_call") {
              throw new ChatFailure("模型返回了工具调用，当前对话无法完成这条回答。", "tool_call");
            }
            if (reason === "stop" || reason === "length") finishedAt ??= Date.now();
            truncated ||= reason === "length";
          }

          const text = event.type === "response.output_text.delta" || event.type === "response.refusal.delta" ? event.delta : deltaText(event);
          const reasoning = event.type === "response.reasoning_summary_text.delta" ? event.delta : deltaReasoning(event);
          if (typeof text === "string" && text) {
            lastContentAt = Date.now();
            receivedText += text.length;
            pending.push(sse({ type: "text", text }));
          }
          if (typeof reasoning === "string" && reasoning) {
            lastContentAt = Date.now();
            receivedReasoning += reasoning.length;
            pending.push(sse({ type: "reasoning", text: reasoning }));
          }
        },
      });

      while (!ended) {
        const received = receivedText || receivedReasoning;
        const deadline = finishedAt === null
          ? lastContentAt + (received ? IDLE_TIMEOUT_MS : firstContentTimeout)
          : finishedAt + 1500; // A completions provider can send usage after finish_reason.
        const remaining = deadline - Date.now();
        const chunk = remaining > 0 ? await withDeadline(reader.read(), remaining, "timeout") : "timeout";
        if (chunk === "timeout") {
          if (finishedAt !== null) break;
          throw new ChatFailure(received
            ? "模型长时间没有继续输出。"
            : "模型长时间没有返回内容，可能正在排队或处理较长的输入。", "upstream_timeout", 504);
        }
        eof = chunk.done;
        parser.feed(eof ? decoder.decode() + "\n\n" : decoder.decode(chunk.value, { stream: true }));
        if (pending.length) {
          const data = pending.join("");
          pending = [];
          await write(data);
        }
        if (eof) break;
      }

      if (truncated) throw new ChatFailure("已达到模型本次输出上限。", "output_limit");
      if (finishedAt === null) throw new ChatFailure("模型连接中断，回答未完整返回。", "upstream_interrupted");
      if (!receivedText) throw new ChatFailure("模型没有返回正文。", "upstream_interrupted");
    } catch (error) {
      if (request.signal.aborted || (upstreamController.signal.aborted && upstreamController.signal.reason?.name !== "TimeoutError")) return;
      failure = error instanceof ChatFailure ? error : upstreamController.signal.reason?.name === "TimeoutError"
        ? new ChatFailure("连接模型服务超时，请稍后重试。", "upstream_timeout", 504)
        : new ChatFailure("模型服务连接中断。", "upstream_interrupted");
    } finally {
      clearTimeout(connectionTimer);
      clearInterval(heartbeat);
      request.signal.removeEventListener("abort", abortUpstream);
      void reader?.cancel().catch(() => {});
      upstreamController.abort();
      // Stopping from the client also releases a writer with a pending heartbeat.
      if (request.signal.aborted) void writer.abort(request.signal.reason).catch(() => {});
    }

    diag("chat.done", {
      model, endpoint: endpointPath, keySource, keyId, eventCount,
      textChars: receivedText, reasoningChars: receivedReasoning,
      failure: failure?.code ?? null, ms: Date.now() - startedAt
    });
    try {
      const reported = usageEvent(usage);
      if (reported) pending.push(sse(reported));
      if (failure) pending.push(sse({
        type: "error", error: failure.message, code: failure.code,
        status: failure.status, retryAfterMs: failure.retryAfterMs
      }));
      pending.push(sse({ type: "done" }));
      await write(pending.join(""));
      await writer.close();
    } catch {
      void writer.abort().catch(() => {});
    }
  })();
  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no"
    }
  });
}
__name(handleChat, "handleChat");
async function handleModels(request, env) {
  const { key: apiKey } = upstreamApiKey(request, env);
  if (!apiKey) return json({ error: "请在设置中填写模型服务的 API Key。" }, 503);
  const { baseUrl, error: baseUrlError } = upstreamBaseUrl(request, env);
  if (baseUrlError) return json({ error: baseUrlError }, 400);
  const go = isOpenCodeGo(baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1e4);
  try {
    const response = await fetch(providerModelsUrl(baseUrl), { headers: { Authorization: `Bearer ${apiKey}` }, signal: controller.signal, redirect: "manual" });
    if (providerRedirect(response)) {
      return json({ error: "模型列表接口要求跳转，请在设置中填写模型 API 的实际地址。" }, 502);
    }
    if (response.status === 401) {
      return json({ error: go
        ? "OpenCode 拒绝了这个 Key。请在 Console 的个人 API Keys 中复制所订阅 Go 工作区的有效密钥（oc_sk_ 开头）。"
        : "模型服务拒绝了这个 API Key，请检查是否有效。" }, 502);
    }
    if (response.status === 403) {
      return json({ error: go
        ? "这个 OpenCode Key 无权读取模型列表。请检查工作区和 Models › Read 权限。"
        : "这个 API Key 无权读取模型列表。" }, 502);
    }
    if (!response.ok) return json({ error: `模型列表接口返回 HTTP ${response.status}。` }, 502);
    const body = await response.json().catch(() => null);
    const list = Array.isArray(body) ? body : body?.data;
    if (!Array.isArray(list)) return json({ error: "模型列表格式有误，请确认接口地址填写的是基础地址。" }, 502);
    if (!go) return json(body);
    const models = list.filter((entry) => typeof entry?.id === "string" && (!entry.type || entry.type === "chat"));
    if (!models.length) {
      return json({ error: "这个 Key 对应的工作区没有可用的 Go 对话模型，请检查 Go 订阅和模型权限。" }, 502);
    }
    return json({ data: models });
  } catch {
    return json({ error: "连接模型列表失败，请检查接口地址或稍后重试。" }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
__name(handleModels, "handleModels");
var DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
var MAX_CLOUD_BODY_LENGTH = 2e7;
var MAX_CLOUD_CONVERSATIONS = 80;
var MAX_CLOUD_TOMBSTONES = 500;
function normalizeSettingsSync(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && item.length <= 2e3) out[key] = item;
  }
  return Object.keys(out).length ? out : void 0;
}
__name(normalizeSettingsSync, "normalizeSettingsSync");
function normalizeTombstones(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => {
    if (!item || typeof item !== "object") return false;
    const candidate = item;
    return typeof candidate.id === "string" && typeof candidate.at === "number" && Number.isFinite(candidate.at);
  }).slice(-MAX_CLOUD_TOMBSTONES);
}
__name(normalizeTombstones, "normalizeTombstones");
async function handleConversations(request, env) {
  const deviceId = request.headers.get("X-Device-Id") || "";
  if (!DEVICE_ID_PATTERN.test(deviceId)) return json({ error: "\u8BBE\u5907\u6807\u8BC6\u65E0\u6548\u3002" }, 400);
  const key = `conv:${deviceId}`;
  if (request.method === "GET") {
    const stored = await env.CONVERSATIONS.get(key);
    if (!stored) return json({ conversations: [], deleted: [] });
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return json({ conversations: parsed.slice(0, MAX_CLOUD_CONVERSATIONS), deleted: [] });
      const record = parsed;
      return json({
        conversations: Array.isArray(record.conversations) ? record.conversations.slice(0, MAX_CLOUD_CONVERSATIONS) : [],
        deleted: normalizeTombstones(record.deleted),
        settingsSync: normalizeSettingsSync(record.settingsSync) ?? null
      });
    } catch {
      return json({ conversations: [], deleted: [] });
    }
  }
  if (request.method === "PUT") {
    const raw = await request.text();
    if (!raw) return json({ error: "\u8BF7\u6C42\u4F53\u4E3A\u7A7A\u3002" }, 400);
    if (raw.length > MAX_CLOUD_BODY_LENGTH) return json({ error: "\u540C\u6B65\u6570\u636E\u8FC7\u5927\u3002" }, 413);
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return json({ error: "\u8BF7\u6C42\u4F53\u4E0D\u662F\u6709\u6548 JSON\u3002" }, 400);
    }
    const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
    const conversations = Array.isArray(payload) ? payload : record?.conversations;
    if (!Array.isArray(conversations)) return json({ error: "\u5BF9\u8BDD\u6570\u636E\u5FC5\u987B\u662F\u6570\u7EC4\u3002" }, 400);
    const settingsSync = normalizeSettingsSync(record?.settingsSync);
    await env.CONVERSATIONS.put(
      key,
      JSON.stringify({ conversations: conversations.slice(0, MAX_CLOUD_CONVERSATIONS), deleted: normalizeTombstones(record?.deleted), ...settingsSync ? { settingsSync } : {} })
    );
    return json({ ok: true });
  }
  return json({ error: "\u4E0D\u652F\u6301\u7684\u540C\u6B65\u65B9\u6CD5\u3002" }, 405);
}
__name(handleConversations, "handleConversations");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/auth") return handleAuth(request, env);
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204 });
      if (!await isAuthenticated(request, env)) return json({ error: "\u9700\u8981\u5148\u767B\u5F55\u3002" }, 401);
      if (url.pathname === "/api/health" && request.method === "GET") return json({ ok: true, provider: "opencode-go", model: env.OPENCODE_GO_MODEL || "deepseek-v4-pro" });
      if (url.pathname === "/api/epub" && request.method === "POST") return handleEpub(request);
      if (url.pathname === "/api/chat" && request.method === "POST") return handleChat(request, env);
      if (url.pathname === "/api/models" && request.method === "GET") return handleModels(request, env);
      if (url.pathname === "/api/log" && request.method === "POST") return handleLog(request);
      if (url.pathname === "/api/conversations" && (request.method === "GET" || request.method === "PUT")) return handleConversations(request, env);
      return json({ error: "API \u8DEF\u5F84\u4E0D\u5B58\u5728\u3002" }, 404);
    }
    return env.ASSETS.fetch(request);
  }
};
export {
  index_default as default
};
