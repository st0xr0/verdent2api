import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_BUFFER_SIZE = 256 * 1024;

function trimBuffer(text) {
  return text.length > MAX_BUFFER_SIZE ? text.slice(-MAX_BUFFER_SIZE) : text;
}

function summarize(text) {
  const normalized = text.trim();
  if (!normalized) return null;
  return normalized.split(/\r?\n/).slice(-6).join('\n');
}

function parseApiToken(text) {
  const match = text.match(/api_token=([^;\s\r\n]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function captureAgentApiToken(options = {}) {
  const interfaceName = options.interfaceName || process.env.VERDENT_CAPTURE_INTERFACE || 'lo0';
  const port = Number(options.port || process.env.VERDENT_AGENT_PORT || 59647);
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const tcpdumpPath = process.env.TCPDUMP_PATH || 'tcpdump';

  return await new Promise((resolve, reject) => {
    const child = spawn(tcpdumpPath, ['-i', interfaceName, '-A', '-s', '0', `tcp port ${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    let stdoutText = '';
    let stderrText = '';

    const finish = (result, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 250).unref();
      }

      if (error) {
        reject(error);
        return;
      }

      resolve(result);
    };

    const inspectChunk = chunk => {
      const text = chunk.toString('utf8');
      stdoutText = trimBuffer(stdoutText + text);
      const token = parseApiToken(stdoutText);
      if (token) {
        finish({
          captured: true,
          token,
          source: 'tcpdump',
          interfaceName,
          port,
        });
      }
    };

    child.stdout.on('data', inspectChunk);
    child.stderr.on('data', chunk => {
      const text = chunk.toString('utf8');
      stderrText = trimBuffer(stderrText + text);
      stdoutText = trimBuffer(stdoutText + text);
      const token = parseApiToken(stdoutText);
      if (token) {
        finish({
          captured: true,
          token,
          source: 'tcpdump',
          interfaceName,
          port,
        });
      }
    });

    child.on('error', error => {
      finish(null, error);
    });

    child.on('exit', (code, signal) => {
      if (settled) return;
      const combined = `${stderrText}\n${stdoutText}`;
      if (/permission denied|operation not permitted|you don't have permission/i.test(combined)) {
        finish(null, new Error('tcpdump_permission_denied'));
        return;
      }

      finish({
        captured: false,
        reason: code === 0 ? 'completed_without_token' : 'tcpdump_exited',
        interfaceName,
        port,
        exitCode: code,
        signal,
        stderr: summarize(stderrText),
      });
    });

    const timer = setTimeout(() => {
      finish({
        captured: false,
        reason: 'timeout',
        interfaceName,
        port,
        stderr: summarize(stderrText),
      });
    }, timeoutMs);

    timer.unref();
  });
}
