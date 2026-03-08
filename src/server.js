import http from 'node:http';
import { URL } from 'node:url';
import { discoverVerdentRuntime } from './lib/discovery.js';
import { getVerdentPaths } from './lib/paths.js';
import {
  listMessages,
  listProjects,
  listSessions,
  summarizeDatabase,
  getSession,
  listAgentSessions,
  getAgentSession,
  listAgentSessionEvents,
  listAgentApps,
  listAgentAppStates,
  listAgentUserStates,
  summarizeAgentDatabase,
} from './lib/verdent-db.js';
import { VerdentAgentClient } from './lib/verdent-agent.js';
import { verdentChatManager } from './lib/verdent-chat.js';
import { captureAgentApiToken } from './lib/token-capture.js';
import { deriveAgentApiTokenFromNonce } from './lib/token-derive.js';
import { getAgentApiToken, getAgentApiTokenStatus, setAgentApiToken } from './lib/token-store.js';
import { getVerdentAccessTokenInfo, getVerdentAccessTokenStatus } from './lib/verdent-auth.js';

const defaultPort = Number(process.env.PORT || 8787);
const host = '127.0.0.1';
const explicitPort = Object.prototype.hasOwnProperty.call(process.env, 'PORT');
let activePort = defaultPort;

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function matchPath(pathname, regex) {
  const match = pathname.match(regex);
  return match ? match.slice(1) : null;
}

function getRequestApiToken(req) {
  const headerToken = req.headers['x-verdent-api-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }

  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)api_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getEffectiveApiToken(req) {
  return getRequestApiToken(req) || getAgentApiToken();
}

function getRequestAccessToken(req) {
  const headerToken = req.headers['x-verdent-access-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }

  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function parseIntegerParam(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const integer = Math.trunc(numeric);
  if (integer < min) return min;
  if (integer > max) return max;
  return integer;
}

function parseBooleanParam(value, fallback = false) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function writeSse(res, eventName, payload) {
  if (eventName) {
    res.write(`event: ${eventName}\n`);
  }
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  for (const line of body.split('\n')) {
    res.write(`data: ${line}\n`);
  }
  res.write('\n');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || host}`);
    const pathname = url.pathname;
    const paths = getVerdentPaths();
    const agent = new VerdentAgentClient({ apiToken: getAgentApiToken() });
    const apiToken = getEffectiveApiToken(req);

    if (req.method === 'GET' && pathname === '/health') {
      const summary = await summarizeDatabase(paths.dbPath);
      return sendJson(res, 200, {
        ok: true,
        service: 'verdent2api',
        port: activePort,
        database: summary,
        agentToken: getAgentApiTokenStatus(),
      });
    }

    if (req.method === 'GET' && pathname === '/discovery') {
      return sendJson(res, 200, {
        ...(await discoverVerdentRuntime()),
        agentToken: getAgentApiTokenStatus(),
      });
    }

    if (req.method === 'GET' && pathname === '/projects') {
      return sendJson(res, 200, { items: await listProjects(paths.dbPath) });
    }

    if (req.method === 'GET' && pathname === '/sessions') {
      return sendJson(res, 200, {
        items: await listSessions(paths.dbPath, {
          projectId: url.searchParams.get('projectId'),
          limit: url.searchParams.get('limit'),
        }),
      });
    }

    const sessionMatch = matchPath(pathname, /^\/sessions\/([^/]+)$/);
    if (req.method === 'GET' && sessionMatch) {
      const session = await getSession(paths.dbPath, decodeURIComponent(sessionMatch[0]));
      return session
        ? sendJson(res, 200, session)
        : sendJson(res, 404, { error: 'session_not_found' });
    }

    const messageMatch = matchPath(pathname, /^\/sessions\/([^/]+)\/messages$/);
    if (req.method === 'GET' && messageMatch) {
      return sendJson(res, 200, {
        items: await listMessages(paths.dbPath, decodeURIComponent(messageMatch[0]), {
          limit: url.searchParams.get('limit'),
        }),
      });
    }

    if (req.method === 'GET' && pathname === '/agent-db/summary') {
      return sendJson(res, 200, {
        path: paths.agentSessionsDbPath,
        summary: await summarizeAgentDatabase(paths.agentSessionsDbPath),
      });
    }

    if (req.method === 'GET' && pathname === '/agent-db/apps') {
      return sendJson(res, 200, {
        items: await listAgentApps(paths.agentSessionsDbPath),
      });
    }

    if (req.method === 'GET' && pathname === '/agent-db/app-states') {
      return sendJson(res, 200, {
        items: await listAgentAppStates(paths.agentSessionsDbPath),
      });
    }

    if (req.method === 'GET' && pathname === '/agent-db/user-states') {
      return sendJson(res, 200, {
        items: await listAgentUserStates(paths.agentSessionsDbPath, {
          appName: url.searchParams.get('appName'),
          userId: url.searchParams.get('userId'),
        }),
      });
    }

    if (req.method === 'GET' && pathname === '/agent-db/sessions') {
      return sendJson(res, 200, {
        items: await listAgentSessions(paths.agentSessionsDbPath, {
          appName: url.searchParams.get('appName'),
          userId: url.searchParams.get('userId'),
          limit: url.searchParams.get('limit'),
        }),
      });
    }

    const agentSessionMatch = matchPath(pathname, /^\/agent-db\/sessions\/([^/]+)$/);
    if (req.method === 'GET' && agentSessionMatch) {
      const session = await getAgentSession(paths.agentSessionsDbPath, decodeURIComponent(agentSessionMatch[0]), {
        appName: url.searchParams.get('appName'),
        userId: url.searchParams.get('userId'),
      });

      return session
        ? sendJson(res, 200, session)
        : sendJson(res, 404, { error: 'agent_session_not_found' });
    }

    const agentEventMatch = matchPath(pathname, /^\/agent-db\/sessions\/([^/]+)\/events$/);
    if (req.method === 'GET' && agentEventMatch) {
      return sendJson(res, 200, {
        items: await listAgentSessionEvents(paths.agentSessionsDbPath, decodeURIComponent(agentEventMatch[0]), {
          appName: url.searchParams.get('appName'),
          userId: url.searchParams.get('userId'),
          invocationId: url.searchParams.get('invocationId'),
          limit: url.searchParams.get('limit'),
          decodeActions: url.searchParams.get('decodeActions') === '1',
        }),
      });
    }

    if (req.method === 'GET' && pathname === '/agent/chat/sessions') {
      return sendJson(res, 200, { items: verdentChatManager.listSessions() });
    }

    if (req.method === 'POST' && pathname === '/agent/chat/sessions') {
      const payload = await readJsonBody(req);
      const localAccessToken =
        getRequestAccessToken(req) ||
        payload.accessToken ||
        (await getVerdentAccessTokenInfo().catch(() => null))?.accessToken ||
        null;

      const session = verdentChatManager.createSession({
        sessionId: payload.sessionId,
        apiToken: payload.apiToken || apiToken,
        accessToken: localAccessToken,
        port: Number(payload.port || process.env.VERDENT_AGENT_PORT || 59647),
        cwd: payload.cwd,
        projectHash: payload.projectHash,
        resourceBucketId: payload.resourceBucketId,
      });

      const state = await session.connect();
      return sendJson(res, 200, state);
    }

    const chatSessionMatch = matchPath(pathname, /^\/agent\/chat\/sessions\/([^/]+)$/);
    if (chatSessionMatch) {
      const chatSession = verdentChatManager.getSession(decodeURIComponent(chatSessionMatch[0]));
      if (!chatSession) {
        return sendJson(res, 404, { error: 'chat_session_not_found' });
      }

      if (req.method === 'GET') {
        return sendJson(res, 200, chatSession.state);
      }

      if (req.method === 'DELETE') {
        verdentChatManager.removeSession(chatSession.sessionId);
        return sendJson(res, 200, { ok: true });
      }
    }

    const chatEventsMatch = matchPath(pathname, /^\/agent\/chat\/sessions\/([^/]+)\/events$/);
    if (chatEventsMatch && req.method === 'GET') {
      const chatSession = verdentChatManager.getSession(decodeURIComponent(chatEventsMatch[0]));
      if (!chatSession) {
        return sendJson(res, 404, { error: 'chat_session_not_found' });
      }

      return sendJson(res, 200, {
        items: chatSession.listEvents(url.searchParams.get('limit') || 100, url.searchParams.get('after') || url.searchParams.get('sinceIndex') || 0),
      });
    }

    const chatStreamMatch = matchPath(pathname, /^\/agent\/chat\/sessions\/([^/]+)\/stream$/);
    if (chatStreamMatch && req.method === 'GET') {
      const chatSession = verdentChatManager.getSession(decodeURIComponent(chatStreamMatch[0]));
      if (!chatSession) {
        return sendJson(res, 404, { error: 'chat_session_not_found' });
      }

      const sinceIndex = parseIntegerParam(url.searchParams.get('sinceIndex') || url.searchParams.get('after'), 0, {
        min: 0,
        max: chatSession.eventCount,
      });
      const includeHistory = parseBooleanParam(url.searchParams.get('includeHistory'), true);
      const autoClose = parseBooleanParam(url.searchParams.get('autoClose'), false);
      const heartbeatMs = parseIntegerParam(url.searchParams.get('heartbeatMs'), 15000, { min: 1000, max: 60000 });
      const view = (url.searchParams.get('view') || 'raw').toLowerCase() === 'merged' ? 'merged' : 'raw';
      let closed = false;
      let nextIndex = sinceIndex;

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });

      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }

      const buildMergedPayload = () => {
        const merged = chatSession.summarize({ sinceIndex });
        return {
          sessionId: chatSession.sessionId,
          sinceIndex,
          eventCount: chatSession.eventCount,
          state: chatSession.state,
          merged: {
            ...merged,
            childRuns: chatSession.listChildRuns({ sinceIndex, limit: 100 }),
          },
        };
      };

      writeSse(res, 'ready', view === 'merged' ? buildMergedPayload() : {
        sessionId: chatSession.sessionId,
        sinceIndex,
        eventCount: chatSession.eventCount,
        state: chatSession.state,
      });

      const sendEntry = entry => {
        if (view === 'merged') {
          writeSse(res, 'merged_update', buildMergedPayload());
        } else {
          writeSse(res, 'chat_event', { index: nextIndex, entry });
        }
        nextIndex += 1;
      };

      if (includeHistory) {
        if (view === 'merged') {
          writeSse(res, 'merged_history', buildMergedPayload());
        } else {
          const entries = chatSession.listEvents(500, sinceIndex);
          entries.forEach(sendEntry);
        }
      }

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        chatSession.emitter.off('event', onEvent);
        res.end();
      };

      const onEvent = entry => {
        if (closed) return;
        sendEntry(entry);
        const type = entry?.event?.type;
        if (autoClose && ['agent_end', 'agent_pending', 'agent_error'].includes(type)) {
          writeSse(res, 'end', { type, state: chatSession.state });
          cleanup();
        }
      };

      const heartbeat = setInterval(() => {
        if (closed) return;
        writeSse(res, 'heartbeat', { now: new Date().toISOString(), eventCount: chatSession.eventCount, view });
      }, heartbeatMs);

      chatSession.emitter.on('event', onEvent);
      req.on('close', cleanup);
      req.on('aborted', cleanup);
      return;
    }

    const chatMergedMatch = matchPath(pathname, /^\/agent\/chat\/sessions\/([^/]+)\/messages-merged$/);
    if (chatMergedMatch && req.method === 'GET') {
      const chatSession = verdentChatManager.getSession(decodeURIComponent(chatMergedMatch[0]));
      if (!chatSession) {
        return sendJson(res, 404, { error: 'chat_session_not_found' });
      }

      return sendJson(res, 200, {
        items: chatSession.listMergedMessages({
          sinceIndex: url.searchParams.get('sinceIndex') || url.searchParams.get('after') || 0,
          limit: url.searchParams.get('limit') || 500,
        }),
      });
    }

    const chatToolUsesMatch = matchPath(pathname, /^\/agent\/chat\/sessions\/([^/]+)\/tool-uses$/);
    if (chatToolUsesMatch && req.method === 'GET') {
      const chatSession = verdentChatManager.getSession(decodeURIComponent(chatToolUsesMatch[0]));
      if (!chatSession) {
        return sendJson(res, 404, { error: 'chat_session_not_found' });
      }

      return sendJson(res, 200, {
        items: chatSession.listToolUses({
          sinceIndex: url.searchParams.get('sinceIndex') || url.searchParams.get('after') || 0,
          limit: url.searchParams.get('limit') || 500,
        }),
      });
    }

    const chatChildRunsMatch = matchPath(pathname, /^\/agent\/chat\/sessions\/([^/]+)\/child-runs$/);
    if (chatChildRunsMatch && req.method === 'GET') {
      const chatSession = verdentChatManager.getSession(decodeURIComponent(chatChildRunsMatch[0]));
      if (!chatSession) {
        return sendJson(res, 404, { error: 'chat_session_not_found' });
      }

      return sendJson(res, 200, {
        items: chatSession.listChildRuns({
          sinceIndex: url.searchParams.get('sinceIndex') || url.searchParams.get('after') || 0,
          limit: url.searchParams.get('limit') || 100,
        }),
      });
    }

    const chatPromptMatch = matchPath(pathname, /^\/agent\/chat\/sessions\/([^/]+)\/prompt$/);
    if (chatPromptMatch && req.method === 'POST') {
      const chatSession = verdentChatManager.getSession(decodeURIComponent(chatPromptMatch[0]));
      if (!chatSession) {
        return sendJson(res, 404, { error: 'chat_session_not_found' });
      }

      const payload = await readJsonBody(req);
      return sendJson(res, 200, await chatSession.sendPrompt({
        text: payload.text,
        content: payload.content,
        planRules: payload.planRules,
        resumeSessionId: payload.resumeSessionId,
        resourceBucketId: payload.resourceBucketId,
        debugMode: payload.debugMode,
      }));
    }

    const chatPromptAndWaitMatch = matchPath(pathname, /^\/agent\/chat\/sessions\/([^/]+)\/prompt-and-wait$/);
    if (chatPromptAndWaitMatch && req.method === 'POST') {
      const chatSession = verdentChatManager.getSession(decodeURIComponent(chatPromptAndWaitMatch[0]));
      if (!chatSession) {
        return sendJson(res, 404, { error: 'chat_session_not_found' });
      }

      const payload = await readJsonBody(req);
      const sinceIndex = chatSession.eventCount;

      await chatSession.sendPrompt({
        text: payload.text,
        content: payload.content,
        planRules: payload.planRules,
        resumeSessionId: payload.resumeSessionId,
        resourceBucketId: payload.resourceBucketId,
        debugMode: payload.debugMode,
      });

      const wait = await chatSession.waitForIdle({
        sinceIndex,
        timeoutMs: payload.timeoutMs,
        idleMs: payload.idleMs,
      });

      return sendJson(res, 200, {
        ok: true,
        sessionId: chatSession.sessionId,
        wait,
        state: chatSession.state,
        merged: chatSession.summarize({
          sinceIndex,
          limit: payload.limit || 500,
        }),
      });
    }

    const chatControlMatch = matchPath(pathname, /^\/agent\/chat\/sessions\/([^/]+)\/control$/);
    if (chatControlMatch && req.method === 'POST') {
      const chatSession = verdentChatManager.getSession(decodeURIComponent(chatControlMatch[0]));
      if (!chatSession) {
        return sendJson(res, 404, { error: 'chat_session_not_found' });
      }

      const payload = await readJsonBody(req);
      return sendJson(res, 200, await chatSession.sendControl(payload.controlBody || payload, {
        resumeSessionId: payload.resumeSessionId,
        resourceBucketId: payload.resourceBucketId,
        debugMode: payload.debugMode,
      }));
    }

    const chatRawMatch = matchPath(pathname, /^\/agent\/chat\/sessions\/([^/]+)\/raw$/);
    if (chatRawMatch && req.method === 'POST') {
      const chatSession = verdentChatManager.getSession(decodeURIComponent(chatRawMatch[0]));
      if (!chatSession) {
        return sendJson(res, 404, { error: 'chat_session_not_found' });
      }

      const payload = await readJsonBody(req);
      chatSession.sendRaw(payload.message);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/agent/openapi') {
      const response = await agent.getOpenApi();
      return sendJson(res, response.status, response.body);
    }

    if (req.method === 'GET' && pathname === '/agent/token-status') {
      return sendJson(res, 200, getAgentApiTokenStatus());
    }

    if (req.method === 'GET' && pathname === '/agent/access-token-status') {
      return sendJson(res, 200, await getVerdentAccessTokenStatus());
    }

    if (req.method === 'POST' && pathname === '/agent/derive-token') {
      const payload = await readJsonBody(req);
      if (!payload.nonce) {
        return sendJson(res, 400, { error: 'nonce_required' });
      }

      const token = deriveAgentApiTokenFromNonce(payload.nonce);
      const shouldSet = payload.setAsCurrent !== false;
      const tokenStatus = shouldSet
        ? setAgentApiToken(token, 'derived-from-nonce')
        : {
            ...getAgentApiTokenStatus(),
            derivedToken: token.slice(0, 4) + '...[REDACTED]...' + token.slice(-4),
          };

      return sendJson(res, 200, {
        ok: true,
        derived: true,
        nonceProvided: true,
        setAsCurrent: shouldSet,
        token: shouldSet ? tokenStatus : { maskedToken: tokenStatus.derivedToken },
      });
    }

    if (req.method === 'POST' && pathname === '/agent/capture-token') {
      const payload = await readJsonBody(req);
      try {
        const capture = await captureAgentApiToken(payload);
        if (!capture.captured) {
          return sendJson(res, 408, {
            error: 'capture_timeout',
            capture,
            token: getAgentApiTokenStatus(),
          });
        }

        const tokenStatus = setAgentApiToken(capture.token, capture.source);
        return sendJson(res, 200, {
          ok: true,
          capture: {
            captured: true,
            source: capture.source,
            interfaceName: capture.interfaceName,
            port: capture.port,
          },
          token: tokenStatus,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = message === 'tcpdump_permission_denied' ? 403 : 500;
        return sendJson(res, status, {
          error: 'capture_failed',
          message,
        });
      }
    }

    if (req.method === 'GET' && pathname === '/agent/root') {
      const response = await agent.getRoot({ apiToken });
      return sendJson(res, response.status, response.body);
    }

    if (req.method === 'POST' && pathname === '/agent/update/mcp') {
      const payload = await readJsonBody(req);
      const response = await agent.updateMcp(payload, { apiToken });
      return sendJson(res, response.status, response.body);
    }

    if (req.method === 'POST' && pathname === '/agent/update/subagent') {
      const payload = await readJsonBody(req);
      const response = await agent.updateSubagent(payload, { apiToken });
      return sendJson(res, response.status, response.body);
    }

    return sendJson(res, 404, {
      error: 'not_found',
      available: [
        'GET /health',
        'GET /discovery',
        'GET /projects',
        'GET /sessions?projectId=&limit=',
        'GET /sessions/:id',
        'GET /sessions/:id/messages?limit=',
        'GET /agent-db/summary',
        'GET /agent-db/apps',
        'GET /agent-db/app-states',
        'GET /agent-db/user-states?appName=&userId=',
        'GET /agent-db/sessions?appName=&userId=&limit=',
        'GET /agent-db/sessions/:id?appName=&userId=',
        'GET /agent-db/sessions/:id/events?appName=&userId=&invocationId=&limit=&decodeActions=1',
        'GET /agent/chat/sessions',
        'POST /agent/chat/sessions',
        'GET /agent/chat/sessions/:id',
        'DELETE /agent/chat/sessions/:id',
        'GET /agent/chat/sessions/:id/events?limit=',
        'GET /agent/chat/sessions/:id/messages-merged?sinceIndex=&limit=',
        'GET /agent/chat/sessions/:id/tool-uses?sinceIndex=&after=&limit=',
        'GET /agent/chat/sessions/:id/child-runs?sinceIndex=&after=&limit=',
        'POST /agent/chat/sessions/:id/prompt',
        'POST /agent/chat/sessions/:id/prompt-and-wait',
        'POST /agent/chat/sessions/:id/control',
        'POST /agent/chat/sessions/:id/raw',
        'GET /agent/openapi',
        'GET /agent/token-status',
        'GET /agent/access-token-status',
        'POST /agent/derive-token',
        'POST /agent/capture-token',
        'GET /agent/root',
        'POST /agent/update/mcp',
        'POST /agent/update/subagent',
      ],
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'internal_error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

function listen(portToUse) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };

    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(portToUse, host);
  });
}

async function start() {
  const maxAttempts = explicitPort ? 1 : 10;

  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const nextPort = defaultPort + offset;
    try {
      await listen(nextPort);
      activePort = nextPort;
      if (nextPort !== defaultPort) {
        console.warn(`verdent2api default port ${defaultPort} occupied, fallback to http://${host}:${nextPort}`);
      } else {
        console.log(`verdent2api listening on http://${host}:${nextPort}`);
      }
      return;
    } catch (error) {
      if (error?.code !== 'EADDRINUSE' || offset === maxAttempts - 1) {
        if (error?.code === 'EADDRINUSE') {
          console.error(`verdent2api failed to bind http://${host}:${nextPort}: port already in use`);
          console.error('tip: set PORT=<port> or stop the existing Verdent2api process');
        }
        throw error;
      }
    }
  }
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
