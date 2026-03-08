import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import os from 'node:os';
import { messageSerializer } from './verdent-message.js';

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function nowIso() {
  return new Date().toISOString();
}

function createSessionId() {
  return crypto.randomUUID();
}

function maskToken(value) {
  if (!value) return null;
  if (value.length <= 8) return '[REDACTED]';
  return `${value.slice(0, 4)}...[REDACTED]...${value.slice(-4)}`;
}

function clamp(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function appendStreamingValue(current, chunk) {
  if (chunk == null) return current;
  const next = String(chunk);
  if (!current) return next;
  if (current === next) return current;
  if (next.startsWith(current) || next.includes(current)) return next;
  if (current.startsWith(next) || current.includes(next)) return current;
  return current + next;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function buildChildRuns(summary, { limit = 100 } = {}) {
  const maxCount = clamp(limit, 1, 500, 100);
  const toolUses = summary.toolUses || [];
  const textMessages = summary.textMessages || [];
  const toolMap = new Map(toolUses.map(item => [item.id, item]));
  const childMap = new Map();

  for (const tool of toolUses) {
    if (!tool.parentToolUseId) continue;
    const siblings = childMap.get(tool.parentToolUseId) || [];
    siblings.push(tool.id);
    childMap.set(tool.parentToolUseId, siblings);
  }

  const collectDescendants = rootId => {
    const seen = new Set();
    const queue = [...(childMap.get(rootId) || [])];
    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId || seen.has(currentId)) continue;
      seen.add(currentId);
      for (const nextId of childMap.get(currentId) || []) {
        if (!seen.has(nextId)) queue.push(nextId);
      }
    }
    return seen;
  };

  const runs = toolUses
    .filter(tool => tool.name === 'spawn_subagent')
    .map(tool => {
      const descendantIds = collectDescendants(tool.id);
      const descendants = Array.from(descendantIds)
        .map(id => toolMap.get(id))
        .filter(Boolean)
        .sort((left, right) => String(left.startedAt).localeCompare(String(right.startedAt)));
      const relatedTexts = textMessages
        .filter(message => message.parentToolUseId && descendantIds.has(message.parentToolUseId))
        .sort((left, right) => String(left.startedAt).localeCompare(String(right.startedAt)));
      return {
        id: tool.id,
        name: tool.name,
        displayName: tool.displayName,
        startedAt: tool.startedAt,
        finishedAt: tool.finishedAt,
        isError: tool.isError,
        toolBody: tool.toolBody,
        result: tool.result,
        childToolCount: descendants.length,
        childTextCount: relatedTexts.length,
        childTools: descendants,
        childTexts: relatedTexts,
      };
    })
    .sort((left, right) => String(left.startedAt).localeCompare(String(right.startedAt)));

  return runs.slice(-maxCount);
}

function summarizeEvents(entries) {
  const textMap = new Map();
  const toolMap = new Map();
  const nextActions = [];
  const timeline = [];

  for (const entry of entries) {
    const event = entry.event || {};
    const body = event.body || {};
    const timestamp = event.timestamp || entry.receivedAt;

    if (event.type === 'stream_text' || event.type === 'complete_text') {
      const textId = body.id || `text-${timeline.length}`;
      const existing = textMap.get(textId) || {
        id: textId,
        parentToolUseId: body.parent_tool_use_id || null,
        startedAt: timestamp,
        completedAt: null,
        text: '',
        complete: false,
        usage: null,
        durationMs: null,
        numTurns: null,
        nextPrompts: null,
      };

      existing.text = event.type === 'complete_text'
        ? String(body.text || '')
        : appendStreamingValue(existing.text, body.text || '');
      existing.complete = event.type === 'complete_text' ? true : existing.complete;
      existing.completedAt = event.type === 'complete_text' ? timestamp : existing.completedAt;
      existing.usage = body.usage ?? existing.usage;
      existing.durationMs = body.duration_ms ?? existing.durationMs;
      existing.numTurns = body.num_turns ?? existing.numTurns;
      existing.nextPrompts = body.next_prompts ?? existing.nextPrompts;
      textMap.set(textId, existing);
      continue;
    }

    if (event.type === 'tool_use' || event.type === 'tool_result') {
      const toolId = body.id || `tool-${timeline.length}`;
      const existing = toolMap.get(toolId) || {
        id: toolId,
        name: body.name || null,
        displayName: body.display_name || null,
        parentToolUseId: body.parent_tool_use_id || null,
        started: false,
        finished: false,
        startedAt: timestamp,
        finishedAt: null,
        isError: null,
        toolBody: {},
        result: null,
        eventTypes: [],
      };

      existing.name = body.name || existing.name;
      existing.displayName = body.display_name || existing.displayName;
      existing.parentToolUseId = body.parent_tool_use_id ?? existing.parentToolUseId;
      existing.eventTypes.push(event.type);

      if (event.type === 'tool_use') {
        existing.started = Boolean(body.started) || existing.started;
        existing.finished = Boolean(body.finished);
        if (body.finished) existing.finishedAt = timestamp;

        const toolBody = body.tool_body || {};
        for (const [key, value] of Object.entries(toolBody)) {
          if (typeof value === 'string') {
            existing.toolBody[key] = appendStreamingValue(existing.toolBody[key], value);
          } else if (value != null) {
            existing.toolBody[key] = clone(value);
          }
        }
      } else {
        existing.isError = Boolean(body.is_error);
        existing.result = clone(body.tool_body || {});
        existing.resultAt = timestamp;
      }

      toolMap.set(toolId, existing);
      continue;
    }

    if (event.type === 'next_action') {
      nextActions.push({
        type: body.action_type || null,
        data: clone(body.data || null),
        timestamp,
      });
      continue;
    }

    if (event.type === 'agent_created' || event.type === 'agent_end' || event.type === 'agent_error' || event.type === 'agent_pending') {
      timeline.push({
        type: event.type,
        timestamp,
        body: clone(body),
      });
    }
  }

  const textMessages = Array.from(textMap.values()).sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  const toolUses = Array.from(toolMap.values()).sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));

  return {
    textMessages,
    toolUses,
    nextActions,
    timeline,
    lastText: textMessages.at(-1)?.text || null,
  };
}

export class VerdentChatSession {
  constructor(options) {
    this.options = options;
    this.sessionId = options.sessionId || createSessionId();
    this.events = [];
    this.emitter = new EventEmitter();
    this.ws = null;
    this.connected = false;
    this.handshakeDone = false;
    this.closed = false;
    this.error = null;
    this.pendingCreate = null;
  }

  get state() {
    return {
      sessionId: this.sessionId,
      connected: this.connected,
      handshakeDone: this.handshakeDone,
      closed: this.closed,
      error: this.error,
      apiTokenMasked: maskToken(this.options.apiToken),
      accessTokenMasked: maskToken(this.options.accessToken),
      eventCount: this.events.length,
    };
  }

  get eventCount() {
    return this.events.length;
  }

  buildMessage(type, body) {
    return {
      type,
      group_id: this.sessionId,
      timestamp: nowIso(),
      token: this.options.accessToken || '',
      body,
    };
  }

  addEvent(event) {
    const entry = {
      id: crypto.randomUUID(),
      receivedAt: nowIso(),
      event,
    };
    this.events.push(entry);
    if (this.events.length > 500) {
      this.events.splice(0, this.events.length - 500);
    }
    this.emitter.emit('event', entry);
  }

  async connect() {
    if (this.closed) throw new Error('session_closed');
    if (this.connected && this.handshakeDone) return this.state;
    if (!this.options.apiToken) throw new Error('api_token_required');

    this.pendingCreate = createDeferred();
    this.ws = new WebSocket(`ws://127.0.0.1:${this.options.port}/chat_stream`, {
      headers: {
        cookie: `api_token=${this.options.apiToken}`,
      },
    });

    this.ws.addEventListener('open', () => {
      this.connected = true;
      this.sendRaw(this.buildMessage('create_req', {
        system_info: {
          version: this.options.version || '1.14.4',
          cwd: this.options.cwd || process.cwd(),
          device_id: this.options.deviceId || 'verdent2api',
          device_model: os.cpus()[0]?.model || 'Unknown',
          os: `${os.type()} ${os.release()}`,
          cpu_arch: process.arch,
          project_hash: this.options.projectHash || null,
          is_client_index_ready: false,
          next_prompt_enabled: true,
          next_code_review_enabled: true,
          debug_subagent_enable: false,
        },
      }));
    });

    this.ws.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
      let message;
      try {
        message = JSON.parse(raw);
      } catch (error) {
        this.addEvent({ type: 'parse_error', raw, error: String(error) });
        return;
      }

      this.addEvent(message);

      if (message.type === 'create_res') {
        this.handshakeDone = true;
        this.pendingCreate?.resolve(message);
      } else if (message.type === 'ping') {
        this.sendRaw(this.buildMessage('pong', { nonce: message.body?.nonce }));
      } else if (message.type === 'agent_error') {
        this.error = message.body?.error_msg || 'agent_error';
      } else if (message.type === 'agent_end' || message.type === 'agent_pending') {
        this.closed = true;
      }
    });

    this.ws.addEventListener('error', (event) => {
      this.error = event?.message || 'websocket_error';
      this.pendingCreate?.reject(new Error(this.error));
    });

    this.ws.addEventListener('close', () => {
      this.connected = false;
      this.closed = true;
    });

    await this.pendingCreate.promise;
    return this.state;
  }

  sendRaw(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('websocket_not_open');
    }
    this.ws.send(JSON.stringify(message));
  }

  async sendPrompt({ text, content, planRules, resumeSessionId, resourceBucketId, debugMode }) {
    if (!this.handshakeDone) {
      await this.connect();
    }

    const prompt = content
      ? { ...content, rawText: content.rawText || text || '' }
      : messageSerializer.simplePrompt(text || '');

    const message = this.buildMessage('prompt', {
      prompt: planRules?.length ? { ...prompt, planRules } : prompt,
      bucket_id: resourceBucketId,
      debug_mode: debugMode,
    });

    if (resumeSessionId) {
      message.resume_session_id = resumeSessionId;
    }

    this.sendRaw(message);
    return { ok: true, sessionId: this.sessionId };
  }

  async sendControl(controlBody, { resumeSessionId, resourceBucketId, debugMode } = {}) {
    if (!this.handshakeDone) {
      await this.connect();
    }

    const message = this.buildMessage('control', {
      ...controlBody,
      bucket_id: resourceBucketId,
      debug_mode: debugMode,
    });

    if (resumeSessionId) {
      message.resume_session_id = resumeSessionId;
    }

    this.sendRaw(message);
    return { ok: true, sessionId: this.sessionId };
  }

  listEvents(limit = 100, sinceIndex = 0) {
    const startIndex = clamp(sinceIndex, 0, this.events.length, 0);
    const maxCount = clamp(limit, 1, 500, 100);
    return this.events.slice(startIndex).slice(-maxCount);
  }

  summarize({ sinceIndex = 0 } = {}) {
    const startIndex = clamp(sinceIndex, 0, this.events.length, 0);
    const entries = this.events.slice(startIndex);
    return {
      sinceIndex: startIndex,
      totalEvents: entries.length,
      ...summarizeEvents(entries),
    };
  }

  listToolUses({ sinceIndex = 0, limit = 500 } = {}) {
    const maxCount = clamp(limit, 1, 500, 500);
    return this.summarize({ sinceIndex }).toolUses.slice(-maxCount);
  }

  listMergedMessages({ sinceIndex = 0, limit = 500 } = {}) {
    const maxCount = clamp(limit, 1, 500, 500);
    const summary = this.summarize({ sinceIndex });
    return summary.textMessages.slice(-maxCount);
  }

  listChildRuns({ sinceIndex = 0, limit = 100 } = {}) {
    const summary = this.summarize({ sinceIndex });
    return buildChildRuns(summary, { limit });
  }

  async waitForIdle({ timeoutMs = 30000, idleMs = 1500, sinceIndex = 0, pollMs = 200 } = {}) {
    const startedAt = Date.now();
    const startIndex = clamp(sinceIndex, 0, this.events.length, 0);
    let lastCount = this.events.length;
    let lastGrowthAt = Date.now();
    let lastEventType = null;

    const isSettled = () => {
      const recent = this.events.slice(startIndex);
      let lastCompleteTextIndex = -1;
      let lastToolActivityIndex = -1;
      let lastNextActionIndex = -1;

      for (let index = 0; index < recent.length; index += 1) {
        const type = recent[index]?.event?.type;
        if (['agent_end', 'agent_pending', 'agent_error'].includes(type)) {
          return true;
        }
        if (type === 'complete_text') lastCompleteTextIndex = index;
        if (type === 'next_action') lastNextActionIndex = index;
        if (type === 'tool_use' || type === 'tool_result') lastToolActivityIndex = index;
      }

      if (lastNextActionIndex > lastToolActivityIndex) return true;
      if (lastCompleteTextIndex > lastToolActivityIndex) return true;
      return this.closed && recent.length > 0;
    };

    while (Date.now() - startedAt < timeoutMs) {
      const currentCount = this.events.length;
      if (currentCount !== lastCount) {
        lastCount = currentCount;
        lastGrowthAt = Date.now();
        lastEventType = this.events.at(-1)?.event?.type || null;
      }

      const idleFor = Date.now() - lastGrowthAt;
      if (isSettled() && idleFor >= idleMs) {
        return {
          timedOut: false,
          durationMs: Date.now() - startedAt,
          idleMs,
          startIndex,
          endIndex: this.events.length,
          eventCount: this.events.length - startIndex,
          lastEventType,
        };
      }

      await new Promise(resolve => setTimeout(resolve, pollMs));
    }

    return {
      timedOut: true,
      durationMs: Date.now() - startedAt,
      idleMs,
      startIndex,
      endIndex: this.events.length,
      eventCount: this.events.length - startIndex,
      lastEventType: this.events.at(-1)?.event?.type || null,
    };
  }

  close() {
    this.closed = true;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000);
    }
  }
}

export class VerdentChatManager {
  constructor() {
    this.sessions = new Map();
  }

  createSession(options) {
    const session = new VerdentChatSession(options);
    this.sessions.set(session.sessionId, session);
    return session;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  removeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.close();
      this.sessions.delete(sessionId);
    }
    return Boolean(session);
  }

  listSessions() {
    return Array.from(this.sessions.values()).map((session) => session.state);
  }
}

export const verdentChatManager = new VerdentChatManager();
