# 30 · 导出与备份

> 归属 `nx-sk` skill 主文档。要「整体导出 / 拿走数据 / 回滚」时读这篇。

## 一、整体导出

```bash
nx-sk export run                                   # 全部栏目 → ~/nx-sk/export/<时间戳>-nx-sk.{json,md}
nx-sk export run --format json                     # 只要 JSON（md | json | both）
nx-sk export run --section job                     # 只导「求职」栏目
nx-sk export run --out D:/备份/nx-sk               # 指定输出目录
nx-sk export run --dry-run                         # 试运行：只告诉你将写哪些文件、多大
nx-sk export run --with-secrets                    # 含密钥**明文**（默认打码）
nx-sk export list                                  # 历次导出 + 输出目录里的文件
```

| 参数 | 说明 |
| --- | --- |
| `--format` | `json` / `md` / `both`，缺省取 `settings.exportFormat` |
| `--section` | 只导一个栏目 |
| `--out` | 输出目录，缺省取 `settings.exportDir`，再缺省 `~/nx-sk/export` |
| `--with-secrets` / `--no-secrets` | 是否含密文字段明文。两个都不给时取 `settings.includeSecretsInExport`（默认 **false**） |
| `--dry-run` | 不写盘 |

导出文件里 `withSecrets` 字段会明确标出这份文件是不是含明文——**分享前先看这个字段**。

JSON 结构（稳定契约，脚本可依赖）：

```json
{
  "app": "nx-sk", "version": "0.1.0", "generatedAt": "…", "storePath": "~/nx-sk/store.json",
  "withSecrets": false,
  "counts": { "sections": 2, "entries": 1 },
  "sections": [ { "id":"job","title":"求职","groups":[…],"fields":[…] } ],
  "entries":  [ { "id":"e_…","section":"job","title":"张三","completeness":{…},"values":{…} } ]
}
```

> 未填字段导出成 `null`（不是空串），方便消费方区分「没填」与「填了空」。

## 二、快照（自动，不用手动）

**每一次破坏性写入之前**都会把整库快照写到 `~/nx-sk/backup/<时间戳>-<原因>.json`：

| 触发点 | 快照名 |
| --- | --- |
| 改设置 | `…-setting-set.json` |
| 加/改/删栏目 | `…-section-add.json` / `…-section-update.json` / `…-section-remove-<id>.json` |
| 改/删条目 | `…-entry-update-<id>.json` / `…-entry-remove-<id>.json` |

最多保留 20 份（自动清理最旧的）。在 `nx-sk bootstrap --json` 的 `snapshots` 字段能看到最近 5 份；
面板的「设置」页有完整列表。

**回滚 = 把那份 JSON 拷回 `store.json`**：

```bash
cp ~/nx-sk/backup/20260924-144238-entry-remove-e_xxx.json ~/nx-sk/store.json
```

快照里含**密文**（不是明文），所以恢复后仍需要同一个密钥才能解——这正是我们要的：
快照本身不是泄露面。

## 三、store.json 的意外保护

如果 `store.json` 解析失败（手工编辑打错了逗号），服务**不会**把它当作空库继续跑并覆盖掉：

1. 先把原文件改名为 `store.json.corrupt-<时间戳>.json`；
2. 再以降级的空结构启动；
3. 面板「设置」页会显示这条提示，`bootstrap --json` 的 `corrupt` 字段也有。

## 四、导出 vs 快照，别搞混

| | 导出（export） | 快照（backup） |
| --- | --- | --- |
| 谁发起 | 用户显式命令 | 系统在每次破坏性写入前自动 |
| 目的 | 带走 / 备份 / 交给别人 | 误操作回滚 |
| 内容 | 结构化 + 可读的 Markdown；密文默认打码 | 原样的整库 JSON（含密文） |
| 位置 | `~/nx-sk/export/`（可改） | `~/nx-sk/backup/`（固定） |
| 回滚用 | 不能直接回滚（形状不同） | 能，拷回 store.json 即可 |
