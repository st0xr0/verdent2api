import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function maskToken(value) {
  if (!value) return null;
  if (value.length <= 8) return '[REDACTED]';
  return `${value.slice(0, 4)}...[REDACTED]...${value.slice(-4)}`;
}

export async function getVerdentAccessTokenInfo() {
  if (process.env.VERDENT_ACCESS_TOKEN) {
    return {
      source: 'env',
      accessToken: process.env.VERDENT_ACCESS_TOKEN,
    };
  }

  const { stdout } = await execFileAsync('security', [
    'find-generic-password',
    '-s',
    'ai.verdent.deck',
    '-a',
    'access-token',
    '-w',
  ]);

  const raw = stdout.trim();
  if (!raw) {
    throw new Error('access_token_not_found');
  }

  const parsed = JSON.parse(raw);
  return {
    source: 'keychain',
    accessToken: parsed.accessToken,
    expireAt: parsed.expireAt || null,
  };
}

export async function getVerdentAccessTokenStatus() {
  try {
    const info = await getVerdentAccessTokenInfo();
    return {
      configured: Boolean(info.accessToken),
      source: info.source,
      expireAt: info.expireAt || null,
      maskedToken: maskToken(info.accessToken),
    };
  } catch (error) {
    return {
      configured: false,
      source: null,
      expireAt: null,
      maskedToken: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
