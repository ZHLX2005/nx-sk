// settings 是**基础模块**：允许被其它模块单向只读依赖（见 eslint 互依禁列——它故意不在里面）。
// 设置的唯一读写入口在这里，别绕过去直接改 store.settings。
import { loadStore, mutateStore, snapshotStore } from '../../core/store.js';
import { badInput, notFound } from '../../core/errors.js';

export const SETTING_KEYS = ['exportDir', 'exportFormat', 'includeSecretsInExport', 'defaultSection'];

const SCHEMA = {
  exportDir: { type: 'string', hint: '导出目录，留空 = ~/nx-sk/export' },
  exportFormat: { type: 'string', enum: ['json', 'md', 'both'], hint: '整体导出默认格式' },
  includeSecretsInExport: { type: 'boolean', hint: '整体导出是否默认带密钥明文（默认否）' },
  defaultSection: { type: 'string', hint: '默认栏目 id' },
};

export function settingsSchema() {
  return Object.entries(SCHEMA).map(([key, s]) => ({ key, ...s }));
}

export async function getSettings() {
  const store = await loadStore();
  return { settings: store.settings, schema: settingsSchema() };
}

function coerceSetting(key, value) {
  const s = SCHEMA[key];
  if (!s) throw notFound(`未知设置项: ${key}（可用: ${SETTING_KEYS.join(', ')}）`);
  if (s.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    const v = String(value).trim().toLowerCase();
    if (['是', 'true', '1', 'yes'].includes(v)) return true;
    if (['否', 'false', '0', 'no', ''].includes(v)) return false;
    throw badInput(`设置项 ${key} 需要是/否，收到 ${JSON.stringify(value)}`);
  }
  const str = String(value);
  if (s.enum && !s.enum.includes(str)) throw badInput(`设置项 ${key} 只能是 ${s.enum.join(' / ')}`);
  return str;
}

/** PATCH 语义：只改传入的项，未传的保持原值。 */
export async function updateSettings({ set, key, value, 'dry-run': dryRun } = {}) {
  let patch = {};
  if (set && typeof set === 'object') patch = { ...set };
  if (key !== undefined) patch[key] = value;

  const keys = Object.keys(patch);
  if (!keys.length) throw badInput('至少要给一项：setting set --key <名> --value <值>，或 --set k=v（可重复）');

  const resolved = {};
  for (const k of keys) resolved[k] = coerceSetting(k, patch[k]);

  if (dryRun) return { status: 'skipped', dryRun: true, wouldSet: resolved };

  const snapshot = await snapshotStore('setting-set');
  const result = await mutateStore((s) => {
    const before = {};
    for (const [k, v] of Object.entries(resolved)) { before[k] = s.settings[k]; s.settings[k] = v; }
    return { before, after: { ...resolved } };
  });
  return { status: 'ok', set: result.after, before: result.before, snapshot, path: '~/nx-sk/store.json' };
}

export function renderSettings(data) {
  const lines = ['当前设置（改：nx-sk setting set --key <名> --value <值>）'];
  for (const s of data.schema) {
    const v = data.settings[s.key];
    const shown = s.type === 'boolean' ? (v ? '是' : '否') : (v === '' ? '（空）' : String(v));
    lines.push(`  ${s.key.padEnd(22)} ${shown.padEnd(10)} ${s.hint}`);
  }
  return lines.join('\n');
}

export function renderSettingSet(d) {
  if (d.status === 'skipped') return `试运行：将设置 ${JSON.stringify(d.wouldSet)}（未落盘）`;
  const lines = ['已更新设置：'];
  for (const [k, v] of Object.entries(d.set)) lines.push(`  ${k}: ${JSON.stringify(d.before[k])} -> ${JSON.stringify(v)}`);
  if (d.snapshot) lines.push(`快照: ${d.snapshot}`);
  return lines.join('\n');
}
