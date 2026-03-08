const fs = require('fs');
const path = require('path');

function readUInt32LE(buf, offset) { return buf.readUInt32LE(offset); }

function readAsarHeader(archive) {
  const fd = fs.openSync(archive, 'r');
  const sizeBuf = Buffer.alloc(16);
  fs.readSync(fd, sizeBuf, 0, 16, 0);
  const dataSize = readUInt32LE(sizeBuf, 0);
  const headerSize = readUInt32LE(sizeBuf, 12);
  const headerBuf = Buffer.alloc(headerSize);
  fs.readSync(fd, headerBuf, 0, headerSize, 16);
  fs.closeSync(fd);
  return { header: JSON.parse(headerBuf.toString('utf8')), baseOffset: 16 + headerSize, dataSize, headerSize };
}

function walk(node, prefix = '', acc = []) {
  if (!node || !node.files) return acc;
  for (const [name, value] of Object.entries(node.files)) {
    const full = prefix ? `${prefix}/${name}` : name;
    if (value.files) walk(value, full, acc);
    else acc.push({ path: full, ...value });
  }
  return acc;
}

function extractFile(archive, info, baseOffset, outputPath) {
  if (!('offset' in info) || !('size' in info)) throw new Error('Not a file entry');
  const fd = fs.openSync(archive, 'r');
  const out = Buffer.alloc(info.size);
  fs.readSync(fd, out, 0, info.size, baseOffset + Number(info.offset));
  fs.closeSync(fd);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, out);
}

const archive = process.argv[2];
const cmd = process.argv[3];
const arg = process.argv[4];
if (!archive || !cmd) {
  console.error('usage: node tools_extract_asar.js <archive> list [pattern]| extract <path> <out>');
  process.exit(1);
}
const { header, baseOffset } = readAsarHeader(archive);
const files = walk(header);
if (cmd === 'list') {
  const pattern = arg ? new RegExp(arg, 'i') : null;
  for (const file of files) {
    if (!pattern || pattern.test(file.path)) console.log(file.path);
  }
} else if (cmd === 'extract') {
  const filePath = process.argv[4];
  const outPath = process.argv[5];
  const found = files.find((f) => f.path === filePath);
  if (!found) {
    console.error('not found:', filePath);
    process.exit(2);
  }
  extractFile(archive, found, baseOffset, outPath);
  console.log(`extracted ${filePath} -> ${outPath}`);
} else {
  console.error('unknown cmd:', cmd);
  process.exit(1);
}
