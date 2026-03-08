import os from 'node:os';
import path from 'node:path';

const home = os.homedir();

export function getVerdentPaths() {
  const userDataDir =
    process.env.VERDENT_USER_DATA_DIR || path.join(home, 'Library', 'Application Support', 'Verdent');
  const verdentDir = process.env.VERDENT_DIR || path.join(home, '.verdent');
  const appBundle = process.env.VERDENT_APP_PATH || '/Applications/Verdent.app';

  return {
    home,
    appBundle,
    appResourcesDir: path.join(appBundle, 'Contents', 'Resources'),
    appAsarPath: path.join(appBundle, 'Contents', 'Resources', 'app.asar'),
    userDataDir,
    dbPath: path.join(userDataDir, 'app-v2.db'),
    verdentDir,
    agentSessionsDbPath: path.join(verdentDir, 'projects', 'agent_sessions.db'),
    configPath: path.join(verdentDir, 'config.json'),
    storagePath: path.join(userDataDir, 'verdent-storage.json'),
  };
}
