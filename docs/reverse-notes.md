# Verdent 本地集成技术说明

## 环境与已确认事实

- 安装包：`/Applications/Verdent.app`
- 平台形态：`Electron 39.2.7`
- 产品版本：`1.14.4`
- 描述：`Verdent - Multi-Session AI Agent Manager`
- 主程序入口：`app.asar` → `package.json` → `dist/index.js`
- 伴生进程：`/Applications/Verdent.app/Contents/Resources/bin/verdent_deck/verdent_agent`
- 主数据库：`~/Library/Application Support/Verdent/app-v2.db`
- 次数据库：`~/.verdent/projects/agent_sessions.db`

## 本地数据面

`app-v2.db` 已确认表：

- `projects`
- `sessions`
- `conversation_messages`
- `checkpoints`
- `workspaces`
- `tags`
- `plan_checkpoints`

这意味着 Verdent 的项目、会话、消息、checkpoint 均可直接从本地 SQLite 重建。

另有 `~/.verdent/projects/agent_sessions.db`，当前已确认表：

- `sessions`
- `events`
- `app_states`
- `user_states`

其中 `events.actions` 已确认是 `pickle protocol 5`；当前默认仍以 hex 保真导出，但接口已支持通过安全假类解包，提取其中的 `state_delta`、`artifact_delta` 等字段。

## 本地控制接口

### `127.0.0.1:59647`

- `server: uvicorn`
- `GET /openapi.json` 可匿名访问
- `GET /docs` / `GET /redoc` 可访问
- 根路径 `GET /` 需要 `Cookie: api_token=...`
- 当前 `OpenAPI` 暴露：
  - `GET /`
  - `POST /update/mcp`
  - `POST /update/subagent`
- 已抓到真实业务请求：`GET /chat_stream` 使用 `WebSocket Upgrade`，并在 Cookie 中携带 `api_token`
- `chat_stream` 已实测出现 `create_res`、`agent_created`、`stream_text`、`complete_text`、`tool_use`、`tool_result`、`next_action`、`agent_end`
- 已补 `GET /agent/chat/sessions/:id/stream`：通过 `SSE` 推送 `ready` / `heartbeat` / `chat_event`，可替代轮询 events
- `SSE` 已支持 `view=merged`：`ready/merged_history/merged_update` 中直接附带 `textMessages`、`toolUses`、`childRuns` 聚合态
- 结构化 `mention{subtype:"subagent",name:"Review"}` 会触发 `spawn_subagent`，其结果落在 `tool_result.tool_body.content`
- `spawn_subagent` 当前可通过 `GET /agent/chat/sessions/:id/tool-uses` 直接观测；子链若继续分裂，后续事件会带 `parent_tool_use_id`
- 已补 `GET /agent/chat/sessions/:id/child-runs`：按 `spawn_subagent` 为根聚合子代理运行结果，便于直接查看 child run 入口与后裔工具链
- 已验证：
  - `POST /update/mcp` + `{"data":{}}` -> `{"err_code":0,"msg":"ok","data":{}}`
  - `POST /update/subagent` + `{"data":{}}` -> 返回 subagent 状态摘要
- `Verdent2api` 当前可通过 `POST /agent/capture-token` 在运行时短时抓包并缓存 token，仅返回 masked 状态
- 静态解包 `node_modules/@verdent/shared/dist/cjs/Services/Agent/AgentDaemon.js` 已确认 token 生成算法：`md5("verdent_${nonce}_app")`
- sidecar 启动就绪信号来自 stdout JSON：`{"status":"ready","port":...,"nonce":"..."}`，父进程据此保存 `port/nonce` 并构造 Cookie
- 直接执行 `/Applications/Verdent.app/Contents/Resources/bin/verdent_deck/verdent_agent --help` 竟不会退出帮助，而是实际启动一个独立 sidecar，并同样打印 `status/port/nonce`
- 已用独立实例实战验证：对打印出的 `nonce` 计算 `md5("verdent_${nonce}_app")` 后，携带 `Cookie: api_token=<md5>` 可成功调用 `/update/subagent`

鉴权提示原文：`缺少认证 token，请在 Cookie 中添加 api_token`

### `127.0.0.1:60142`

- 根路径返回 `401 Invalid Authentication Credentials`
- 常见 `OpenAPI/Swagger` 路径均为 `404`
- `lsof` 已确认监听进程是 Verdent 主进程本体，而非 `verdent_agent`
- 这组响应模式与 `node_modules/electron-updater/out/MacUpdater.js` 完全贴合：根路径需要 `Authorization: Basic autoupdater:<random-pass>`，其他非更新 ZIP 路径统一 `404`
- `Invalid Authentication Credentials` 这句文案在 `app.asar` 内落点也确实是 `node_modules/electron-updater/out/MacUpdater.js`
- 结论：`60142` 高概率不是 Verdent 业务控制面，而是 Electron 自动更新阶段启用的本地更新代理

## 登录链

从 `dist/services/User/AuthService.js` 可确认：

- Verdent 使用 `PKCE` 登录
- 登录回调：`http://127.0.0.1:<random>/auth`
- 登录站点：`configService.getBaseUrl('www')/auth?...&ots=deck`
- code 换 token：`configService.getBaseUrl('login')/passport/pkce/callback`
- 成功后把远端 JWT 写入 secret vault，并设置 Cookie：
  - `token=<JWT>; Domain=verdent.ai; Secure; HttpOnly`

注意：这里的远端登录态 cookie 名为 `token`，与 sidecar 本地接口要求的 `api_token` 并不是同一物。

## 当前结论

- 本地数据面已足够支撑一个只读型 `Verdent2api`。
- sidecar `59647` 已可通过 `OpenAPI` 适配，且现在已有运行时 token 捕获链与 nonce 推导链。
- `60142` 的业务性质已基本排除；若后续继续深挖，重点应转为更新态触发条件与 Basic Auth 凭据来源，而非把它当作主业务 API。

## 后续研究方向

1. 优先从 sidecar ready 日志或父进程对象里抓 `nonce`，进一步固化 `POST /agent/derive-token` 的获取链路
2. 识别 Verdent UI 中稳定命中 `/chat_stream` 的关键用户动作
3. 若继续研究 `60142`，优先关注 `AutoUpdateService` 触发更新下载时的 `MacUpdater` 凭据与随机 ZIP 路径
