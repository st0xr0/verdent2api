import fs from 'node:fs';
import { readAsarJson } from './asar.js';
import { getVerdentPaths } from './paths.js';

export async function discoverVerdentRuntime() {
  const paths = getVerdentPaths();
  const appInstalled = fs.existsSync(paths.appBundle);
  const appAsarExists = fs.existsSync(paths.appAsarPath);
  const dbExists = fs.existsSync(paths.dbPath);
  const agentSessionsExists = fs.existsSync(paths.agentSessionsDbPath);

  let packageJson = null;
  if (appAsarExists) {
    packageJson = readAsarJson(paths.appAsarPath, 'package.json');
  }

  let storage = null;
  if (fs.existsSync(paths.storagePath)) {
    storage = JSON.parse(fs.readFileSync(paths.storagePath, 'utf8'));
  }

  return {
    paths,
    appInstalled,
    appAsarExists,
    dbExists,
    agentSessionsExists,
    packageJson,
    storage,
    localServices: {
      appPort: Number(process.env.VERDENT_APP_PORT || 60142),
      agentPort: Number(process.env.VERDENT_AGENT_PORT || 59647),
    },
    findings: [
      'Verdent 主程序是 Electron 桌面应用。',
      'app.asar 内 package.json 声明 productName=Verdent，main=dist/index.js。',
      '本地 SQLite `app-v2.db` 保存 projects / sessions / conversation_messages。',
      '本地 sidecar `verdent_agent` 暴露 uvicorn HTTP 服务。',
      '59647/openapi.json 可匿名访问；业务端点要求 Cookie `api_token`。',
      '59647 当前公开端点仅见 `/`, `/update/mcp`, `/update/subagent`。',
      'Electron AuthService 通过 PKCE 登录 Verdent 官网，并把远端 JWT 以 `token` Cookie 注入 `verdent.ai` 域。',
      '60142 存在另一条本地服务，根路径返回 `401 Invalid Authentication Credentials`，其响应模式与 electron-updater 的 MacUpdater 本地更新代理高度一致。',
    ],
  };
}
