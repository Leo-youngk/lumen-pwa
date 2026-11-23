import { handleEpub } from './epub.mjs';
import { goBaseUrl, isOpenCodeGo, providerRoute, providerChatUrl, providerModelsUrl, providerSessionHeaders, parseProviderUsage, usageEvent } from './provider.mjs';

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
var IDLE_TIMEOUT_MS = 6e4;
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
function upstreamErrorMessage(event) {
  if (!event.error) return "";
  return typeof event.error === "string" ? event.error : event.error.message || "OpenCode Go \u8FD4\u56DE\u9519\u8BEF\u3002";
}
__name(upstreamErrorMessage, "upstreamErrorMessage");
function withDeadline(work, ms, onTimeout) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(onTimeout), ms);
    const settle = /* @__PURE__ */ __name((value) => {
      clearTimeout(timer);
      resolve(value);
    }, "settle");
    work.then(settle, () => settle(onTimeout));
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
  const messages = normalizeMessages(payload.messages);
  if (!messages) return json({ error: "\u81F3\u5C11\u9700\u8981\u4E00\u6761\u6709\u6548\u7684 user \u6216 assistant \u6D88\u606F\u3002" }, 400);
  const system = typeof payload.system === "string" && payload.system.trim() ? payload.system.slice(0, MAX_SYSTEM_LENGTH) : "";
  const { baseUrl, source: baseUrlSource, error: baseUrlError } = upstreamBaseUrl(request, env);
  if (baseUrlError) {
    diag("chat.bad-base-url", { error: baseUrlError });
    return json({ error: baseUrlError }, 400);
  }
  const model = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : env.OPENCODE_GO_MODEL || "deepseek-v4-pro";
  const lowerModel = model.toLowerCase();
  const endpointPath = providerRoute(baseUrl, lowerModel);
  const usesAnthropicEndpoint = endpointPath === "/messages";
  const usesResponses = endpointPath === "/responses";
  const modelSupportsReasoning = supportsReasoning(model);
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
    max_tokens: typeof payload.max_tokens === "number" ? payload.max_tokens : 65536,
    // Anthropic 兼容端点只接受 0~1 的温度；开启思考时通常要求不传温度，这里只做钳制。
    ...typeof payload.temperature === "number" ? { temperature: Math.min(1, Math.max(0, payload.temperature)) } : {},
    stream: true
  }) : usesResponses ? JSON.stringify({
    model,
    input: openAiMessages.filter(message => message.role !== "system").map(({ role, content }) => ({ role, content })),
    ...(system ? { instructions: system } : {}),
    max_output_tokens: typeof payload.max_tokens === "number" ? Math.max(16, payload.max_tokens) : 8192,
    stream: true
  }) : JSON.stringify({
    model,
    messages: openAiMessages,
    stream: true,
    stream_options: { include_usage: true },
    // reasoning 仅对支持的模型透传：true 开启思考，false 显式关闭。
    ...modelSupportsReasoning && typeof payload.reasoning === "boolean" ? { reasoning: payload.reasoning } : {},
    ...typeof payload.temperature === "number" ? { temperature: payload.temperature } : {},
    ...typeof payload.max_tokens === "number" ? { max_tokens: payload.max_tokens } : {}
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
    reasoning: payload.reasoning
  });
  const upstreamController = new AbortController();
  let upstream;
  try {
    const sessionHeaders = providerSessionHeaders(baseUrl, payload.session_id);
    const fetchUpstream = body => fetch(providerChatUrl(baseUrl, endpointPath), {
      redirect: "error",
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...sessionHeaders
      },
      body,
      signal: upstreamController.signal
    });
    upstream = await fetchUpstream(upstreamBody);
    if (endpointPath === "/chat/completions" && [400, 422].includes(upstream.status)) {
      const detail = await upstream.clone().text();
      if (/stream_options|include_usage/i.test(detail)) {
        void upstream.body?.cancel().catch(() => {});
        const retryBody = JSON.parse(upstreamBody);
        delete retryBody.stream_options;
        upstream = await fetchUpstream(JSON.stringify(retryBody));
      }
    }
  } catch (error) {
    diag("chat.connect-failed", { model, keySource, keyId, error: error instanceof Error ? error.message : String(error), ms: Date.now() - startedAt });
    return json({ error: "\u65E0\u6CD5\u8FDE\u63A5 OpenCode Go\u3002" }, 502);
  }
  if (!upstream.ok || !upstream.body) {
    const body = await upstream.text().catch(() => "");
    let message = "";
    try {
      const parsed = JSON.parse(body);
      const raw = parsed.error;
      const nested = typeof raw === "string" ? raw : raw && typeof raw === "object" ? raw.message : void 0;
      if (typeof nested === "string" && nested) message = nested;
    } catch {
    }
    if (upstream.status === 401) message = "模型服务拒绝了 API Key。请检查密钥是否有效，或在设置里重新连接。";
    diag("chat.upstream-error", {
      model,
      endpoint: endpointPath,
      keySource,
      keyId,
      upstreamStatus: upstream.status,
      ms: Date.now() - startedAt
    });
    return json({ error: message.slice(0, 500) || `模型服务返回 HTTP ${upstream.status}。` }, 502);
  }
  const encoder = new TextEncoder();
  const sse = /* @__PURE__ */ __name((data) => encoder.encode(`data: ${JSON.stringify(data)}

`), "sse");
  const { readable, writable } = new TransformStream();
  void (async () => {
    const writer = writable.getWriter();
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let receivedText = 0;
    let buffer = "";
    let failure = "";
    let completed = false;
    let truncated = false;
    let eventCount = 0;
    let usage = null;

    try {
      while (true) {
        const chunk = await withDeadline(
          reader.read(),
          received ? IDLE_TIMEOUT_MS : FIRST_BYTE_TIMEOUT_MS,
          "timeout"
        );
        if (chunk === "timeout") {
          failure = received ? "\u6A21\u578B\u670D\u52A1\u4E2D\u9014\u505C\u6B62\u54CD\u5E94\u3002" : "\u6A21\u578B\u670D\u52A1\u8D85\u65F6\u672A\u8FD4\u56DE\u5185\u5BB9\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002";
          console.error("[chat] timeout", { model, endpoint: endpointPath, received, eventCount });
          break;
        }
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data) continue;
          if (data === "[DONE]") {
            if (!usesAnthropicEndpoint && !usesResponses) completed = true;
            continue;
          }
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (parseError) {
            console.error("[chat] SSE JSON.parse failed", { model, endpoint: endpointPath, error: parseError instanceof Error ? parseError.message : String(parseError) });
            continue;
          }
          eventCount += 1;

          const errorMessage = upstreamErrorMessage(parsed);
          if (errorMessage) throw new Error(errorMessage);
          if (usesResponses) {
            completed ||= parsed.type === "response.completed";
          } else if (usesAnthropicEndpoint) {
            completed ||= parsed.type === "message_stop";
            truncated ||= parsed.type === "message_delta" && parsed.delta?.stop_reason === "max_tokens";
          } else {
            const reason = parsed.choices?.[0]?.finish_reason;
            completed ||= typeof reason === "string" && reason.length > 0;
            truncated ||= reason === "length";
          }
          usage = parseProviderUsage(parsed, usage);
          if (parsed.type === "response.failed" || parsed.type === "response.incomplete") {
            throw new Error(parsed.response?.error?.message || "模型没有完成整条回答。");
          }
          const text = parsed.type === "response.output_text.delta" ? parsed.delta : deltaText(parsed);
          if (text) {
            received += text.length;
            receivedText += text.length;
            await writer.write(sse({ type: "text", text }));
          }
          const reasoning = parsed.type === "response.reasoning_summary_text.delta" ? parsed.delta : deltaReasoning(parsed);
          if (reasoning) {
            received += reasoning.length;
            await writer.write(sse({ type: "reasoning", text: reasoning }));
          }
        }
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : "\u6D41\u5F0F\u8FDE\u63A5\u4E2D\u65AD";
    } finally {
      void reader.cancel().catch(() => void 0);
      upstreamController.abort();
    }
    if (!failure && truncated) failure = "回答达到模型输出上限，当前内容未完整生成。";
    if (!failure && receivedText && !completed) failure = "上游连接中断，回答未完整返回。请重试。";
    if (!receivedText && !failure) {
      failure = "\u6A21\u578B\u6CA1\u6709\u8FD4\u56DE\u4EFB\u4F55\u5185\u5BB9\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002";
      console.error("[chat] empty reply", { model, endpoint: endpointPath, eventCount });
    }
    diag("chat.done", {
      model,
      endpoint: endpointPath,
      keySource,
      keyId,
      eventCount,
      textChars: receivedText,
      reasoningChars: received - receivedText,
      failure: failure || null,
      ms: Date.now() - startedAt
    });
    try {
      const reported = usageEvent(usage);
      if (reported) await writer.write(sse(reported));
      if (failure) await writer.write(sse({ type: "error", error: failure }));
      await writer.write(sse({ type: "done" }));
      await writer.close();
    } catch {
      void writer.abort().catch(() => void 0);
    }
  })();
  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" }
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
    const response = await fetch(providerModelsUrl(baseUrl), { headers: { Authorization: `Bearer ${apiKey}` }, signal: controller.signal, redirect: "error" });
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
