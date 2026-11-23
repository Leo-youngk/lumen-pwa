from pathlib import Path

worker = Path('base/worker.mjs').read_text()

def replace(old, new, count=1):
    global worker
    assert worker.count(old) == count, old
    worker = worker.replace(old, new)

worker = """import { handleEpub } from './epub.mjs';
import { goBaseUrl, isOpenCodeGo, providerRoute, providerReasoningParams, providerChatUrl, providerModelsUrl, providerSessionHeaders, parseProviderUsage, usageEvent } from './provider.mjs';

""" + worker
replace('var DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1";', 'var DEFAULT_BASE_URL = goBaseUrl;')
replace('  if (!client) return { baseUrl: fallback, source: "server", error: null };',
'''  if (!client) return { baseUrl: fallback, source: "server", error: null };
  if (!request.headers.get("X-Api-Key")?.trim() && client.replace(/\\/+$/, "") !== fallback) {
    return { baseUrl: fallback, source: "server", error: "自定义接口需要填写该服务的 API Key。" };
  }''')
replace('  const usesAnthropicEndpoint = lowerModel.startsWith("minimax-") || lowerModel.startsWith("qwen");\n  const endpointPath = usesAnthropicEndpoint ? "/messages" : "/chat/completions";',
'''  const endpointPath = providerRoute(baseUrl, lowerModel, payload.provider_protocol);
  const usesAnthropicEndpoint = endpointPath === "/messages";
  const usesResponses = endpointPath === "/responses";''')
replace('  }) : JSON.stringify({\n    model,\n    messages: openAiMessages,\n    stream: true,',
'''  }) : usesResponses ? JSON.stringify({
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
    stream_options: { include_usage: true },''')
replace('    upstream = await fetch(`${baseUrl}${endpointPath}`, {',
'''    const sessionHeaders = providerSessionHeaders(baseUrl, payload.session_id);
    const fetchUpstream = body => fetch(providerChatUrl(baseUrl, endpointPath), {''')
replace('        Accept: "text/event-stream"', '        Accept: "text/event-stream",\n        ...sessionHeaders')
replace('      body: upstreamBody,\n      signal: upstreamController.signal\n    });',
'''      body,
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
    }''')
replace('    let eventCount = 0;', '    let eventCount = 0;\n    let usage = null;')
replace('          const text = deltaText(parsed);',
'''          usage = parseProviderUsage(parsed, usage);
          if (parsed.type === "response.failed" || parsed.type === "response.incomplete") {
            throw new Error(parsed.response?.error?.message || "模型没有完成整条回答。");
          }
          const text = parsed.type === "response.output_text.delta" ? parsed.delta : deltaText(parsed);''')
replace('          const reasoning = deltaReasoning(parsed);',
'''          const reasoning = parsed.type === "response.reasoning_summary_text.delta" ? parsed.delta : deltaReasoning(parsed);''')
replace('    const recentSamples = [];','')
replace('          recentSamples.push(data.slice(0, 300));\n          if (recentSamples.length > 3) recentSamples.shift();','')
replace('eventCount, recentSamples','eventCount')
replace(', dataPreview: data.slice(0, 300)','')
replace('      if (failure) await writer.write(sse({ type: "error", error: failure }));',
'''      const reported = usageEvent(usage);
      if (reported) await writer.write(sse(reported));
      if (failure) await writer.write(sse({ type: "error", error: failure }));''')
replace('fetch(`${baseUrl}/models`,', 'fetch(providerModelsUrl(baseUrl),')
replace('      if (url.pathname === "/api/chat" && request.method === "POST") return handleChat(request, env);',
'''      if (url.pathname === "/api/epub" && request.method === "POST") return handleEpub(request);
      if (url.pathname === "/api/chat" && request.method === "POST") return handleChat(request, env);''')
Path('worker/index.mjs').write_text(worker)
