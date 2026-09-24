// 端到端冒烟：真起服务、真跑 CLI、真发 HTTP。
// 全部在临时 NX_SK_HOME 里跑 —— 绝不碰用户真实的 ~/nx-sk/store.json。
// 破坏性路径用 --dry-run 覆盖，最后一步才真删（删的是测试自己造的那条）。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = join(ROOT, 'bin', 'nx-sk.mjs');
const NODE = process.execPath;

const home = await mkdtemp(join(tmpdir(), 'nx-sk-smoke-'));
const env = { ...process.env, NX_SK_HOME: home, NX_SK_STORE: join(home, 'store.json') };
delete env.NX_SK_PASSPHRASE;

let passed = 0;
const step = (name, ok, extra = '') => {
  passed++;
  process.stdout.write(`  ok ${String(passed).padStart(2)} · ${name}${extra ? `　${extra}` : ''}\n`);
  if (!ok) throw new Error(`断言失败: ${name}`);
};

function cli(args, { expectFail = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(NODE, [BIN, ...args], { env, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('close', (code) => {
      if (!expectFail) assert.equal(code, 0, `CLI 失败: nx-sk ${args.join(' ')}\nstdout: ${out}\nstderr: ${err}`);
      resolve({ code, out: out.trim(), err: err.trim() });
    });
  });
}

async function cliJson(args) {
  const { out } = await cli([...args, '--json']);
  return JSON.parse(out);
}

/** 期望失败的命令：`--json` 下错误是 stdout 上的单个 JSON 值（agent 的解析协议）。 */
async function cliError(args) {
  const { out, err } = await cli([...args, '--json'], { expectFail: true });
  try {
    return JSON.parse(out);
  } catch {
    return { code: null, error: `${out}\n${err}`.trim() };
  }
}

/** 裸 HTTP：用来测 Origin 头这类浏览器侧行为（fetch 对某些头有额外处理）。 */
function rawRequest(base, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, base);
    const h = { ...headers };
    if (body) h['content-length'] = Buffer.byteLength(body);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: h }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── 1. CLI 全链路 ────────────────────────────────────────────
process.stdout.write('\n[1] CLI\n');

const boot = await cliJson(['bootstrap']);
step('bootstrap 给出上下文', boot.app.name === 'nx-sk' && boot.counts.sections >= 2);
step('第一个栏目是「求职」', boot.sections[0].id === 'job' && boot.sections[0].title === '求职', `${boot.sections.length} 个栏目`);
step('存储落在隔离的临时目录', boot.storePathRaw.startsWith(home), boot.storePath);

const ver = await cli(['version']);
step('version 裸输出', /^\d+\.\d+\.\d+$/.test(ver.out), ver.out);

const help = await cli(['help']);
step('help 由声明生成且含模块分组', help.out.includes('entry') && help.out.includes('栏目'));

const templates = await cliJson(['section', 'templates']);
step('section templates 列出内置模板', templates.templates.map((t) => t.id).join() === 'job,secret');

const fields = await cliJson(['entry', 'fields', '--section', 'job']);
const fieldKeys = new Set(fields.sections[0].fields.map((f) => f.key));
step('字段字典含关键字段', ['name', 'phone', 'targetPosition', 'expectCities'].every((k) => fieldKeys.has(k)), `${fieldKeys.size} 个字段`);
step('字段字典标注了密文字段', fields.sections[0].fields.every((f) => f.sensitive === false));

const added = await cliJson(['entry', 'add', '--section', 'job', '--set', '姓名=冒烟测试', '--set', '电话=13800000000', '--set', '期望城市=北京、上海']);
step('entry add 自动取名并算完整度', added.created === true && added.title === '冒烟测试', `完整度 ${added.completeness.ratio}%`);

const got = await cliJson(['entry', 'get', '冒烟测试']);
step('entry get 用名字定位', got.values.name === '冒烟测试' && got.section === 'job');
step('tags 字段被强转成数组', Array.isArray(got.values.expectCities) && got.values.expectCities.length === 2);

const dup = await cliError(['entry', 'add', '--section', 'job', '--set', '姓名=冒烟测试']);
step('重复 add 报 CONFLICT（不静默 upsert）', dup.code === 'CONFLICT');

const noArg = await cliError(['entry', 'add', '--section', 'job']);
step('缺参数报错带「用法:」锚点', noArg.code === 'INVALID_INPUT' && noArg.error.includes('用法:'));

const badField = await cliError(['entry', 'update', '冒烟测试', '--set', '不存在的字段=1']);
step('未知字段报错并给候选', badField.error.includes('没有字段'));

const updated = await cliJson(['entry', 'update', '冒烟测试', '--set', '目标岗位=后端开发', '--set', '是否应届生=是', '--unset', '电话']);
step('entry update 是 PATCH 语义', updated.changed.includes('targetPosition') && updated.changed.includes('-phone'));

const afterUnset = await cliJson(['entry', 'get', '冒烟测试']);
step('--unset 真的清空', afterUnset.values.phone === null && afterUnset.values.targetPosition === '后端开发');
step('bool 字段被强转', afterUnset.values.isFreshGraduate === true);

const dryRemove = await cliJson(['entry', 'remove', '冒烟测试', '--dry-run']);
step('remove --dry-run 不落盘', dryRemove.status === 'skipped' && dryRemove.dryRun === true);
const stillThere = await cliJson(['entry', 'get', '冒烟测试']);
step('试运行后条目还在', stillThere.id === got.id);

// 密钥栏目：密文落盘 + 默认打码
const secret = await cliJson(['entry', 'add', '--section', 'secret', '--set', 'provider=OpenAI', '--set', 'keyValue=sk-smoke-1234567890abcdef']);
const masked = await cliJson(['entry', 'get', secret.id]);
step('密文字段默认打码', masked.values.keyValue === 'sk-s******cdef', masked.values.keyValue);
step('密文里读不到明文', !JSON.stringify(masked).includes('1234567890abcdef'));

const reveal = await cliJson(['entry', 'get', secret.id, '--reveal']);
step('--reveal 才给明文', reveal.values.keyValue === 'sk-smoke-1234567890abcdef');

const raw = await readFile(join(home, 'store.json'), 'utf8');
step('store.json 里没有密钥明文', !raw.includes('sk-smoke-1234567890'), '只有 AES-GCM 密文对象');
step('store.json 里落的是密文对象', /"alg": "aes-256-gcm"/.test(raw));

const refuseMask = await cliError(['entry', 'update', secret.id, '--set', 'keyValue=sk-x******zzzz']);
step('拒绝把打码串当新密钥写回', refuseMask.error.includes('打码'));

const keepMask = await cliJson(['entry', 'update', secret.id, '--set', 'keyValue=sk-s******cdef', '--set', 'purpose=测试']);
void keepMask;
const keepMaskGet = await cliJson(['entry', 'get', secret.id, '--reveal']);
step('面板原样回传掩码时保留原密文（不把掩码存成新值）', keepMaskGet.values.keyValue === 'sk-smoke-1234567890abcdef');

const dump = await cliJson(['section', 'dump', 'job']);
step('section dump 给全量（字段 + 条目 + 未填清单）', dump.fields.length > 50 && dump.entries.length >= 1 && dump.entries[0].missing.length > 0);

const dryExport = await cliJson(['export', 'run', '--dry-run']);
step('export --dry-run 只报计划', dryExport.status === 'skipped' && dryExport.wouldWrite.files.length === 2);

const exported = await cliJson(['export', 'run', '--out', join(home, 'out')]);
step('export 真写了文件', exported.files.length === 2 && exported.withSecrets === false);
const mdPath = exported.files.find((f) => f.kind === 'md').pathRaw;
const jsonPath = exported.files.find((f) => f.kind === 'json').pathRaw;
const md = await readFile(mdPath, 'utf8');
step('Markdown 导出里凭据是打码的', !md.includes('sk-smoke-1234567890') && md.includes('冒烟测试'));
const jsonExp = await readFile(jsonPath, 'utf8');
step('JSON 导出标了 withSecrets', JSON.parse(jsonExp).withSecrets === false);

const exportList = await cliJson(['export', 'list']);
step('export list 给出历史与目录内文件', exportList.history.length >= 1 && exportList.disk.length === 2);

const skillGet = await cliJson(['skill', 'get', 'nx-sk', '10-sections-entries', '--dry-run']);
step('skill get --json 是四元', skillGet.skillName === 'nx-sk' && skillGet.ref === 'references/10-sections-entries.md'
  && skillGet.contentBytes > 1000 && typeof skillGet.install.status === 'string');

const skillHuman = await cli(['skill', 'get', 'nx-sk', '--dry-run']);
step('skill get 人类模式是三段拼接', skillHuman.out.startsWith('# === nx-sk skill context ===')
  && skillHuman.out.includes('begin skill content') && skillHuman.out.includes('-- install 状态 --'));

const refEscape = await cliError(['skill', 'get', 'nx-sk', '../package.json']);
step('skill get 拒绝路径穿越', refEscape.code === 'INVALID_INPUT');

const routes = await cliJson(['routes']);
step('routes 与 help 覆盖同一批命令', routes.total === boot.counts.commands);
const backRoute = await cliJson(['routes', '--http', 'POST /api/entries']);
step('routes 支持反向查找', backRoute.entries.some((e) => e.command === 'nx-sk entry add'));

const drySection = await cliJson(['section', 'add', 'probe', '--template', 'job', '--dry-run']);
step('section add --dry-run 不落盘', drySection.status === 'skipped' && !(await cliJson(['section', 'list'])).sections.some((s) => s.id === 'probe'));

// ── 2. HTTP + 静态 ───────────────────────────────────────────
process.stdout.write('\n[2] HTTP API 与静态页\n');

const serve = spawn(NODE, [BIN, 'serve', '--no-open', '--json', '--port', '0'], { env, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
const first = await new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error('serve 启动超时')), 15000);
  serve.stdout.on('data', (c) => {
    buf += c;
    const nl = buf.indexOf('\n');
    if (nl >= 0) { clearTimeout(t); resolve(buf.slice(0, nl)); }
  });
  serve.once('exit', (code) => reject(new Error(`serve 提前退出: ${code}`)));
});
const info = JSON.parse(first);
step('serve --json 打出地址', /^http:\/\/127\.0\.0\.1:\d+$/.test(info.url), info.url);

const j = async (path, opts = {}) => {
  const res = await fetch(info.url + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body, contentType: res.headers.get('content-type') || '' };
};

const apiBoot = await j('/api/bootstrap');
step('GET /api/bootstrap', apiBoot.status === 200 && apiBoot.body.ok && apiBoot.body.data.app.name === 'nx-sk');

const apiTemplates = await j('/api/sections/templates');
step('字面量路由不被 :ref 遮蔽（/sections/templates）', apiTemplates.status === 200 && Array.isArray(apiTemplates.body.data.templates));

const apiFields = await j('/api/entries/fields');
step('字面量路由不被 :ref 遮蔽（/entries/fields）', apiFields.status === 200 && Array.isArray(apiFields.body.data.sections));

const apiAdd = await j('/api/entries', { method: 'POST', body: { section: 'job', set: { 姓名: 'HTTP造的数据' } } });
step('POST /api/entries', apiAdd.status === 200 && apiAdd.body.data.created === true);

const apiPatch = await j(`/api/entries/${apiAdd.body.data.id}`, { method: 'PATCH', body: { set: { 目标岗位: '全栈开发' } } });
step('PATCH /api/entries/:ref（PATCH 语义）', apiPatch.status === 200 && apiPatch.body.data.status === 'ok');

const apiBlocked = await j('/api/sections/job', { method: 'DELETE', body: {} });
step('栏目非空删除报 409 blocked', apiBlocked.status === 409 && apiBlocked.body.code === 'BLOCKED');

const apiNotFound = await j('/api/entries/不存在的东西');
step('不存在的条目报 404 NOT_FOUND', apiNotFound.status === 404 && apiNotFound.body.code === 'NOT_FOUND');

const apiUnknown = await j('/api/nope');
step('未知接口报 404', apiUnknown.status === 404 && apiUnknown.body.ok === false);

const apiBadOrigin = await rawRequest(info.url, '/api/entries', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
  body: JSON.stringify({ section: 'job', set: { name: 'x' } }),
});
step('跨站 Origin 的写操作被拒', apiBadOrigin.status === 403, `HTTP ${apiBadOrigin.status}`);

const readOrigin = await rawRequest(info.url, '/api/bootstrap', { headers: { origin: 'http://evil.example' } });
step('跨站 Origin 的读操作仍放行', readOrigin.status === 200);

const localOrigin = await rawRequest(info.url, '/api/entries', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:7866' },
  body: JSON.stringify({ section: 'job', set: { 姓名: '本机面板造的' } }),
});
step('本机 Origin 的写操作放行', localOrigin.status === 200);

const staticRes = await fetch(info.url + '/');
const staticText = await staticRes.text();
if (staticRes.status === 200) {
  step('静态面板可访问', staticText.includes('nx-sk') && staticRes.headers.get('content-type').includes('text/html'));
} else {
  step('未构建时给可操作的提示（503）', staticRes.status === 503 && staticText.includes('vite build'), `HTTP ${staticRes.status}`);
}

const spa = await fetch(info.url + '/whatever/deep/path');
step('SPA 回退到 index.html 或提示', [200, 503].includes(spa.status));

serve.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 300));

// ── 3. 收尾：真删（只删测试自己造的那条） ───────────────────
process.stdout.write('\n[3] 真删与快照\n');
const removed = await cliJson(['entry', 'remove', '冒烟测试']);
step('entry remove 成功', removed.removed.title === '冒烟测试');
step('删除前留了可回滚快照', !!removed.snapshot && removed.snapshot.includes('backup'));

const gone = await cliError(['entry', 'get', '冒烟测试']);
step('删除后 get 报 NOT_FOUND', gone.code === 'NOT_FOUND');

const finalList = await cliJson(['entry', 'list', '--section', 'job']);
const titles = finalList.entries.map((e) => e.title).sort();
step('CLI 与 HTTP 写进的是同一份数据', finalList.count === 2 && titles.join('|') === 'HTTP造的数据|本机面板造的', titles.join(' / '));

process.stdout.write(`\n冒烟通过：${passed} 项断言，全部在临时目录 ${home} 内完成\n`);
