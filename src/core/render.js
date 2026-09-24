// 纯渲染逻辑（不碰磁盘、不碰平台）——值格式化、条目序列化、栏目全量视图。
// 放 core 是为了能单测：这些函数决定了「读出去的形状」，是最该被钉住的契约。
//
// ⚠️ 这里**不解密**：解密需要密钥（异步、且属于安全边界），所以由调用方把一个
// `decrypt(blob) => 明文` 传进来（core/vault.js 的 `sensitiveViewer` 负责造它）。
// 这样 render 保持纯函数，而「什么时候允许看明文」仍然只有一个决策点。
import { isCipherBlob, maskValue } from './crypto.js';
import { isSensitiveField } from './fields.js';

export function isBlank(v) {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  return String(v).trim() === '';
}

/** 值 → 人读字符串（bool / tags / 数组 / 标量）。 */
export function formatValue(value) {
  if (isBlank(value)) return '';
  if (Array.isArray(value)) return value.map(String).join('、');
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

/**
 * 敏感字段的展示形态。三种输入都要处理：
 *   密文对象  → 有 decrypt 就解开（再看 reveal 决定打不打码），没有就标「已加密」
 *   明文      → 历史数据可能存的是明文，同样按 reveal 决定打码
 *   空        → null
 */
export function displaySensitive(raw, { reveal = false, decrypt } = {}) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (!isCipherBlob(raw)) return reveal ? String(raw) : maskValue(String(raw));
  if (!decrypt) return reveal ? '[需要密钥才能解密]' : '[已加密]';
  try {
    const plain = decrypt(raw);
    return reveal ? plain : maskValue(plain);
  } catch {
    return '[无法解密：密钥或密文与写入时不一致]';
  }
}

/**
 * 条目的**唯一序列化出口**（面板、`entry list`、`section dump` 共用一份）。
 * 两个出口各写一遍序列化，迟早会分叉成「CLI 看得到、面板看不到」。
 */
export function serializeEntry(section, entry, { reveal = false, decrypt } = {}) {
  const c = completeness(section, entry);
  const values = {};
  for (const def of section.fields) {
    const raw = entry.values?.[def.key];
    if (isBlank(raw)) { values[def.key] = null; continue; }
    values[def.key] = isSensitiveField(section, def.key)
      ? displaySensitive(raw, { reveal, decrypt })
      : raw;
  }
  return {
    id: entry.id,
    section: entry.section,
    title: entry.title,
    tags: entry.tags || [],
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    completeness: { filled: c.filled, total: c.total, ratio: c.ratio },
    missing: c.missing.map((x) => ({ key: x.key, label: x.label })),
    values,
  };
}

/** 完整度：填了几个字段。给「AI 帮我补全信息」当导航用。 */
export function completeness(section, entry) {
  const fields = section?.fields || [];
  const missing = [];
  let filled = 0;
  for (const def of fields) {
    if (isBlank(entry?.values?.[def.key])) missing.push(def);
    else filled++;
  }
  const total = fields.length;
  return { filled, total, ratio: total ? Math.round((filled / total) * 100) : 0, missing };
}

/** 栏目的纯数据视图：所有条目 + 全部字段（含未填），供 `section dump` 与面板用。 */
export function dumpSection(section, entries, { reveal = false, decrypt } = {}) {
  const mine = entries.filter((e) => e.section === section.id);
  return {
    section: {
      id: section.id,
      title: section.title,
      description: section.description,
      order: section.order,
      template: section.template,
      titleField: section.titleField,
      titleLabel: section.titleLabel,
      fields: section.fields.length,
    },
    groups: section.groups,
    fields: section.fields.map((x) => ({
      key: x.key,
      label: x.label,
      type: x.type,
      group: x.group,
      hint: x.hint || '',
      options: x.options || null,
      sensitive: isSensitiveField(section, x.key),
    })),
    count: mine.length,
    entries: mine.map((e) => serializeEntry(section, e, { reveal, decrypt })),
  };
}
