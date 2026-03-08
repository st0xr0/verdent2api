import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function normalizeSqlValue(value) {
  if (value === '' || value === 'NULL' || value === undefined) return null;
  return value;
}

export async function querySqlite(dbPath, sql) {
  const { stdout } = await execFileAsync('sqlite3', ['-json', dbPath, sql], {
    maxBuffer: 10 * 1024 * 1024,
  });

  if (!stdout.trim()) return [];
  const rows = JSON.parse(stdout);
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeSqlValue(value)])),
  );
}

export async function querySingle(dbPath, sql) {
  const rows = await querySqlite(dbPath, sql);
  return rows[0] ?? null;
}
