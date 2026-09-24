# Changelog

本文件格式参考 [Keep a Changelog](https://keepachangelog.com/)，中文正文。

## [0.1.0] - 2026-09-24

首个版本：本机个人资源管理器（server-cli-web 骨架的完整实现）。

### Added

- **栏目化数据模型**：栏目 = 一组同构条目 + 一份字段字典（字典是数据，不是代码分支）。
  内置两个模板：`job`（求职 / 个人信息，9 分组 75 字段）、`secret`（密钥，8 字段）。
- **CLI**（26 条命令）：`serve` / `help` / `version` 三个平台命令，
  以及 `bootstrap` / `health` / `routes` / `section.*` / `entry.*` / `export.*` / `setting.*` / `skill.*`。
- **HTTP API**：由 action 声明同源编译，路由按「字面量段优先」排序（`/api/sections/templates`
  不会被 `/api/sections/:ref` 遮蔽）。写操作校验 `Origin`。
- **Web 面板**：栏目动态 tab、按分组渲染的字段表单、PATCH 语义保存（只发改动过的字段）、
  密文字段一键揭示、完整度与未填清单、派生式 CLI 提示、页内 toast / dialog / 错误边界。
- **密文存储**：敏感字段 AES-256-GCM 落盘，密钥来源支持 `NX_SK_PASSPHRASE`（scrypt + 盐）
  或本机 `~/.vaultkey`；密文带密钥指纹 `kid`，换来源时给明确的 `BLOCKED` 而不是乱码。
  打码值原样回传会被识别为「不修改」，直接写入打码占位会被拒绝。
- **整体导出**：JSON + Markdown，支持按栏目、指定目录、`--dry-run`；凭据默认打码，
  `--with-secrets` 才出明文并在导出文件里标记 `withSecrets`。
- **快照与回滚**：每次破坏性写入前整库快照到 `~/nx-sk/backup/`（最多 20 份）。
- **损坏保护**：`store.json` 解析失败先改名为 `.corrupt-<时间戳>.json`，不静默覆盖。
- **内置 skill**：`skill install` 装到 `~/.claude/skills`（三态，不静默覆盖），
  `skill get` 输出「prefix → 文档 → install 状态」三段，`--json` 为四元契约。
- **测试**：40 项单测（含一致性断言：模块目录 ↔ 注册表 ↔ 前端视图表 ↔ 视图里的 `/api` 字面量、
  CRUD 五操作与路由形状、CLI 路径可解析回自身、eslint 互依禁列覆盖、文档漂移防护、
  装载期自检的负向反证）+ 56 项端到端冒烟断言。

### Notes

- 数据默认落在 `~/nx-sk/`（骨架 ref 的默认是 `~/.<主题名>/`，本实现按项目要求改成可见目录）。
- 存储路径支持 `NX_SK_HOME` / `NX_SK_STORE` 覆盖 —— **不是可选项**：没有它测试会写脏真实数据。
- eslint 的模块互依禁列是**逐模块枚举**的：新增模块必须补一行，漏补是静默的
  （已由 `tests/unit/consistency.test.mjs` 兜住）。
