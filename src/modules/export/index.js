import * as service from './service.js';

export default {
  id: 'export',
  title: '导出',
  order: 700,
  view: () => import('./view.jsx'),
  actions: [
    {
      id: 'export.run',
      cli: ['export', 'run'],
      http: ['POST', '/api/export'],
      summary: '把全部（或单个）栏目导出成 JSON / Markdown；凭据默认打码，--with-secrets 才出明文',
      flags: {
        out: { type: 'string', hint: '导出目录，缺省 ~/nx-sk/export' },
        format: { type: 'string', enum: ['json', 'md', 'both'], hint: '缺省取设置里的 exportFormat' },
        section: { type: 'string', hint: '只导出某个栏目' },
        'with-secrets': { type: 'boolean', hint: '包含密钥明文字段（谨慎）' },
        'no-secrets': { type: 'boolean', hint: '强制不带密钥明文' },
        'dry-run': { type: 'boolean' },
      },
      run: (ctx) => service.exportAll({
        out: ctx.out, format: ctx.format, section: ctx.section,
        withSecrets: ctx['with-secrets'] ? true : (ctx['no-secrets'] ? false : undefined),
        'dry-run': ctx['dry-run'],
      }),
      render: (d) => service.renderExport(d),
    },
    {
      id: 'export.list',
      cli: ['export', 'list'],
      http: ['GET', '/api/exports'],
      summary: '列出历次导出与导出目录内的文件',
      flags: {},
      run: () => service.listExports(),
      render: (d) => service.renderExportList(d),
    },
  ],
};
