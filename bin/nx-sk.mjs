#!/usr/bin/env node
// nx-sk 的唯一可执行入口：只做两件事——转发 argv、兜住未捕获的异常。
// 所有命令分发都在 src/runtime/cli.js（那里才是命令表）。
import { runCli } from '../src/runtime/cli.js';

runCli(process.argv.slice(2)).catch((err) => {
  const message = err && err.message ? err.message : String(err);
  process.stderr.write(`nx-sk: ${message}\n`);
  if (process.env.NX_SK_DEBUG) process.stderr.write(`${err && err.stack}\n`);
  process.exitCode = 1;
});
