// 导出（整体导出 / 单栏目导出）。
// 这是**动作集合**不是集合资源——它不产生实体，只对已有数据做事，所以不套 CRUD 五动词。
import fsp from 'node:fs/promises';
import { resolve } from 'node:path';
import { displayPath, exportDir, VERSION } from '../../core/paths.js';
import { ensureDir, fileSize, pathExists, writeAtomic } from '../../core/fsx.js';
import { loadStore, mutateStore, MAX_EXPORT_HISTORY, storePathInUse } from '../../core/store.js';
import { displaySensitive, dumpSection, formatValue } from '../../core/render.js';
import { decryptValue, isCipherBlob } from '../../core/crypto.js';
import { resolveVaultKey, sensitiveViewer } from '../../core/vault.js';
import { badInput } from '../../core/errors.js';
import { nowIso, stamp } from '../../core/ids.js';
import { findSection, isSensitiveField, sectionNames } from '../../core/fields.js';
import { getSettings } from '../settings/service.js'; // 唯一允许的跨模块依赖：基础模块

const FORMATS = ['json', 'md', 'both'];

/** 需要明文时先把密文解开；解不开就抛 BLOCKED（带着「密钥来源变了」的明确原因）。 */
async function plainValues(section, values) {
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    if (isSensitiveField(section, k) && isCipherBlob(v)) {
      const { key } = await resolveVaultKey();
      out[k] = decryptValue(key, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function displayValues(section, values, decrypt, mask = false) {
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = isSensitiveField(section, k) ? displaySensitive(v, { mask, decrypt }) : v;
  }
  return out;
}

function renderBundleMarkdown(bundle) {
  const lines = [];
  lines.push('# nx-sk 个人资源导出');
  lines.push('');
  lines.push(`导出时间：${bundle.generatedAt}`);
  lines.push(`栏目数：${bundle.sections.length}　条目数：${bundle.entries.length}`);
  lines.push(`密文字段：${bundle.withSecrets ? '含明文' : '已打码'}`);
  lines.push('');
  for (const section of bundle.sections) {
    lines.push(`## ${section.title}（${section.id}）`);
    lines.push('');
    if (section.description) { lines.push(`> ${section.description}`); lines.push(''); }
    const mine = bundle.entries.filter((e) => e.section === section.id);
    if (!mine.length) { lines.push('_（本栏目暂无条目）_'); lines.push(''); continue; }
    const groupTitle = (id) => section.groups.find((g) => g.id === id)?.title || id;
    for (const e of mine) {
      lines.push(`### ${e.title}（\`${e.id}\`）`);
      lines.push('');
      lines.push(`- 完整度：${e.completeness.filled}/${e.completeness.total}（${e.completeness.ratio}%）`);
      if (e.updatedAt) lines.push(`- 更新于：${e.updatedAt}`);
      lines.push('');
      let cur = null;
      for (const f of section.fields) {
        if (f.group !== cur) { cur = f.group; lines.push(`**${groupTitle(cur)}**`); lines.push(''); }
        lines.push(`- ${f.label}：${formatValue(e.values[f.key]) || '（未填写）'}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

export async function exportAll({ out, format, withSecrets, section, 'dry-run': dryRun } = {}) {
  const settings = (await getSettings()).settings;
  const fmt = format || settings.exportFormat || 'both';
  if (!FORMATS.includes(fmt)) throw badInput(`--format 只能是 ${FORMATS.join(' / ')}`);

  const store = await loadStore();
  let sections = store.sections;
  if (section) {
    const s = findSection(store, section);
    if (!s) throw badInput(`找不到栏目: ${section} —— 现有: ${sectionNames(store)}`);
    sections = [s];
  }
  const ids = new Set(sections.map((s) => s.id));
  const entries = store.entries.filter((e) => ids.has(e.section));

  // 默认取设置；现在默认就是**含明文**（本机单人工具，自己看的东西不必先拦一道）
  const includeSecrets = withSecrets === undefined ? !!settings.includeSecretsInExport : !!withSecrets;
  const dir = out ? resolve(out) : (settings.exportDir ? resolve(settings.exportDir) : exportDir());
  const generatedAt = nowIso();
  const base = `${stamp()}-nx-sk`;

  const bundle = {
    app: 'nx-sk',
    version: VERSION,
    generatedAt,
    storePath: displayPath(storePathInUse()),
    withSecrets: includeSecrets,
    counts: { sections: sections.length, entries: entries.length },
    sections: sections.map((s) => ({
      id: s.id, title: s.title, description: s.description, titleLabel: s.titleLabel,
      groups: s.groups,
      fields: s.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, group: f.group, sensitive: isSensitiveField(s, f.key) })),
    })),
    entries: [],
  };
  for (const e of entries) {
    const sec = sections.find((s) => s.id === e.section);
    const decrypt = await sensitiveViewer(sec, [e]);
    const values = includeSecrets ? await plainValues(sec, e.values) : displayValues(sec, e.values, decrypt, true);
    const meta = dumpSection(sec, [e], { mask: !includeSecrets, decrypt }).entries[0];
    bundle.entries.push({ id: e.id, section: e.section, sectionTitle: sec.title, title: e.title, tags: e.tags, createdAt: e.createdAt, updatedAt: e.updatedAt, completeness: meta.completeness, values });
  }

  const files = [];
  if (fmt === 'json' || fmt === 'both') files.push({ kind: 'json', name: `${base}.json`, content: JSON.stringify(bundle, null, 2) + '\n' });
  if (fmt === 'md' || fmt === 'both') files.push({ kind: 'md', name: `${base}.md`, content: renderBundleMarkdown(bundle) });

  if (dryRun) {
    return {
      status: 'skipped', dryRun: true,
      wouldWrite: { dir: displayPath(dir), files: files.map((f) => ({ name: f.name, bytes: Buffer.byteLength(f.content) })), withSecrets: includeSecrets, sections: sections.length, entries: entries.length },
    };
  }

  await ensureDir(dir);
  const written = [];
  for (const f of files) {
    const p = resolve(dir, f.name);
    await writeAtomic(p, f.content);
    written.push({ kind: f.kind, path: displayPath(p), pathRaw: p, bytes: await fileSize(p) });
  }

  await mutateStore((s) => {
    s.exports.unshift({
      at: generatedAt, dir: displayPath(dir), dirRaw: dir, format: fmt, withSecrets: includeSecrets,
      sections: sections.length, entries: entries.length,
      files: written.map((w) => ({ path: w.path, pathRaw: w.pathRaw })),
    });
    s.exports = s.exports.slice(0, MAX_EXPORT_HISTORY);
  });

  return { status: 'ok', dir: displayPath(dir), dirRaw: dir, format: fmt, withSecrets: includeSecrets, sections: sections.length, entries: entries.length, files: written };
}

export async function listExports() {
  const store = await loadStore();
  const history = await Promise.all(store.exports.map(async (h) => {
    const files = await Promise.all((h.files || []).map(async (f) => {
      const raw = typeof f === 'string' ? resolve(f) : f.pathRaw;
      return { path: typeof f === 'string' ? f : f.path, bytes: await fileSize(raw), exists: await pathExists(raw) };
    }));
    return { ...h, files };
  }));

  // 扫「默认导出目录」+「历史里出现过的目录」：只扫默认目录的话，
  // 用 --out 导出的文件会在列表里凭空消失，用户以为导出失败了。
  const dirs = [...new Set([exportDir(), ...store.exports.map((h) => h.dirRaw).filter(Boolean)])];
  const disk = [];
  for (const d of dirs) {
    let names = [];
    try { names = (await fsp.readdir(d)).filter((n) => n.endsWith('.json') || n.endsWith('.md')).sort().reverse(); } catch { continue; }
    for (const n of names) disk.push({ dir: displayPath(d), name: n });
  }
  return { count: history.length, history, dir: displayPath(exportDir()), dirs: dirs.map(displayPath), disk };
}

export function renderExport(d) {
  if (d.status === 'skipped') {
    const w = d.wouldWrite;
    return `试运行（未写盘）\n目录: ${w.dir}\n文件: ${w.files.map((f) => `${f.name}（${f.bytes} 字节）`).join('、')}\n栏目 ${w.sections} · 条目 ${w.entries} · 明文密钥: ${w.withSecrets ? '是' : '否（打码）'}`;
  }
  const lines = [
    `已导出 ${d.sections} 个栏目 / ${d.entries} 条条目 → ${d.dir}`,
    `格式: ${d.format}　凭据: ${d.withSecrets ? '含明文' : '已打码'}`,
  ];
  for (const f of d.files) lines.push(`  ${f.path}　${f.bytes} 字节`);
  return lines.join('\n');
}

export function renderExportList(d) {
  const lines = [`导出目录: ${d.dirs.join(' , ')}　历史 ${d.count} 条`];
  for (const h of d.history) {
    lines.push(`  ${h.at}　${h.format}　${h.sections} 栏目 / ${h.entries} 条目　${h.withSecrets ? '含明文' : '已打码'}`);
    for (const f of h.files) lines.push(`      ${f.path}${f.exists ? '' : '（已不在磁盘上）'}`);
  }
  if (d.disk.length) {
    lines.push('', '目录内文件：');
    for (const f of d.disk) lines.push(`  ${f.dir}/${f.name}`);
  }
  return lines.join('\n');
}
