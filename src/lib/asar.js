import fs from 'node:fs';
import path from 'node:path';

function walk(node, prefix = '', acc = []) {
  if (!node?.files) return acc;
  for (const [name, value] of Object.entries(node.files)) {
    const fullPath = prefix ? `${prefix}/${name}` : name;
    if (value.files) {
      walk(value, fullPath, acc);
    } else {
      acc.push({ path: fullPath, ...value });
    }
  }
  return acc;
}

export function readAsarHeader(archivePath) {
  const fd = fs.openSync(archivePath, 'r');
  const prefix = Buffer.alloc(16);
  fs.readSync(fd, prefix, 0, 16, 0);
  const archiveHeaderSize = prefix.readUInt32LE(4);
  const headerSize = prefix.readUInt32LE(12);
  const headerBuffer = Buffer.alloc(headerSize);
  fs.readSync(fd, headerBuffer, 0, headerSize, 16);
  fs.closeSync(fd);

  return {
    header: JSON.parse(headerBuffer.toString('utf8')),
    baseOffset: 8 + archiveHeaderSize,
  };
}

export function listAsarFiles(archivePath, pattern) {
  const { header } = readAsarHeader(archivePath);
  const files = walk(header);
  if (!pattern) return files;
  const matcher = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
  return files.filter((entry) => matcher.test(entry.path));
}

export function extractAsarFile(archivePath, internalPath, outputPath) {
  const { header, baseOffset } = readAsarHeader(archivePath);
  const files = walk(header);
  const target = files.find((entry) => entry.path === internalPath);
  if (!target) {
    throw new Error(`ASAR entry not found: ${internalPath}`);
  }

  const fd = fs.openSync(archivePath, 'r');
  const content = Buffer.alloc(target.size);
  fs.readSync(fd, content, 0, target.size, baseOffset + Number(target.offset));
  fs.closeSync(fd);

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content);
  }

  return content;
}

export function readAsarJson(archivePath, internalPath) {
  return JSON.parse(extractAsarFile(archivePath, internalPath).toString('utf8'));
}
