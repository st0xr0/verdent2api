import crypto from 'node:crypto';

const DEFAULT_MODEL = process.env.OPENAI_COMPAT_MODEL || 'verdent-chat';

function normalizeContentPart(part) {
  if (part == null) return '';
  if (typeof part === 'string') return part;
  if (typeof part === 'object') {
    if (part.type === 'text' && typeof part.text === 'string') return part.text;
    if (typeof part.text === 'string') return part.text;
    if (typeof part.input_text === 'string') return part.input_text;
  }
  return '';
}

export function extractMessageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(normalizeContentPart).filter(Boolean).join('\n');
  }
  return normalizeContentPart(content);
}

function renderToolSpec(tool, index) {
  const fn = tool?.function || {};
  const name = fn.name || `tool_${index + 1}`;
  const description = fn.description ? `\nDescription: ${fn.description}` : '';
  const parameters = fn.parameters ? `\nJSON Schema: ${JSON.stringify(fn.parameters)}` : '';
  return `- ${name}${description}${parameters}`;
}

function renderToolInstruction(tools = [], toolChoice = null) {
  if (!Array.isArray(tools) || tools.length === 0) return '';
  const lines = tools.map(renderToolSpec);
  let choiceLine = '';
  if (typeof toolChoice === 'string' && toolChoice) {
    choiceLine = `\nTool choice: ${toolChoice}`;
  } else if (toolChoice && typeof toolChoice === 'object') {
    choiceLine = `\nTool choice: ${JSON.stringify(toolChoice)}`;
  }
  return ['# tools', 'Available tools for this request:', ...lines].join('\n') + choiceLine;
}

export function openAiMessagesToPrompt(messages, { tools = [], toolChoice = null } = {}) {
  return messages
    .map((message, index) => {
      const role = message?.role || 'user';
      const name = message?.name ? ` (${message.name})` : '';
      const text = extractMessageText(message?.content);
      if (!text) return null;
      return `# ${index + 1} ${role}${name}\n${text}`;
    })
    .filter(Boolean)
    .concat(renderToolInstruction(tools, toolChoice) || [])
    .filter(Boolean)
    .join('\n\n');
}

export function buildOpenAiInput(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  return {
    model: payload?.model || DEFAULT_MODEL,
    messages,
    promptText: openAiMessagesToPrompt(messages, { tools: payload?.tools || [], toolChoice: payload?.tool_choice ?? payload?.toolChoice ?? null }),
    stream: Boolean(payload?.stream),
    temperature: payload?.temperature,
    maxTokens: payload?.max_completion_tokens ?? payload?.max_tokens ?? null,
    metadata: payload?.metadata || null,
    tools: Array.isArray(payload?.tools) ? payload.tools : [],
    toolChoice: payload?.tool_choice ?? payload?.toolChoice ?? null,
  };
}

export function listOpenAiModels() {
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      id: DEFAULT_MODEL,
      object: 'model',
      created: now,
      owned_by: 'verdent2api',
      permission: [],
      root: DEFAULT_MODEL,
      parent: null,
    },
  ];
}

export function buildOpenAiUsage(merged) {
  const usage = merged?.textMessages?.at(-1)?.usage || {};
  const promptTokens = Number(usage.input_tokens || usage.prompt_tokens || 0);
  const completionTokens = Number(usage.output_tokens || usage.completion_tokens || 0);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}

export function buildOpenAiToolCalls(toolUses = []) {
  return toolUses
    .filter(tool => tool?.name)
    .map(tool => ({
      id: tool.id || `call_${crypto.randomUUID().replace(/-/g, '')}`,
      type: 'function',
      function: {
        name: tool.name,
        arguments: JSON.stringify(tool.toolBody || {}),
      },
    }));
}

export function getOpenAiFinishReason(merged, wait = null) {
  const toolCalls = buildOpenAiToolCalls(merged?.toolUses || []);
  if (toolCalls.length) return 'tool_calls';
  if (wait?.timedOut) return 'length';
  return 'stop';
}

export function buildOpenAiChatCompletion({ id, model, sessionId, merged, wait = null }) {
  const content = merged?.lastText || merged?.textMessages?.at(-1)?.text || '';
  const toolCalls = buildOpenAiToolCalls(merged?.toolUses || []);
  const message = {
    role: 'assistant',
    content,
  };

  if (toolCalls.length) {
    message.tool_calls = toolCalls;
  }

  const finishReason = getOpenAiFinishReason(merged, wait);

  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || DEFAULT_MODEL,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason,
      },
    ],
    usage: buildOpenAiUsage(merged),
    system_fingerprint: 'verdent2api',
    session_id: sessionId,
  };
}

export function createOpenAiCompletionId() {
  return `chatcmpl-${crypto.randomUUID().replace(/-/g, '')}`;
}

export function createChunk({ id, model, delta = {}, finishReason = null }) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: model || DEFAULT_MODEL,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

export function sendOpenAiError(res, status, message, type = 'invalid_request_error', code = null) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: { message, type, code } }, null, 2));
}


export function createToolCallDelta(tool, index = 0) {
  return {
    tool_calls: [
      {
        index,
        id: tool?.id || `call_${crypto.randomUUID().replace(/-/g, '')}`,
        type: 'function',
        function: {
          name: tool?.name || 'unknown_tool',
          arguments: JSON.stringify(tool?.toolBody || {}),
        },
      },
    ],
  };
}


export function buildOpenAiResponseObject({ id, model, sessionId, merged, wait = null }) {
  const completion = buildOpenAiChatCompletion({ id, model, sessionId, merged, wait });
  const message = completion.choices?.[0]?.message || { role: 'assistant', content: '' };
  const outputText = typeof message.content === 'string' ? message.content : '';
  return {
    id: id.replace(/^chatcmpl-/, 'resp-'),
    object: 'response',
    created_at: completion.created,
    model: completion.model,
    status: 'completed',
    output: [
      {
        id: `msg_${sessionId}`,
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: outputText,
            annotations: [],
          },
        ],
      },
    ],
    output_text: outputText,
    usage: completion.usage,
    incomplete_details: wait?.timedOut ? { reason: 'max_output_tokens' } : null,
    metadata: null,
    tool_calls: message.tool_calls || [],
    session_id: sessionId,
  };
}
