# Verdent2api 架构

## 目标

把 Verdent 桌面端拆成三层：

1. **Discovery Layer**：识别安装路径、版本、端口、数据库、sidecar
2. **Data Layer**：读取本地 SQLite，暴露项目 / 会话 / 消息
3. **Control Layer**：代理 sidecar `59647` 的已知 HTTP 接口，并承接运行时 token 捕获

## 模块

### `src/lib/asar.js`

- 纯 Node 解析 `app.asar`
- 读取 `package.json` 与指定内部文件

### `src/lib/paths.js`

- 统一 Verdent 安装路径、userData 路径、`.verdent` 路径

### `src/lib/sqlite.js`

- 不引入第三方依赖
- 通过系统 `sqlite3 -json` 执行查询

### `src/lib/verdent-db.js`

- `projects`
- `sessions`
- `conversation_messages`
- 数据库统计汇总

### `src/lib/verdent-agent.js`

- 对接 `http://127.0.0.1:59647`
- 自动附加 `Cookie: api_token=...`
- 支持通过环境变量或单请求 Header/Cookie 覆写 token
- 当前支持：
  - `getOpenApi()`
  - `getRoot()`
  - `updateMcp()`
  - `updateSubagent()`

### `src/lib/token-derive.js`

- 基于静态逆向固化 token 算法
- 公式：`md5("verdent_${nonce}_app")`
- 供手工获取 nonce 后直接装载 sidecar token

### `src/lib/token-store.js`

- 在进程内缓存 sidecar `api_token`
- 仅对外暴露 masked 状态
- 统一处理 env token 与运行时捕获 token 的优先级

### `src/lib/token-capture.js`

- 调用本机 `tcpdump` 短时监听 `lo0:59647`
- 从 `/chat_stream` 的 WebSocket Upgrade 明文头中抽取 `api_token`
- 抽取后把明文留在内存，不写入文档与接口响应

### `src/lib/discovery.js`

- 输出逆向摘要
- 聚合 `app.asar`、storage、端口与事实链

### `src/server.js`

- 统一 REST 出口
- 把本地数据库与 sidecar 包装成可复用 API
- 暴露 token 状态与运行时捕获能力

## 数据流

### 只读链

`HTTP Request -> server.js -> verdent-db.js -> sqlite3 CLI -> app-v2.db`

### 控制链

`HTTP Request -> server.js -> verdent-agent.js -> 59647 sidecar`

### 推导链

`HTTP Request -> server.js -> token-derive.js(md5) -> token-store.js -> verdent-agent.js`

### 捕获链

`HTTP Request -> server.js -> token-capture.js -> tcpdump(lo0:59647) -> token-store.js -> verdent-agent.js`

## 设计取舍

- **不引入额外 npm 依赖**：仓库从空仓起步，先保持最小依赖面
- **优先本地 SQLite**：这是当前最稳定、最确定的数据来源
- **sidecar 只代理已确认接口**：避免凭空编造私有协议
- **token 不明文外泄**：接口只返回 masked 状态，避免把本地凭据散出去
- **把 `60142` 从“业务 API 待破目标”降级为“更新代理待考证”**：当前证据更支持它属于 `electron-updater` 的 `MacUpdater` 本地代理，不纳入 Verdent2api 控制面

## 后续演进

### `v0.2`

- 捕获成功后增加自动健康探针，验证缓存 token 是否已可直打 sidecar
- 增加 sidecar 全量 schema 快照

### `v0.3`

- 解析 `agent_sessions.db`，补全工具调用与事件流
- 输出更贴近会话 replay 的结构化 API

### `v0.4`

- 对 `60142` 动态调试
- 视结果增加更多控制面 endpoint
