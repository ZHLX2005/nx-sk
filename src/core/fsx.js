import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fsp from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { toPosix } from './paths.js';

export async function pathExists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

export async function isDir(p) {
  try { return (await fsp.stat(p)).isDirectory(); } catch { return false; }
}

export async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

/** 原子写：临时文件 + rename。rename 在同一文件系统上是原子的。 */
export async function writeAtomic(p, content) {
  await ensureDir(dirname(p));
  const tmp = `${p}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, content);
  await fsp.rename(tmp, p);
}

export async function writeJsonAtomic(p, data) {
  await writeAtomic(p, JSON.stringify(data, null, 2) + '\n');
}

export async function readFileText(p) {
  return fsp.readFile(p, 'utf8');
}

/** 读 JSON；失败返回 fallback（数据损坏时工具不该启动即崩）。 */
export async function readJson(p, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(p, 'utf8'));
  } catch {
    return fallback;
  }
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export async function hashFile(p) {
  return new Promise((ok, no) => {
    const h = createHash('sha256');
    createReadStream(p).on('error', no).on('data', (c) => h.update(c)).on('end', () => ok(h.digest('hex')));
  });
}

/** 递归列出目录下所有文件的 posix 相对路径（升序），不含目录本身。 */
export async function listFiles(dir, base = dir) {
  const out = [];
  let items = [];
  try { items = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const it of items.sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = join(dir, it.name);
    if (it.isDirectory()) out.push(...(await listFiles(abs, base)));
    else out.push(toPosix(abs.slice(base.length + 1)));
  }
  return out;
}

/**
 * 逐文件 sha256 比对两棵树，返回**内容不同 / 只在一侧存在**的相对路径。
 * 空数组 = 完全一致。用于 skill install 的三态判定。
 */
export async function diffTrees(src, dst) {
  const srcFiles = await listFiles(src);
  const dstFiles = await listFiles(dst);
  const all = [...new Set([...srcFiles, ...dstFiles])].sort();
  const diff = [];
  for (const rel of all) {
    const inSrc = srcFiles.includes(rel);
    const inDst = dstFiles.includes(rel);
    if (!inSrc || !inDst) { diff.push(rel); continue; }
    const [a, b] = await Promise.all([hashFile(join(src, rel)), hashFile(join(dst, rel))]);
    if (a !== b) diff.push(rel);
  }
  return diff;
}

export async function copyTree(src, dst) {
  await ensureDir(dirname(dst));
  await fsp.cp(src, dst, { recursive: true, dereference: true, force: true });
}

export async function removeTree(p) {
  await fsp.rm(p, { recursive: true, force: true });
}

export async function fileSize(p) {
  try { return (await fsp.stat(p)).size; } catch { return 0; }
}

/** 尽力收紧权限（Windows 上是 no-op，POSIX 上 0600）。 */
export async function chmodPrivate(p) {
  try { await fsp.chmod(p, 0o600); } catch { /* Windows / 文件系统不支持 */ }
}
