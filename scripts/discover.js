import { discoverVerdentRuntime } from '../src/lib/discovery.js';
import { getVerdentPaths } from '../src/lib/paths.js';
import { summarizeDatabase, listProjects, listSessions } from '../src/lib/verdent-db.js';
import { VerdentAgentClient } from '../src/lib/verdent-agent.js';

async function main() {
  const runtime = await discoverVerdentRuntime();
  const paths = getVerdentPaths();
  const summary = await summarizeDatabase(paths.dbPath);
  const projects = await listProjects(paths.dbPath);
  const sessions = await listSessions(paths.dbPath, { limit: 10 });
  const agent = new VerdentAgentClient();
  let openapi;

  try {
    openapi = await agent.getOpenApi();
  } catch (error) {
    openapi = {
      ok: false,
      status: 0,
      body: {
        error: 'agent_openapi_unreachable',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  console.log(
    JSON.stringify(
      {
        runtime,
        summary,
        projects,
        sessions,
        agentOpenApi: openapi.body,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
