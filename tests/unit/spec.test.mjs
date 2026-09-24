import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useTempHome } from '../helpers.mjs';

await useTempHome();

const { applySpec, argSpecsOf, cliPathsOf, compileRoute, compareRoutes, flagSpecsOf, usageOf } = await import('../../src/runtime/spec.js');
const { loadStore, migrationNote, normalize } = await import('../../src/core/store.js');
const { seedSections } = await import('../../src/core/fields.js');

const FAKE = {
  id: 'x.y',
  cli: ['x', 'y'],
  args: ['ref', { name: 'opt', required: false }],
  flags: {
    name: { type: 'string' },
    count: { type: 'number', default: 3 },
    flag: { type: 'boolean' },
    list: { type: 'array' },
    set: { type: 'kv' },
    mode: { type: 'string', enum: ['a', 'b'] },
  },
  run: () => null,
};

test('usageOf 生成完整用法串，布尔 flag 不取值、enum 展开为候选项', () => {
  const u = usageOf(FAKE);
  assert.match(u, /^nx-sk x y <ref> \[opt\]/);
  assert.match(u, /\[--flag\]/);
  assert.match(u, /\[--mode <a\|b>\]/);
  assert.doesNotMatch(u, /\[--flag </, '布尔 flag 不该带取值占位符');
});

test('applySpec：位置参数按 args 顺序具名，多余/缺失都报错并带用法锚点', () => {
  const ctx = applySpec(FAKE, { ref: 'abc' });
  assert.equal(ctx.ref, 'abc');
  assert.equal(ctx.count, 3, '写命令的 default 应被注入');

  assert.throws(() => applySpec(FAKE, {}), (e) => e.code === 'INVALID_INPUT' && e.message.includes('用法:'));
  const withOptional = applySpec(FAKE, { ref: 'a', opt: 'b' });
  assert.equal(withOptional.opt, 'b', '可空位置参数应能绑上');
});

test('applySpec：强转与 enum 校验', () => {
  const ctx = applySpec(FAKE, { ref: 'a', count: '7', flag: 'true', list: 'x,y', set: ['k=v', 'k2=v2'] });
  assert.equal(ctx.count, 7);
  assert.equal(ctx.flag, true);
  assert.deepEqual(ctx.list, ['x', 'y']);
  assert.deepEqual(ctx.set, { k: 'v', k2: 'v2' });
  assert.throws(() => applySpec(FAKE, { ref: 'a', count: 'abc' }), /需要数字/);
  assert.throws(() => applySpec(FAKE, { ref: 'a', mode: 'zzz' }), /只能是/);
});

test('applySpec：未声明的键被丢弃（HTTP body 里的多余字段不该流进 service）', () => {
  const ctx = applySpec(FAKE, { ref: 'a', somethingElse: 'leak' });
  assert.equal('somethingElse' in ctx, false);
});

test('flagSpecsOf / argSpecsOf 归一化字符串写法', () => {
  assert.deepEqual(argSpecsOf({ args: ['a'] }), [{ name: 'a', required: true }]);
  assert.equal(flagSpecsOf({ flags: { f: { type: 'boolean' } } })[0].type, 'boolean');
  assert.deepEqual(cliPathsOf({ cli: [['a', 'b'], ['c', 'd']] }), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(cliPathsOf({ cli: ['a', 'b'] }), [['a', 'b']]);
});

test('compileRoute：路径占位符进 keys，正则能匹配实例', () => {
  const r = compileRoute(['DELETE', '/api/entries/:ref']);
  assert.equal(r.method, 'DELETE');
  assert.deepEqual(r.keys, ['ref']);
  assert.ok(r.regex.test('/api/entries/e_abc123'));
  assert.ok(!r.regex.test('/api/entries/a/b'), '不能跨段匹配');
});

test('compareRoutes：字面量段优先，声明顺序不影响匹配（遮蔽是静默 bug）', () => {
  const literal = { ...compileRoute(['GET', '/api/sections/templates']) };
  const param = { ...compileRoute(['GET', '/api/sections/:ref']) };
  const longer = { ...compileRoute(['GET', '/api/sections/:ref/dump']) };

  const sorted = [param, literal, longer].sort(compareRoutes);
  assert.equal(sorted[0].path, '/api/sections/templates', '字面量必须排最前');
  assert.ok(sorted.indexOf(longer) < sorted.indexOf(param), '段数多的更具体的排在笼统的之前');

  // 反面对照：按声明顺序匹配的话，先声明的 :ref 会把 templates 吃掉
  const naive = [param, literal].find((r) => r.regex.test('/api/sections/templates'));
  assert.equal(naive.path, '/api/sections/:ref', '这就是不加排序会踩的坑');
});

test('normalize：store 文件不存在才播种；文件在但栏目为空时不复活', () => {
  const fresh = normalize(null);
  assert.ok(fresh.sections.length >= 2, '首次运行应播种默认栏目');
  assert.equal(fresh.sections[0].id, 'job', '第一个栏目必须是求职');

  const emptied = normalize({ version: 1, settings: {}, sections: [], entries: [] });
  assert.deepEqual(emptied.sections, [], '用户删光了栏目就不该再播种——否则等于删不掉');
});

test('loadStore：损坏的 store.json 会被挪走，而不是被下次写入覆盖', async () => {
  const dir = process.env.NX_SK_HOME;
  const fsp = await import('node:fs/promises');
  const { join } = await import('node:path');
  const p = join(dir, 'store.json');
  await fsp.writeFile(p, '{ 这不是合法 JSON', 'utf8');

  const store = await loadStore();
  assert.deepEqual(store.entries, []);
  const files = await fsp.readdir(dir);
  assert.ok(files.some((f) => f.includes('.corrupt-')), `损坏文件应被保留一份：${files.join(', ')}`);
  assert.ok(!files.includes('store.json'), '损坏文件应从原位置移走');
});

test('seedSections：默认栏目字段字典非空且带分组', () => {
  const [job] = seedSections('2026-01-01T00:00:00.000Z');
  assert.equal(job.id, 'job');
  assert.ok(job.fields.length > 50, `求职栏目字段应足够全，实际 ${job.fields.length}`);
  assert.ok(job.groups.length >= 5);
  assert.equal(job.titleField, 'name');
});

test('v1 → v2 迁移：密钥栏目缩成 KV，旧值不删，且先留原始快照', async () => {
  const fsp = await import('node:fs/promises');
  const { join } = await import('node:path');
  const dir = process.env.NX_SK_HOME;
  const p = join(dir, 'store.json');

  const v1 = {
    version: 1,
    settings: {},
    sections: [{
      id: 'secret', title: '密钥', description: 'old', order: 20, template: 'secret',
      titleField: 'provider', titleLabel: '密钥名',
      groups: [{ id: 'key', title: '密钥信息' }],
      fields: [
        { key: 'provider', label: '服务商', type: 'select', group: 'key' },
        { key: 'keyValue', label: '密钥值', type: 'secret', group: 'key' },
        { key: 'model', label: '模型标识', type: 'text', group: 'key' },
      ],
    }],
    entries: [{
      id: 'e_old', section: 'secret', title: 'OpenAI', tags: [],
      values: { provider: 'OpenAI', keyValue: 'sk-old-123', model: 'gpt-4o' },
    }],
  };
  await fsp.writeFile(p, JSON.stringify(v1, null, 2), 'utf8');

  const migrated = await loadStore(p);
  const sec = migrated.sections.find((x) => x.id === 'secret');
  assert.equal(migrated.version, 2, '迁移后版本号必须落到 2，否则每次读盘都会重跑');
  assert.deepEqual(sec.fields.map((f) => f.key), ['value'], '字典缩成单字段 KV');
  assert.equal(sec.titleField, null);
  assert.equal(migrated.entries[0].values.value, 'sk-old-123', 'keyValue 的值要搬到 value');
  assert.equal(migrated.entries[0].values.model, 'gpt-4o', '其它旧值**不能删**——不再显示 ≠ 删掉');
  assert.equal(migrated.entries[0].values.provider, 'OpenAI');

  const note = migrationNote();
  assert.ok(note && note.from === 1 && note.to === 2, '迁移要留可展示的记录');
  const snap = await fsp.readFile(note.snapshotRaw, 'utf8');
  assert.equal(JSON.parse(snap).version, 1, '快照必须是**迁移前**的原始文件，否则退回也没用');

  const onDisk = JSON.parse(await fsp.readFile(p, 'utf8'));
  assert.equal(onDisk.version, 2, '迁移要就地落盘（幂等靠这个）');

  const before = (await fsp.readdir(join(dir, 'backup'))).length;
  await loadStore(p);
  const after = (await fsp.readdir(join(dir, 'backup'))).length;
  assert.equal(after, before, '第二次读盘不该再迁移、再留快照');
});

test('正规的 v2 store 不会被迁移触碰', () => {
  const s = normalize({ version: 2, settings: {}, sections: [], entries: [] });
  assert.equal(s._migration, undefined);
  assert.equal(s.version, 2);
});
