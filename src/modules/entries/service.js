// 条目（entry）：栏目下的一条记录。
// 写敏感字段时加密、读时按 reveal 打码——**这条边界只在这里实现一次**，两端共用。
//
// 写入分两趟：趟 A（异步，在草稿 section 上跑）解析字段、加密敏感值；
// 趟 B（同步，在 mutateStore 事务里）只做赋值。这样加密只发生在事务外，
// 事务里没有 await，也就没有「改了一半又抛错」的中间态。
import { loadStore, mutateStore, snapshotStore } from '../../core/store.js';
import { assertFieldKey } from '../../core/paths.js';
import { badInput, conflict, notFound } from '../../core/errors.js';
import { BOOL_FALSE, BOOL_TRUE, findSection, isSensitiveField, sectionNames } from '../../core/fields.js';
import { completeness, displaySensitive, serializeEntry } from '../../core/render.js';
import { newId, nowIso } from '../../core/ids.js';
import { decryptValue, encryptValue, isCipherBlob, maskValue } from '../../core/crypto.js';
import { resolveVaultKey, sensitiveViewer } from '../../core/vault.js';

export function mustFindSection(store, ref) {
  const s = findSection(store, ref);
  if (!s) throw notFound(`找不到栏目: ${ref} —— 现有: ${sectionNames(store)}`);
  return s;
}

/** 条目定位：id 优先，其次唯一标题；重名时报 CONFLICT 让调用方用 id 指定。 */
export function resolveEntry(store, ref, sectionRef) {
  const key = String(ref ?? '').trim();
  if (!key) throw badInput('缺少条目定位：给条目 id（e_...）或条目名');
  let list = store.entries;
  if (sectionRef) list = list.filter((e) => e.section === mustFindSection(store, sectionRef).id);
  const byId = list.find((e) => e.id === key);
  if (byId) return byId;
  const byTitle = list.filter((e) => e.title === key);
  if (byTitle.length === 1) return byTitle[0];
  if (byTitle.length > 1) {
    throw conflict(`有 ${byTitle.length} 条同名条目「${key}」，请用 id 指定: ${byTitle.map((e) => e.id).join(' / ')}`);
  }
  throw notFound(`找不到条目: ${ref}`);
}

function mergeInputs(set, data) {
  const out = {};
  if (data && typeof data === 'object') {
    // 兼容 `{values:{...}}` 与直接扁平 `{字段: 值}` 两种写法
    Object.assign(out, data.values && typeof data.values === 'object' ? data.values : data);
  }
  if (set && typeof set === 'object') Object.assign(out, set);
  return out;
}

function resolveFieldDef(section, rawKey) {
  const key = String(rawKey).trim();
  return (section.fields || []).find((x) => x.key === key || x.label === key) || null;
}

/** 允许 agent 现场扩字段：字典是数据，加一条就够，不必改代码。 */
function pushField(section, rawKey, taken) {
  const label = String(rawKey).trim();
  let key = /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(label) ? label : `f${(section.fields || []).length + 1}`;
  while ((section.fields || []).some((x) => x.key === key) || (taken || []).some((x) => x.key === key)) key = `${key}_x`;
  const def = { key: assertFieldKey(key), label, type: 'text', group: section.groups?.[0]?.id || section.fields?.[0]?.group || 'other' };
  section.fields.push(def);
  return def;
}

function normalizeValue(def, raw) {
  if (raw === null || raw === undefined) return null;
  const type = def.type;
  if (type === 'bool') {
    if (typeof raw === 'boolean') return raw;
    const s = String(raw).trim().toLowerCase();
    if (BOOL_TRUE.includes(s)) return true;
    if (BOOL_FALSE.includes(s)) return false;
    throw badInput(`字段「${def.label}」需要是/否，收到 ${JSON.stringify(raw)}`);
  }
  if (type === 'number') {
    const n = Number(String(raw).trim());
    if (!Number.isFinite(n)) throw badInput(`字段「${def.label}」需要数字，收到 ${JSON.stringify(raw)}`);
    return n;
  }
  if (type === 'tags') {
    const list = (Array.isArray(raw) ? raw.map(String) : String(raw).split(/[,，、;；\s]+/)).map((x) => x.trim()).filter(Boolean);
    if (def.maxItems && list.length > def.maxItems) {
      throw badInput(`字段「${def.label}」最多 ${def.maxItems} 项，收到 ${list.length} 项`);
    }
    return list;
  }
  const s = String(raw);
  return s.trim() === '' ? null : s;
}

async function prepareValue(section, def, raw, current) {
  if (!isSensitiveField(section, def.key)) return normalizeValue(def, raw);
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const text = String(raw);
  // 面板把打码后的值原样回传时，必须保留原密文——否则掩码会被当成新密钥存进去
  if (isCipherBlob(current)) {
    try {
      const { key } = await resolveVaultKey();
      if (maskValue(decryptValue(key, current)) === text) return current;
    } catch { /* 解不开就按新值处理 */ }
  }
  if (text.includes('******')) {
    throw badInput(`字段「${def.label}」收到的是打码占位而非明文。给完整值，或用 --unset ${def.key} 清空。`);
  }
  const { key } = await resolveVaultKey();
  return encryptValue(key, text);
}

/**
 * 趟 A：在草稿 section 上解析字段（必要时新建）、算出要写进去的值。
 * 返回 { values, newFields }——newFields 是趟 B 需要补进 section.fields 的定义。
 */
async function prepareWrite({ section, currentValues = {}, incoming, allowNewField }) {
  const draft = structuredClone(section);
  const newFields = [];
  const values = {};
  for (const [rawKey, rawValue] of Object.entries(incoming)) {
    let def = resolveFieldDef(draft, rawKey);
    if (!def) {
      if (!allowNewField) {
        const near = (section.fields || []).filter((x) => x.label.includes(String(rawKey)) || String(rawKey).includes(x.label)).slice(0, 3);
        const hint = near.length ? `是不是想写: ${near.map((x) => x.label).join(' / ')}？ ` : '';
        throw badInput(
          `栏目「${section.title}」没有字段「${rawKey}」。${hint}`
          + `用 nx-sk entry fields --section ${section.id} 看全部字段；确实要新增就加 --allow-new-field。`,
        );
      }
      def = pushField(draft, rawKey, newFields);
      newFields.push(def);
    }
    values[def.key] = await prepareValue(draft, def, rawValue, currentValues[def.key]);
  }
  return { values, newFields };
}

function autoTitle(section, values) {
  const v = section.titleField ? values[section.titleField] : undefined;
  return v === undefined || v === null || v === '' ? '' : String(v);
}

export async function listEntries({ section, q } = {}) {
  const store = await loadStore();
  let list = store.entries;
  if (section) list = list.filter((e) => e.section === mustFindSection(store, section).id);
  const viewers = new Map();
  const out = [];
  for (const e of list) {
    const sec = store.sections.find((s) => s.id === e.section);
    if (!sec) continue;
    if (!viewers.has(sec.id)) viewers.set(sec.id, await sensitiveViewer(sec, list.filter((x) => x.section === sec.id)));
    const item = serializeEntry(sec, e, { decrypt: viewers.get(sec.id) });
    if (q) {
      const hay = [item.title, sec.title, ...Object.values(item.values).map((v) => (v === null ? '' : Array.isArray(v) ? v.join(',') : String(v)))]
        .join('\n').toLowerCase();
      if (!hay.includes(String(q).toLowerCase())) continue;
    }
    out.push({ ...item, sectionTitle: sec.title });
  }
  return { count: out.length, total: store.entries.length, entries: out };
}

export async function getEntry(ref, { reveal, section } = {}) {
  const store = await loadStore();
  const entry = resolveEntry(store, ref, section);
  const sec = store.sections.find((s) => s.id === entry.section);
  if (!sec) throw notFound(`条目 ${entry.id} 指向的栏目已不存在: ${entry.section}`);
  const decrypt = await sensitiveViewer(sec, [entry]);
  return { ...serializeEntry(sec, entry, { reveal: !!reveal, decrypt }), sectionTitle: sec.title, reveal: !!reveal };
}

export async function addEntry({ section, title, set, data, tags, 'dry-run': dryRun } = {}) {
  const store = await loadStore();
  const sec = mustFindSection(store, section);
  const incoming = mergeInputs(set, data);
  if (!Object.keys(incoming).length && !title) {
    throw badInput(`至少要给一个字段：--set ${sec.fields[0]?.label || '字段'}=值（可重复），或 --data @file.json`);
  }

  const { values, newFields } = await prepareWrite({ section: sec, incoming, allowNewField: false });
  const finalTitle = String(title || autoTitle(sec, values) || '').trim();
  if (!finalTitle) {
    throw badInput(`无法确定条目名：加 --title <名>，或先填上「${sec.titleField || '首个字段'}」字段`);
  }
  const dup = store.entries.find((e) => e.section === sec.id && e.title === finalTitle);
  if (dup) throw conflict(`栏目「${sec.title}」下已有叫「${finalTitle}」的条目（${dup.id}）。要改它就用 entry update，别再加一条。`);

  const entry = {
    id: newId('e'), section: sec.id, title: finalTitle, tags: Array.isArray(tags) ? tags.map(String) : [],
    values, createdAt: nowIso(), updatedAt: nowIso(),
  };
  if (dryRun) {
    return { status: 'skipped', dryRun: true, wouldCreate: { ...entry, values: maskAll(sec, entry) }, createdFields: newFields.map((f) => f.key) };
  }
  await mutateStore((s) => { s.entries.push(entry); });
  return {
    status: 'ok', created: true, id: entry.id, title: entry.title, section: sec.id,
    completeness: completeness(sec, entry), createdFields: newFields.map((f) => f.key),
  };
}

export async function updateEntry(ref, patch = {}) {
  const dryRun = patch['dry-run'];
  const store = await loadStore();
  const target = resolveEntry(store, ref, patch.section);
  const sec = mustFindSection(store, target.section);
  const incoming = mergeInputs(patch.set, patch.data);
  const unset = patch.unset || [];

  const changedKeys = [...Object.keys(incoming), ...unset.map((k) => `-${k}`)];
  if (!changedKeys.length && patch.title === undefined && patch.tags === undefined) {
    throw badInput('没有要改的内容：用 --set 字段=值 / --data @file.json / --unset 字段 / --title / --tags');
  }
  // 先把 unset 的字段名解析出来（错别字要在写盘前就报掉）
  const unsetKeys = [];
  for (const k of unset) {
    const def = resolveFieldDef(sec, k);
    if (!def) throw notFound(`栏目「${sec.title}」没有字段: ${k}`);
    unsetKeys.push(def.key);
  }

  const { values, newFields } = await prepareWrite({
    section: sec, currentValues: target.values, incoming, allowNewField: patch['allow-new-field'],
  });

  if (dryRun) {
    return {
      status: 'skipped', dryRun: true,
      wouldChange: {
        id: target.id, fields: Object.keys(values), unset: unsetKeys,
        title: patch.title, tags: patch.tags, newFields: newFields.map((f) => f.key),
      },
    };
  }

  const snapshot = await snapshotStore(`entry-update-${target.id}`);
  await mutateStore((s) => {
    const e = s.entries.find((x) => x.id === target.id);
    const section = s.sections.find((x) => x.id === e.section);
    for (const f of newFields) {
      if (!section.fields.some((x) => x.key === f.key)) section.fields.push(f);
    }
    for (const [k, v] of Object.entries(values)) e.values[k] = v;
    for (const k of unsetKeys) e.values[k] = null;
    if (patch.title !== undefined) e.title = String(patch.title);
    if (Array.isArray(patch.tags)) e.tags = patch.tags.map(String);
    e.updatedAt = nowIso();
    if (newFields.length) section.updatedAt = nowIso();
  });

  const after = await loadStore();
  const finalEntry = after.entries.find((x) => x.id === target.id);
  const finalSec = after.sections.find((x) => x.id === finalEntry.section);
  return {
    status: 'ok', id: finalEntry.id, title: finalEntry.title, section: finalEntry.section,
    // 报**解析后**的字段 key，而不是用户敲的中文标签——调用方/agent 拿它去对比字典
    changed: [...Object.keys(values), ...unsetKeys.map((k) => `-${k}`)],
    newFields: newFields.map((f) => f.key),
    completeness: completeness(finalSec, finalEntry), snapshot,
  };
}

export async function removeEntry(ref, { section, 'dry-run': dryRun } = {}) {
  const store = await loadStore();
  const target = resolveEntry(store, ref, section);
  if (dryRun) {
    return { status: 'skipped', dryRun: true, wouldRemove: { id: target.id, title: target.title, section: target.section } };
  }
  const snapshot = await snapshotStore(`entry-remove-${target.id}`);
  await mutateStore((s) => { s.entries = s.entries.filter((e) => e.id !== target.id); });
  return { status: 'ok', removed: { id: target.id, title: target.title, section: target.section }, snapshot };
}

/** 字段字典：agent 在填之前必须先看这个，否则只能靠猜字段名。 */
export async function fieldDictionary({ section } = {}) {
  const store = await loadStore();
  const shape = (sec) => ({
    id: sec.id,
    title: sec.title,
    titleField: sec.titleField,
    titleLabel: sec.titleLabel,
    groups: sec.groups,
    fields: sec.fields.map((x) => ({
      key: x.key, label: x.label, type: x.type, group: x.group,
      hint: x.hint || '', options: x.options || null, sensitive: isSensitiveField(sec, x.key),
    })),
  });
  if (section) return { count: 1, sections: [shape(mustFindSection(store, section))] };
  return { count: store.sections.length, sections: store.sections.map(shape) };
}

/** dry-run 预览：密文字段照样打码，别把「试运行」变成泄密口子。 */
function maskAll(section, entry, decrypt) {
  const out = {};
  for (const [k, v] of Object.entries(entry.values)) {
    out[k] = isSensitiveField(section, k) ? displaySensitive(v, { decrypt }) : v;
  }
  return out;
}

// —— CLI 人读渲染 ——
export function renderEntryList(d) {
  const lines = [`${d.count} 条 / 共 ${d.total} 条`];
  for (const e of d.entries) {
    lines.push(`  ${e.id}  ${(e.title || '（无名）').padEnd(16)} ${String(e.completeness.ratio).padStart(3)}% 完整度　[${e.section}]`);
    const missing = e.missing.slice(0, 6).map((m) => m.label).join('、');
    if (missing) lines.push(`      未填: ${missing}${e.missing.length > 6 ? ` 等 ${e.missing.length} 项` : ''}`);
  }
  lines.push('', '看全部字段: nx-sk entry get <id> --json　或　nx-sk entry fields --section <id>');
  return lines.join('\n');
}

export function renderEntryGet(d) {
  const lines = [
    `${d.title || d.id}（${d.id}）· 栏目 ${d.section} · 完整度 ${d.completeness.filled}/${d.completeness.total} = ${d.completeness.ratio}%`
    + `${d.reveal ? ' · 含明文' : ' · 敏感字段已打码'}`,
  ];
  for (const [k, v] of Object.entries(d.values)) {
    if (v === null) continue;
    lines.push(`  ${k.padEnd(24)} ${Array.isArray(v) ? v.join('、') : (typeof v === 'boolean' ? (v ? '是' : '否') : String(v))}`);
  }
  if (d.missing.length) {
    lines.push('', `未填（${d.missing.length}）: ${d.missing.map((m) => `${m.label}(${m.key})`).join('、')}`);
  }
  return lines.join('\n');
}

export function renderEntryChange(d) {
  if (d.status === 'skipped') return `试运行（未落盘）：${JSON.stringify(d.wouldCreate || d.wouldChange || d.wouldRemove)}`;
  if (d.removed) return `已删除条目 ${d.removed.id}（${d.removed.title}）\n快照: ${d.snapshot}`;
  const c = d.completeness;
  if (d.created) {
    return `已创建条目 ${d.title}（${d.id}）· 栏目 ${d.section} · 完整度 ${c.filled}/${c.total} = ${c.ratio}%`
      + (d.createdFields?.length ? `\n新增字段: ${d.createdFields.join(', ')}` : '');
  }
  const extra = d.newFields?.length ? `\n新增字段: ${d.newFields.join(', ')}` : '';
  return `已更新条目 ${d.title}（${d.id}）· 改动 ${d.changed.join(', ')} · 完整度 ${c.filled}/${c.total} = ${c.ratio}%${extra}\n快照: ${d.snapshot}`;
}

export function renderFields(d) {
  const lines = [`字段字典：${d.count} 个栏目`];
  for (const s of d.sections) {
    lines.push('', `【${s.title}】${s.id}　条目名字段: ${s.titleField || '（未设）'}　共 ${s.fields.length} 字段`);
    for (const g of s.groups) {
      lines.push(`  ${g.title}（${g.id}）`);
      for (const x of s.fields.filter((f) => f.group === g.id)) {
        lines.push(`    ${x.key.padEnd(22)} ${x.label}${x.sensitive ? '  [密文]' : ''}${x.options ? `  可选: ${x.options.join(' / ')}` : ''}${x.hint ? `　${x.hint}` : ''}`);
      }
    }
  }
  return lines.join('\n');
}
