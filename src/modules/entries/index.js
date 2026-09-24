import * as service from './service.js';

export default {
  id: 'entries',
  title: '条目',
  order: 600,
  // 有视图，但**不是独立 tab**——它由「栏目」动态挂载（每个栏目一个 tab，共用这个视图）
  view: () => import('./view.jsx'),
  tab: false,
  // 一组同级实体，每条有标识，用户会想改其中一条或删其中一条 → 集合资源
  resource: 'entry',
  actions: [
    {
      id: 'entry.list',
      cli: ['entry', 'list'],
      http: ['GET', '/api/entries'],
      summary: '列条目（可按栏目过滤、按关键字搜索）；返回完整度与未填清单',
      flags: {
        // 读命令的过滤 flag 不带 default：「不传」代表「全部栏目」
        section: { type: 'string', hint: '栏目 id 或标题' },
        q: { type: 'string', hint: '关键字' },
      },
      run: (ctx) => service.listEntries(ctx),
      render: (d) => service.renderEntryList(d),
    },
    {
      id: 'entry.fields',
      cli: ['entry', 'fields'],
      http: ['GET', '/api/entries/fields'],
      summary: '字段字典：填之前先看这个，别猜字段名',
      flags: { section: { type: 'string' } },
      run: (ctx) => service.fieldDictionary(ctx),
      render: (d) => service.renderFields(d),
    },
    {
      id: 'entry.get',
      cli: ['entry', 'get'],
      http: ['GET', '/api/entries/:ref'],
      summary: '读单条（id 或条目名都接受）；--reveal 显示密文字段明文',
      args: ['ref'],
      flags: {
        reveal: { type: 'boolean', hint: '显示密文字段明文' },
        section: { type: 'string', hint: '限定栏目，解决同名歧义' },
      },
      run: (ctx) => service.getEntry(ctx.ref, ctx),
      render: (d) => service.renderEntryGet(d),
    },
    {
      id: 'entry.add',
      cli: ['entry', 'add'],
      http: ['POST', '/api/entries'],
      summary: '新增条目。同栏目同名报 CONFLICT（不静默 upsert）；字段值用 --set 字段=值 或 --data @file.json',
      flags: {
        section: { type: 'string', required: true, hint: '栏目 id 或标题' },
        title: { type: 'string', hint: '条目名，缺省取栏目的名称字段' },
        set: { type: 'kv', hint: '字段=值，可重复；键可用 key 或中文标签' },
        data: { type: 'json', hint: '整份 JSON，或 @文件路径' },
        tags: { type: 'array' },
        'dry-run': { type: 'boolean' },
      },
      run: (ctx) => service.addEntry(ctx),
      render: (d) => service.renderEntryChange(d),
    },
    {
      id: 'entry.update',
      cli: ['entry', 'update'],
      http: ['PATCH', '/api/entries/:ref'],
      summary: '改条目（PATCH 语义：只改传入字段）。--allow-new-field 可现场扩字段字典',
      args: ['ref'],
      flags: {
        set: { type: 'kv', hint: '字段=值，可重复' },
        data: { type: 'json', hint: '整份 JSON，或 @文件路径' },
        unset: { type: 'array', hint: '要清空的字段 key，逗号分隔' },
        title: { type: 'string' },
        tags: { type: 'array' },
        section: { type: 'string' },
        'allow-new-field': { type: 'boolean', hint: '允许写入字典里没有的字段（自动补进字典）' },
        'dry-run': { type: 'boolean' },
      },
      run: (ctx) => service.updateEntry(ctx.ref, ctx),
      render: (d) => service.renderEntryChange(d),
    },
    {
      id: 'entry.remove',
      cli: ['entry', 'remove'],
      http: ['DELETE', '/api/entries/:ref'],
      summary: '删条目。目标不存在报 NOT_FOUND（不静默成功）。写前自动留快照',
      args: ['ref'],
      flags: {
        section: { type: 'string' },
        'dry-run': { type: 'boolean' },
      },
      run: (ctx) => service.removeEntry(ctx.ref, ctx),
      render: (d) => service.renderEntryChange(d),
    },
  ],
};
