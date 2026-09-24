// 通用 CLI 运行器：解析 → 匹配 → 校验 → 渲染 → help。
// 命令表由 action 声明派生，所以「Web 上能做的 CLI 都能做」是结构保证，不靠人记。
import { resolve as resolvePath } from 'node:path';
import { APP_NAME, ENV_STORE, VERSION } from '../core/paths.js';
import { badInput, external, toErrorShape } from '../core/errors.js';
import { ACTIONS, MODULES, MODULE_TITLES, commandEntry } from './registry.js';
import { applySpec, argSpecsOf, cliPathsOf, flagSpecsOf, usageOf } from './spec.js';

// `--json` 需要被 serve 这类长驻命令看到，所以用一个模块级开关而不是往 meta 里塞字段
// （meta 的契约只有 { transport }，别把两端形态差异以外的东西塞进去）。
let OUTPUT_JSON = false;

async function cmdServe(ctx) {
  const { startServer } = await import('./server.js');
  const { openBrowser } = await import('../core/open.js');
  const { loadStore, storePathInUse } = await import('../core/store.js');
  const { appHome, displayPath } = await import('../core/paths.js');

  await loadStore(); // 触发首次播种：面板一打开就该有「求职」栏目
  let server;
  try {
    server = await startServer({ port: ctx.port });
  } catch (e) {
    if (e && e.code === 'EADDRINUSE') throw external(`端口 ${ctx.port} 已被占用；换一个：nx-sk serve --port 7801`);
    throw external(`启动服务失败: ${e && e.message ? e.message : String(e)}`);
  }
  // --port 0 = 让 OS 挑一个空闲端口（测试用），所以真实端口要回读，不能信入参
  const realPort = server.address() && typeof server.address() === 'object' ? server.address().port : ctx.port;
  const url = `http://127.0.0.1:${realPort}`;
  if (OUTPUT_JSON) {
    process.stdout.write(JSON.stringify({
      url, port: realPort, host: '127.0.0.1', pid: process.pid,
      storePath: displayPath(storePathInUse()), storePathRaw: storePathInUse(), home: displayPath(appHome()),
    }) + '\n');
  } else {
    process.stdout.write([
      `面板:   ${url}`,
      `存储:   ${displayPath(storePathInUse())}`,
      '退出:   Ctrl-C',
      '机器可读: nx-sk serve --json（先打一行 JSON，再继续常驻）',
    ].join('\n') + '\n');
  }
  if (!ctx['no-open']) await openBrowser(url);

  await new Promise((done) => {
    let closed = false;
    const stop = () => {
      if (closed) return;
      closed = true;
      server.close(() => done());
      setTimeout(done, 800).unref?.();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return { status: 'ok', stopped: true, url };
}

const BUILTINS = [
  {
    id: 'serve',
    module: 'system',
    cli: ['serve'],
    http: null,
    summary: '启动 Web 面板（唯一常驻命令；--no-open 给开发与 CI 用）',
    flags: { port: { type: 'number', default: 7800 }, 'no-open': { type: 'boolean' } },
    run: (ctx) => cmdServe(ctx),
    render: () => '',
  },
  {
    id: 'help',
    module: 'system',
    cli: ['help'],
    http: null,
    summary: '命令表；可带主题（模块 id / 命令组 / action id）',
    args: [{ name: 'topic', required: false }],
    run: (ctx) => helpEntries(ctx.topic),
    render: (d, ctx) => renderHelp(d, ctx.topic),
  },
  {
    id: 'version',
    module: 'system',
    cli: ['version'],
    http: null,
    summary: '输出版本号（裸输出，便于 V=$(nx-sk version)）',
    run: () => VERSION,
    render: (v) => v,
  },
];

export const ALL_COMMANDS = [...BUILTINS, ...ACTIONS];

// 转出去给 system 模块用：它必须在**函数体内**动态 import 这里（静态 import registry 会成环）。
// 不转这一行，system 就得去静态 import registry —— 那正是分层规则要禁止的环。
export { commandEntry };

export function helpEntries(topic) {
  const all = ALL_COMMANDS.map(commandEntry);
  if (!topic) return all;
  const t = String(topic);
  if (MODULES.some((m) => m.id === t)) return all.filter((e) => e.module === t);
  const byRoot = all.filter((e) => e.command.split(' ')[1] === t);
  if (byRoot.length) return byRoot;
  const byId = all.filter((e) => e.id === t);
  if (byId.length) return byId;
  throw badInput(`未知帮助主题: ${t}（可用模块: ${MODULES.map((m) => m.id).join(' / ')}；或命令组如 section / entry）`);
}

export function renderHelp(entries, topic) {
  const lines = [`${APP_NAME} v${VERSION} · 本机个人资源管理器`, ''];
  if (topic) lines.push(`主题: ${topic}`, '');
  lines.push('用法: nx-sk <命令组> <子命令> [参数] [--flags]　　任何命令都支持 --json', '');
  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.module)) groups.set(e.module, []);
    groups.get(e.module).push(e);
  }
  for (const [mod, list] of groups) {
    lines.push(`【${MODULE_TITLES[mod] || mod}】`);
    for (const e of list) {
      lines.push(`  ${e.command}`);
      lines.push(`      ${e.summary}`);
      if (e.usage !== e.command) lines.push(`      用法: ${e.usage}`);
      if (e.http) lines.push(`      接口: ${e.http}`);
    }
    lines.push('');
  }
  lines.push('常用姿势：');
  lines.push('  nx-sk bootstrap --json                          一次拿齐上下文（agent 首选入口）');
  lines.push('  nx-sk section dump job --json                   一个栏目的全部信息（字段 + 全部条目 + 未填清单）');
  lines.push('  nx-sk entry fields --section job                字段字典：填之前先看，别猜字段名');
  lines.push('  nx-sk entry update 张三 --set 微信=zhangsan 改一个字段（PATCH 语义）');
  lines.push('  nx-sk export run --format both                  整体导出到 ~/nx-sk/export');
  lines.push('  nx-sk serve                                     打开 Web 面板');
  return lines.join('\n');
}

/**
 * 最长前缀匹配：命令路径里可以含 flag（那是一条命令路径，不是「带 flag 的命令」）。
 * 导出是为了让一致性测试能「只走匹配、零副作用」地验证每条 action 都能被解析回自己。
 */
export function resolveCommand(tokens, commands = ALL_COMMANDS) {
  let best = null;
  let bestLen = -1;
  for (const action of commands) {
    for (const path of cliPathsOf(action)) {
      if (path.length <= bestLen || path.length > tokens.length) continue;
      if (path.every((seg, i) => tokens[i] === seg)) { best = action; bestLen = path.length; }
    }
  }
  if (!best) return { action: null, rest: [], tried: tokens.slice(0, 2) };
  return { action: best, rest: tokens.slice(bestLen), tried: tokens.slice(0, bestLen) };
}

function pushFlag(raw, name, value, spec) {
  if (spec.type === 'array' || spec.type === 'kv') {
    raw[name] = raw[name] === undefined ? [value] : [].concat(raw[name], value);
  } else {
    raw[name] = value;
  }
}

function parseArgs(action, tokens) {
  const flagSpecs = new Map(flagSpecsOf(action).map((s) => [s.name, s]));
  const argSpecs = argSpecsOf(action);
  const raw = {};
  const positional = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--') { positional.push(...tokens.slice(i + 1)); break; }
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      const name = eq >= 0 ? t.slice(2, eq) : t.slice(2);
      const spec = flagSpecs.get(name);
      if (!spec) throw badInput(`用法: ${usageOf(action)} —— 未知参数 --${name}`);
      if (eq >= 0) { pushFlag(raw, name, t.slice(eq + 1), spec); continue; }
      if (spec.type === 'boolean') { pushFlag(raw, name, true, spec); continue; }
      const next = tokens[i + 1];
      if (next === undefined || next.startsWith('--')) {
        // 注意：`--depth` 无值时报错，不要静默转换——Number(true) 会变成「深度 1」这种另一个合法值
        throw badInput(`用法: ${usageOf(action)} —— 参数 --${name} 缺少取值`);
      }
      i++;
      pushFlag(raw, name, next, spec);
      continue;
    }
    if (t.startsWith('-') && t.length > 1) {
      throw badInput(`用法: ${usageOf(action)} —— 未知参数 ${t}（本 CLI 只使用 --长参数）`);
    }
    positional.push(t);
  }

  for (let i = 0; i < positional.length && i < argSpecs.length; i++) raw[argSpecs[i].name] = positional[i];
  if (positional.length > argSpecs.length) {
    throw badInput(`用法: ${usageOf(action)} —— 多余的位置参数: ${positional.slice(argSpecs.length).join(' ')}`);
  }
  return raw;
}

const STATUS_NOTE = {
  skipped: '（未做改动——目标已是期望状态，或用 --dry-run 试运行）',
  conflict: '（需要你决策后才能继续，不要自动重试）',
  blocked: '（被业务规则挡住：先去满足前置条件）',
};

async function emit(action, data, ctx) {
  if (OUTPUT_JSON) {
    process.stdout.write(JSON.stringify(data === undefined ? null : data) + '\n');
    return;
  }
  let text;
  if (typeof action.render === 'function') text = await action.render(data, ctx);
  else text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  if (text === undefined || text === null || text === '') return;
  const status = data && typeof data === 'object' ? data.status : undefined;
  if (status && status !== 'ok') text = `${text}\n状态: ${status} ${STATUS_NOTE[status] || ''}`.trimEnd();
  process.stdout.write(`${text}\n`);
}

export async function runCli(argv) {
  const opts = { json: false, store: null };
  const tokens = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') { opts.json = true; continue; }
    if (t === '--store') {
      const v = argv[++i];
      if (v === undefined) { process.stderr.write('nx-sk: --store 缺少取值\n'); process.exitCode = 1; return; }
      opts.store = v;
      continue;
    }
    if (t.startsWith('--store=')) { opts.store = t.slice('--store='.length); continue; }
    tokens.push(t);
  }
  // 全局 flag 先摘掉再匹配命令；--store 通过环境变量下传，服务层就不必到处接一个路径参数
  if (opts.store) process.env[ENV_STORE] = resolvePath(opts.store);
  OUTPUT_JSON = opts.json;

  let lastAction = null;
  try {
    if (!tokens.length) {
      await emit({ render: (d, c) => renderHelp(d, c) }, helpEntries(), {});
      return;
    }
    const { action, rest, tried } = resolveCommand(tokens);
    if (!action) throw badInput(`未知命令: ${tried.join(' ')} —— 用 nx-sk help 看全部命令`);
    lastAction = action;
    const ctx = applySpec(action, parseArgs(action, rest));
    const data = await action.run(ctx, { transport: 'cli' });
    await emit(action, data, ctx);
  } catch (err) {
    const e = toErrorShape(err);
    // 参数/用法类错误必须带完整用法串——agent 靠「用法:」这个锚点判断「该改参数而不是重试」。
    // 放在运行器里统一补，比要求每个 service 自己记得写更可靠。
    if (e.code === 'INVALID_INPUT' && !e.message.includes('用法:') && lastAction) {
      e.message += `\n用法: ${usageOf(lastAction)}`;
    }
    if (opts.json) process.stdout.write(JSON.stringify({ ok: false, error: e.message, code: e.code }) + '\n');
    else process.stderr.write(`${APP_NAME}: ${e.message}\n`);
    process.exitCode = 1;
  }
}
