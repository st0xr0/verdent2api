# Verdent2api

`Verdent2api` 是一个基于本地逆向结果构建的 API 包装层，用来把 Verdent 桌面端的本地数据面与 sidecar 控制面暴露为可脚本化接口。

## 项目状态

- 当前状态：`0.1.0` / 可用的工程版
- 适用范围：本机已安装且已授权使用的 Verdent 实例
- 已完成能力：数据库读取、token 推导、`chat_stream` 会话桥接、工具调用聚合、subagent 观测、`SSE raw/merged`
- 当前边界：不追求 100% 复刻 Verdent 官方前端状态机

## 快速开始

```bash
cp .env.example .env
npm start
```

然后可先跑一次发现流程：

```bash
npm run discover
```

如果你已经拿到 sidecar `nonce`，可直接推导 token：

```bash
curl -sS -X POST http://127.0.0.1:8787/agent/derive-token \
  -H 'content-type: application/json' \
  -d '{"nonce":"<captured_nonce>","setAsCurrent":true}'
```

当前已确认的逆向事实：

- Verdent `1.14.4` 是 `Electron` 桌面应用，`app.asar` 主入口为 `dist/index.js`。
- 主本地数据库位于 `~/Library/Application Support/Verdent/app-v2.db`。
- sidecar 进程 `verdent_agent` 暴露 `uvicorn` HTTP 服务，默认监听 `127.0.0.1:59647`。
- `59647/openapi.json` 可匿名访问；业务接口要求 `Cookie: api_token=...`。
- `127.0.0.1:60142` 另有一条本地服务，根路径返回 `401 Invalid Authentication Credentials`；静态逆向与响应模式表明它更像 `electron-updater` 的 `MacUpdater` 本地更新代理，而非业务 API。

## 当前能力

- 读取 Verdent 本地项目、会话、消息。
- 读取 `agent_sessions.db` 中的 agent sessions、events、app/user states。
- 输出本机 Verdent 安装与逆向发现摘要。
- 代理 sidecar 的 `openapi`、`update/mcp`、`update/subagent`。
- 运行时捕获并缓存 sidecar `api_token`（通过本机 `tcpdump` 抓取 `/chat_stream` 明文请求头）。

## 接口

- `GET /health`
- `GET /discovery`
- `GET /projects`
- `GET /sessions?projectId=&limit=`
- `GET /sessions/:id`
- `GET /sessions/:id/messages?limit=`
- `GET /agent-db/summary`
- `GET /agent-db/apps`
- `GET /agent-db/app-states`
- `GET /agent-db/user-states?appName=&userId=`
- `GET /agent-db/sessions?appName=&userId=&limit=`
- `GET /agent-db/sessions/:id?appName=&userId=`
- `GET /agent-db/sessions/:id/events?appName=&userId=&invocationId=&limit=&decodeActions=1`
- `GET /agent/chat/sessions`
- `POST /agent/chat/sessions`
- `GET /agent/chat/sessions/:id`
- `DELETE /agent/chat/sessions/:id`
- `GET /agent/chat/sessions/:id/events?limit=&after=&sinceIndex=`
- `GET /agent/chat/sessions/:id/stream?after=&sinceIndex=&includeHistory=&autoClose=&heartbeatMs=&view=raw|merged`
- `GET /agent/chat/sessions/:id/messages-merged?sinceIndex=&after=&limit=`
- `GET /agent/chat/sessions/:id/tool-uses?sinceIndex=&after=&limit=`
- `GET /agent/chat/sessions/:id/child-runs?sinceIndex=&after=&limit=`
- `POST /agent/chat/sessions/:id/prompt`
- `POST /agent/chat/sessions/:id/prompt-and-wait`
- `POST /agent/chat/sessions/:id/control`
- `POST /agent/chat/sessions/:id/raw`
- `GET /agent/openapi`
- `GET /agent/token-status`
- `GET /agent/access-token-status`
- `POST /agent/derive-token`
- `POST /agent/capture-token`
- `GET /agent/root`
- `POST /agent/update/mcp`
- `POST /agent/update/subagent`

## 运行

```bash
npm start
```

默认优先监听：`127.0.0.1:8787`（若被占用且未显式设置 `PORT`，会自动顺延尝试 `8788` 起的端口）

可选环境变量：

- `PORT`：本项目监听端口；若未设置则默认从 `8787` 开始并自动寻找空闲端口
- `VERDENT_APP_PATH`：Verdent 安装路径，默认 `/Applications/Verdent.app`
- `VERDENT_USER_DATA_DIR`：Verdent userData 目录
- `VERDENT_DIR`：Verdent 配置目录，默认 `~/.verdent`
- `VERDENT_AGENT_URL`：sidecar 基址，默认 `http://127.0.0.1:59647`
- `VERDENT_AGENT_API_TOKEN`：sidecar `api_token`，若缺失，受保护端点会返回 `401`
- `VERDENT_CAPTURE_INTERFACE`：抓包网卡，默认 `lo0`
- `TCPDUMP_PATH`：`tcpdump` 可执行文件路径，默认直接走 PATH

也可对单次请求临时覆盖 token：

- Header：`x-verdent-api-token: [REDACTED]`
- 或 Cookie：`api_token=[REDACTED]`

## 由 `nonce` 推导 `api_token`

静态逆向已确认 Verdent 主进程内部的算法为：

- sidecar 启动后会向父进程 stdout 输出 `status=ready` 对应 JSON，其中含 `port` 与 `nonce`
- 主进程使用 `md5("verdent_${nonce}_app")` 计算本地 `api_token`

因此现在可直接调用：

```bash
curl -sS -X POST http://127.0.0.1:8787/agent/derive-token \
  -H 'content-type: application/json' \
  -d '{"nonce":"<captured_nonce>","setAsCurrent":true}'
```

默认会把推导出的 token 直接装入当前 `Verdent2api` 进程缓存，仅返回 masked 状态，不回显明文 token。

额外逆向结论：`verdent_agent` 独立启动时会向 stdout 打印 `{"status":"ready","port":...,"nonce":"..."}`，因此一旦拿到 `nonce`，即可完全绕过抓包，直接走推导链。

## 自动捕获 `api_token`

`POST /agent/capture-token` 会在当前主机上启动一次短时 `tcpdump`，监听 `59647` 的回环明文 HTTP 流量；当 Verdent 发出 `GET /chat_stream` 的 WebSocket Upgrade 时，会从 Cookie 中提取 `api_token` 并仅缓存在当前 `Verdent2api` 进程内，不会在响应里回显明文。

示例：

```bash
curl -sS -X POST http://127.0.0.1:8787/agent/capture-token \
  -H 'content-type: application/json' \
  -d '{"timeoutMs":15000}'
```

然后在 15 秒内去 Verdent UI 里触发一次会走聊天流的动作。成功后可检查：

```bash
curl -sS http://127.0.0.1:8787/agent/token-status
```

注意：

- 该能力依赖本机 `tcpdump` 与抓包权限；若权限不足，会返回 `403 capture_failed`。
- `POST /agent/derive-token` 同样只返回 masked token 状态，不返回明文 token。
- 接口只返回 masked token 状态，不返回明文 token。
- 单请求 `x-verdent-api-token` / `Cookie api_token` 仍然优先于缓存 token。

## 快速探测

```bash
npm run discover
```

该命令会输出：

- Verdent 安装与版本信息
- 本地数据库统计
- 本地项目与会话样本
- sidecar `OpenAPI`

## `agent_sessions.db` 数据面

当前已新增只读接口，用于查看 `~/.verdent/projects/agent_sessions.db`：

- `GET /agent-db/summary`：表级计数摘要
- `GET /agent-db/apps`：按 `app_name` 聚合的 session 概览
- `GET /agent-db/app-states`：应用级状态
- `GET /agent-db/user-states`：用户级状态
- `GET /agent-db/sessions`：agent session 列表
- `GET /agent-db/sessions/:id`：单个 agent session
- `GET /agent-db/sessions/:id/events`：事件流（默认 `actionsHex` 保真输出；加 `decodeActions=1` 时，会用安全假类解包 `pickle protocol 5`，返回 `actionsDecoded`）

## 已验证的 sidecar 行为

- `POST /agent/update/mcp` 携带 `{"data":{}}` 可返回 `{"err_code":0,"msg":"ok"}`
- `POST /agent/update/subagent` 携带 `{"data":{}}` 可返回当前 subagent 支持情况与启用列表
- `GET /agent/root` 在鉴权通过后不会再返回 `401`，但当前会进入业务层 `500 Internal Server Error`

## 边界

- 当前没有伪造或猜测 Verdent 私有远端 API。
- 当前未拿到 `60142` 的 Basic Auth 凭据，但它大概率只服务于本地更新安装流程。
- `60142` 目前可高度怀疑是 `electron-updater` 的 `MacUpdater` 代理：根路径 `401 Invalid Authentication Credentials`、其他随机/常见路径 `404`，与 `node_modules/electron-updater/out/MacUpdater.js` 的实现吻合。

详见：`docs/reverse-notes.md` 与 `docs/architecture.md`


## 最小 `chat_stream` 控制面

当前已新增最小 WebSocket 客户端封装，可直接对接 `59647 /chat_stream`：

1. `POST /agent/chat/sessions`
   - 请求体至少提供 `apiToken`
   - 可选提供 `accessToken`（Verdent 远端登录态 access token）
   - 服务端会自动执行 `create_req` 握手

2. `POST /agent/chat/sessions/:id/prompt`
   - 发送最小用户 prompt
   - 请求体示例：`{"text":"你好"}`

3. `GET /agent/chat/sessions/:id/events`
   - 拉取握手与流式事件
   - 可观察 `create_res`、`stream_text`、`tool_use`、`tool_result`、`next_action`、`agent_end` 等

4. `GET /agent/chat/sessions/:id/stream`
   - `SSE` 实时流接口，支持历史回放 + 增量事件推送
   - 查询参数：`after/sinceIndex`、`includeHistory`、`autoClose`、`heartbeatMs`、`view=raw|merged`
   - `view=raw` 推送 `chat_event`；`view=merged` 推送带 `merged.textMessages/toolUses/childRuns` 的聚合快照
   - 已实测可收到 `ready`、`heartbeat`、`chat_event`，以及 `view=merged` 下的聚合载荷

5. `POST /agent/chat/sessions/:id/prompt-and-wait`
   - 发送 prompt 后阻塞等待本轮流式输出稳定
   - 响应会直接聚合返回 `textMessages`、`toolUses`、`nextActions`、`lastText`
   - 长链 `subagent` 场景建议调大 `idleMs` / `timeoutMs`，或后续继续轮询 `tool-uses` / `events`

6. `GET /agent/chat/sessions/:id/messages-merged`
   - 把同一 `text.id` 的 `stream_text` / `complete_text` 聚合为完整消息
   - 支持 `sinceIndex` / `after` 与 `limit`

7. `GET /agent/chat/sessions/:id/tool-uses`
   - 按 `tool_use.id` 聚合增量字段与 `tool_result`
   - 支持 `sinceIndex` / `after` 与 `limit`
   - 已实测能还原 `bash` 与 `spawn_subagent` 的命令/说明/result

8. `GET /agent/chat/sessions/:id/child-runs`
   - 专门抽取 `spawn_subagent` 及其子链
   - 返回子代理入口、聚合后的 `result`，以及按 `parentToolUseId` 归并的 `childTools` / `childTexts`

注意：
- `apiToken` 是本地 sidecar 鉴权 Cookie。
- `accessToken` 是下行消息 envelope 里的远端登录 token；若请求体未提供，服务端会优先尝试从本机 Keychain 的 `ai.verdent.deck/access-token` 自动读取。
- 可通过 `GET /agent/access-token-status` 查看本地远端 token 是否可读（仅返回 masked 状态）。
- 当前实现已能稳定聚合 `stream_text` / `complete_text`、`tool_use` / `tool_result`，并在结构化 `mention{subtype: "subagent"}` prompt 下实测触发 `spawn_subagent`。
- 当前实现仍不是对 Verdent 前端状态机的完整复刻；更复杂的 planner / review UI 事件仍建议继续结合 Electron IPC 逆向。

## 仓库结构

- `src/server.js`：HTTP API 入口
- `src/lib/verdent-chat.js`：`chat_stream` WebSocket 桥接与聚合核心
- `src/lib/verdent-db.js`：本地 SQLite 数据读取
- `docs/reverse-notes.md`：逆向结论纪要
- `docs/architecture.md`：当前架构说明
- `scripts/discover.js`：运行态探测脚本

## 发布说明

- 本仓库只包含包装层与逆向笔记，不应提交 Verdent 原始提取代码、数据库、真实 token 或用户数据。
- `extracted/` 已默认加入 `.gitignore`，避免误传专有内容。
- 对外演示时请优先使用 masked token、脱敏路径和最小复现样例。

## 发布前检查

```bash
npm run check
npm run discover
```

建议同时确认：

- `GET /health` 可访问
- `GET /discovery` 输出符合当前环境
- `POST /agent/derive-token` 或 `POST /agent/capture-token` 至少一条链可用
- `chat_stream` 的 `prompt-and-wait` 或 `SSE` 流接口可正常返回
