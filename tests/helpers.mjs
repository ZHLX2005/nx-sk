// 测试公共设施：**每个测试文件都必须先把 NX_SK_HOME 指到临时目录**。
// 没有这一步，测试会写脏用户的真实数据（~/nx-sk/store.json）——
// 而且问题不会当场暴露，是在用户发现自己的配置被改乱时才暴露。
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function useTempHome(prefix = 'nx-sk-test-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  process.env.NX_SK_HOME = dir;
  process.env.NX_SK_STORE = join(dir, 'store.json');
  delete process.env.NX_SK_PASSPHRASE;
  return dir;
}

export function projectRoot() {
  return new URL('..', import.meta.url);
}
