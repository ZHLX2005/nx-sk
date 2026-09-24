// 状态读写：原子写 + 按 mtime 失效的缓存 + 读-改-写事务。
// 所有模块都通过这里碰磁盘，不自己拼路径、不自己 JSON.parse。
import fsp from 'node:fs/promises';
import { join } from 'node:path';
import { snapshotDir, storeFile } from './paths.js';
import { ensureDir, pathExists, writeAtomic, writeJsonAtomic } from './fsx.js';
import { seedSections } from './fields.js';
import { nowIso, stamp } from './ids.js';

export const STORE_VERSION = 1;
export const MAX_SNAPSHOTS = 20;
export const MAX_EXPORT_HISTORY = 30;

export function defaultSettings() {
  return {
    exportDir: '', // 空 = ~/nx-sk/export
    exportFormat: 'both', // json | md | both
    includeSecretsInExport: false,
    defaultSection: 'job',
  };
}

function emptyStore(seed) {
  const at = nowIso();
  return {
    version: STORE_VERSION,
    settings: defaultSettings(),
    // ⚠️ 只有「store 文件压根不存在」才播种。文件在、但 sections 为空
    // 说明用户自己删光了栏目——这时候再播种会把它变回来，等于删不掉。
    sections: seed ? seedSections(at) : [],
    entries: [],
    exports: [],
  };
}

function normalizeSection(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  return {
    id: String(raw.id),
    title: String(raw.title || raw.id),
    description: String(raw.description || ''),
    order: Number.isFinite(raw.order) ? raw.order : 50,
    template: raw.template ? String(raw.template) : null,
    titleField: raw.titleField ? String(raw.titleField) : null,
    titleLabel: String(raw.titleLabel || '名称'),
    groups: Array.isArray(raw.groups) ? raw.groups.map((g) => ({ id: String(g.id), title: String(g.title || g.id) })) : [],
    fields: Array.isArray(raw.fields) ? raw.fields.map((x) => ({ ...x, key: String(x.key), label: String(x.label || x.key) })) : [],
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  return {
    id: String(raw.id),
    section: String(raw.section || ''),
    title: String(raw.title || ''),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    values: raw.values && typeof raw.values === 'object' ? { ...raw.values } : {},
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
}

export function normalize(data) {
  if (!data || typeof data !== 'object') return emptyStore(true);
  const base = emptyStore(false);
  base.version = Number.isFinite(data.version) ? data.version : STORE_VERSION;
  base.settings = { ...base.settings, ...(data.settings && typeof data.settings === 'object' ? data.settings : {}) };
  base.sections = (Array.isArray(data.sections) ? data.sections : []).map(normalizeSection).filter(Boolean);
  base.entries = (Array.isArray(data.entries) ? data.entries : []).map(normalizeEntry).filter(Boolean);
  base.exports = Array.isArray(data.exports) ? data.exports.slice(0, MAX_EXPORT_HISTORY) : [];
  return base;
}

let cache = null;
let cachePath = null;
let cacheMtime = -1;
let cacheCorruptNote = null;

export function storePathInUse() {
  return storeFile();
}

/** 最近一次读盘时把损坏文件挪走的记录（bootstrap / health 会展示）。 */
export function corruptNote() {
  return cacheCorruptNote;
}

export async function loadStore(explicitPath) {
  const p = explicitPath || storeFile();
  try {
    const st = await fsp.stat(p);
    if (cache && cachePath === p && cacheMtime === st.mtimeMs) return cache;
    const raw = await fsp.readFile(p, 'utf8');
    let parsed = null;
    let corrupt = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // 读失败**降级返回空结构**（工具不该启动即崩），但先把损坏文件留一份——
      // 直接返回空结构的话，下一次写入就把用户的数据永久覆盖了。
      corrupt = join(p + '.corrupt-' + stamp() + '.json');
      try { await fsp.rename(p, corrupt); } catch { /* 尽力 */ }
      cacheCorruptNote = { from: p, to: corrupt, error: String(e && e.message) };
    }
    cache = normalize(parsed);
    cachePath = p;
    // 解析失败时文件已被挪走，mtime 用 -1 强制下次重新判断
    cacheMtime = corrupt ? -1 : st.mtimeMs;
    return cache;
  } catch {
    cache = emptyStore(true);
    cachePath = p;
    cacheMtime = -1;
    return cache;
  }
}

export async function saveStore(next, explicitPath) {
  const p = explicitPath || storeFile();
  const data = normalize(next);
  await ensureDir(join(p, '..'));
  // 原子写：临时文件 + rename。中断时用户要么看到旧数据，要么看到新数据。
  await writeAtomic(p, JSON.stringify(data, null, 2) + '\n');
  cache = data;
  cachePath = p;
  try { cacheMtime = (await fsp.stat(p)).mtimeMs; } catch { cacheMtime = -1; }
  return data;
}

/**
 * 读-改-写事务：fn 直接改传入的**深拷贝**；抛错则不落盘。
 * structuredClone 是必需的——直接改缓存对象会让「抛错不落盘」名存实亡。
 */
export async function mutateStore(fn, explicitPath) {
  const cur = structuredClone(await loadStore(explicitPath));
  const result = fn(cur);
  await saveStore(cur, explicitPath);
  return result === undefined ? cur : result;
}

/** 破坏性写入前留一份可回滚快照。 */
export async function snapshotStore(reason, explicitPath) {
  const cur = await loadStore(explicitPath);
  const dir = snapshotDir();
  await ensureDir(dir);
  const file = join(dir, `${stamp()}-${reason}.json`);
  await writeJsonAtomic(file, cur);
  await pruneSnapshots(dir);
  return file;
}

async function pruneSnapshots(dir) {
  try {
    const items = (await fsp.readdir(dir)).filter((n) => n.endsWith('.json')).sort();
    const extra = items.length - MAX_SNAPSHOTS;
    for (let i = 0; i < extra; i++) await fsp.rm(join(dir, items[i]), { force: true });
  } catch { /* 清理失败不影响主流程 */ }
}

export async function listSnapshots() {
  const dir = snapshotDir();
  try {
    const items = (await fsp.readdir(dir)).filter((n) => n.endsWith('.json')).sort().reverse();
    const out = [];
    for (const name of items.slice(0, MAX_SNAPSHOTS)) {
      const p = join(dir, name);
      const st = await fsp.stat(p);
      out.push({ name, path: p, bytes: st.size, at: st.mtime.toISOString() });
    }
    return out;
  } catch {
    return [];
  }
}

export async function storeExists() {
  return pathExists(storeFile());
}
