import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useTempHome } from '../helpers.mjs';

await useTempHome();

const { renderSectionChange } = await import('../../src/modules/sections/service.js');

// 回归：`removed` 在两条路径上**形状不同**——removeSection 给的是对象
// `{id,title,entries}`，updateSection 给的是**被删字段 key 的数组**。
// 数组恒为真值，所以早先的 `if (d.removed)` 会让 `section update` 永远走删除分支，
// 打印出「已删除栏目 undefined」，而且 `.entries` 还会取到 `Array.prototype.entries`，
// 把 `function entries() { [native code] }` 打进人类可读输出。
test('update 的 removed 是数组时，不能走「已删除栏目」分支', () => {
  const out = renderSectionChange({
    status: 'ok', id: 'job', changed: ['fields'], added: ['skills'], removed: [], snapshot: 'S',
  });
  assert.match(out, /已更新栏目 job/);
  assert.match(out, /新增字段 skills/);
  assert.ok(!out.includes('已删除栏目'), `不该出现「已删除栏目」，实际: ${out}`);
  assert.ok(!out.includes('[native code]'), `不该把 Array.prototype.entries 打进输出，实际: ${out}`);
});

test('没有字段增删时也不误报删除', () => {
  const out = renderSectionChange({
    status: 'ok', id: 'job', changed: ['order'], added: [], removed: [], snapshot: 'S',
  });
  assert.match(out, /已更新栏目 job：order/);
  assert.ok(!out.includes('已删除栏目'));
});

test('真删字段时报「删除字段」，仍不是「已删除栏目」', () => {
  const out = renderSectionChange({
    status: 'ok', id: 'job', changed: ['fields'], added: [], removed: ['skills'], snapshot: 'S',
  });
  assert.match(out, /删除字段 skills/);
  assert.ok(!out.includes('已删除栏目'));
});

test('remove 的对象形状仍走删除分支（别把修复改过头）', () => {
  const out = renderSectionChange({
    status: 'ok', removed: { id: 'job', title: '求职', entries: 3 }, snapshot: 'S',
  });
  assert.match(out, /已删除栏目 job（连带 3 条条目）/);
});
