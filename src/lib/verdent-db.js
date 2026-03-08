import { querySingle, querySqlite } from './sqlite.js';
import { decodePickleActionsHex } from './pickle-actions.js';

function safeLimit(input, fallback = 50, max = 500) {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.trunc(value), max);
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

function parseJsonField(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!['{', '['].includes(trimmed[0])) return value;

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normalizeAgentSessionRow(row) {
  if (!row) return row;
  return {
    ...row,
    state: parseJsonField(row.state),
  };
}

function normalizeAgentEventRow(row) {
  if (!row) return row;
  return {
    ...row,
    content: parseJsonField(row.content),
    groundingMetadata: parseJsonField(row.groundingMetadata),
    customMetadata: parseJsonField(row.customMetadata),
    usageMetadata: parseJsonField(row.usageMetadata),
    citationMetadata: parseJsonField(row.citationMetadata),
    longRunningToolIds: parseJsonField(row.longRunningToolIdsJson),
  };
}

export async function listProjects(dbPath) {
  return querySqlite(
    dbPath,
    `
    select
      id,
      name,
      path,
      type,
      settings,
      last_opened_at as lastOpenedAt,
      created_at as createdAt,
      updated_at as updatedAt
    from projects
    order by id asc;
  `,
  );
}

export async function listSessions(dbPath, { projectId, limit } = {}) {
  const where = projectId ? `where project_id = ${Number(projectId)}` : '';
  return querySqlite(
    dbPath,
    `
    select
      id,
      name,
      status,
      agent_type as agentType,
      project_id as projectId,
      workspace_id as workspaceId,
      created_at as createdAt,
      updated_at as updatedAt,
      run_started_at as runStartedAt,
      pinned,
      unread,
      archived
    from sessions
    ${where}
    order by created_at desc
    limit ${safeLimit(limit)};
  `,
  );
}

export async function getSession(dbPath, sessionId) {
  return querySingle(
    dbPath,
    `
    select
      id,
      name,
      status,
      agent_type as agentType,
      project_id as projectId,
      workspace_id as workspaceId,
      created_at as createdAt,
      updated_at as updatedAt,
      run_started_at as runStartedAt,
      archived,
      unread,
      pinned,
      tag_ids as tagIds
    from sessions
    where id = '${escapeSqlString(sessionId)}';
  `,
  );
}

export async function listMessages(dbPath, sessionId, { limit } = {}) {
  return querySqlite(
    dbPath,
    `
    select
      msg_id as msgId,
      session_id as sessionId,
      source,
      body,
      metadata,
      checkpoint_id as checkpointId,
      timestamp
    from conversation_messages
    where session_id = '${escapeSqlString(sessionId)}'
    order by msg_id desc
    limit ${safeLimit(limit, 100)};
  `,
  );
}

export async function listAgentSessions(dbPath, { appName, userId, limit } = {}) {
  const clauses = [];
  if (appName) clauses.push(`app_name = '${escapeSqlString(appName)}'`);
  if (userId) clauses.push(`user_id = '${escapeSqlString(userId)}'`);
  const where = clauses.length ? `where ${clauses.join(' and ')}` : '';

  const rows = await querySqlite(
    dbPath,
    `
    select
      app_name as appName,
      user_id as userId,
      id,
      state,
      create_time as createTime,
      update_time as updateTime
    from sessions
    ${where}
    order by update_time desc
    limit ${safeLimit(limit, 50)};
  `,
  );

  return rows.map(normalizeAgentSessionRow);
}

export async function getAgentSession(dbPath, sessionId, { appName, userId } = {}) {
  const clauses = [`id = '${escapeSqlString(sessionId)}'`];
  if (appName) clauses.push(`app_name = '${escapeSqlString(appName)}'`);
  if (userId) clauses.push(`user_id = '${escapeSqlString(userId)}'`);

  const row = await querySingle(
    dbPath,
    `
    select
      app_name as appName,
      user_id as userId,
      id,
      state,
      create_time as createTime,
      update_time as updateTime
    from sessions
    where ${clauses.join(' and ')};
  `,
  );

  return normalizeAgentSessionRow(row);
}

export async function listAgentSessionEvents(dbPath, sessionId, { appName, userId, limit, invocationId, decodeActions } = {}) {
  const clauses = [`session_id = '${escapeSqlString(sessionId)}'`];
  if (appName) clauses.push(`app_name = '${escapeSqlString(appName)}'`);
  if (userId) clauses.push(`user_id = '${escapeSqlString(userId)}'`);
  if (invocationId) clauses.push(`invocation_id = '${escapeSqlString(invocationId)}'`);

  const rows = await querySqlite(
    dbPath,
    `
    select
      id,
      app_name as appName,
      user_id as userId,
      session_id as sessionId,
      invocation_id as invocationId,
      author,
      hex(actions) as actionsHex,
      long_running_tool_ids_json as longRunningToolIdsJson,
      branch,
      timestamp,
      content,
      grounding_metadata as groundingMetadata,
      custom_metadata as customMetadata,
      usage_metadata as usageMetadata,
      citation_metadata as citationMetadata,
      partial,
      turn_complete as turnComplete,
      error_code as errorCode,
      error_message as errorMessage,
      interrupted,
      input_transcription as inputTranscription,
      output_transcription as outputTranscription
    from events
    where ${clauses.join(' and ')}
    order by timestamp desc
    limit ${safeLimit(limit, 100)};
  `,
  );

  const normalizedRows = rows.map(normalizeAgentEventRow);

  if (!decodeActions) {
    return normalizedRows;
  }

  return Promise.all(
    normalizedRows.map(async (row) => {
      if (!row.actionsHex) return row;
      try {
        return {
          ...row,
          actionsDecoded: await decodePickleActionsHex(row.actionsHex),
        };
      } catch (error) {
        return {
          ...row,
          actionsDecodeError: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

export async function listAgentApps(dbPath) {
  return querySqlite(
    dbPath,
    `
    select
      app_name as appName,
      count(*) as sessionCount,
      max(update_time) as lastUpdatedAt
    from sessions
    group by app_name
    order by lastUpdatedAt desc;
  `,
  );
}

export async function listAgentAppStates(dbPath) {
  return querySqlite(
    dbPath,
    `
    select
      app_name as appName,
      state,
      update_time as updateTime
    from app_states
    order by update_time desc;
  `,
  ).then((rows) => rows.map((row) => ({ ...row, state: parseJsonField(row.state) })));
}

export async function listAgentUserStates(dbPath, { appName, userId } = {}) {
  const clauses = [];
  if (appName) clauses.push(`app_name = '${escapeSqlString(appName)}'`);
  if (userId) clauses.push(`user_id = '${escapeSqlString(userId)}'`);
  const where = clauses.length ? `where ${clauses.join(' and ')}` : '';

  const rows = await querySqlite(
    dbPath,
    `
    select
      app_name as appName,
      user_id as userId,
      state,
      update_time as updateTime
    from user_states
    ${where}
    order by update_time desc;
  `,
  );

  return rows.map((row) => ({ ...row, state: parseJsonField(row.state) }));
}

export async function summarizeDatabase(dbPath) {
  const [projects, sessions, messages] = await Promise.all([
    querySingle(dbPath, 'select count(*) as count from projects;'),
    querySingle(dbPath, 'select count(*) as count from sessions;'),
    querySingle(dbPath, 'select count(*) as count from conversation_messages;'),
  ]);

  return {
    projects: Number(projects?.count || 0),
    sessions: Number(sessions?.count || 0),
    messages: Number(messages?.count || 0),
  };
}

export async function summarizeAgentDatabase(dbPath) {
  const [sessions, events, appStates, userStates] = await Promise.all([
    querySingle(dbPath, 'select count(*) as count from sessions;'),
    querySingle(dbPath, 'select count(*) as count from events;'),
    querySingle(dbPath, 'select count(*) as count from app_states;'),
    querySingle(dbPath, 'select count(*) as count from user_states;'),
  ]);

  return {
    sessions: Number(sessions?.count || 0),
    events: Number(events?.count || 0),
    appStates: Number(appStates?.count || 0),
    userStates: Number(userStates?.count || 0),
  };
}
