# 10 · 栏目与条目

> 归属 `nx-sk` skill 主文档。**动手填/改信息时读这篇。**

## 一、数据模型

```
store.json（~/nx-sk/store.json 或 $NX_SK_STORE）
├─ settings                 全局配置（见 30-export-backup）
├─ sections[]               栏目：id / title / order / template / titleField / groups[] / fields[]
└─ entries[]                条目：id(e_xxx) / section / title / tags[] / values{字段key: 值} / 时间戳
```

- 一个**栏目** = 一组同构条目 + 一份字段字典（`groups[]` 分组、`fields[]` 字段定义）。
- 一个**条目** = 一行数据，值放在 `values` 里，键是字段 `key`。
- 定位方式都放宽：栏目与条目**都接受 id 或名字**。条目名重名时报 `CONFLICT` 让你改用 id。

## 二、栏目命令（集合资源，五操作齐备）

| 操作 | 命令 | 接口 |
| --- | --- | --- |
| 列表 | `nx-sk section list` | `GET /api/sections` |
| 单条 | `nx-sk section get <id或标题>` | `GET /api/sections/:ref` |
| 新增 | `nx-sk section add <id> --title <标题> --template job` | `POST /api/sections` |
| 修改 | `nx-sk section update <id> [--title …] [--add-field '{…}'] [--remove-field a,b]` | `PATCH /api/sections/:ref` |
| 删除 | `nx-sk section remove <id> [--force]` | `DELETE /api/sections/:ref` |
| **全量** | `nx-sk section dump <id> [--reveal]` | `GET /api/sections/:ref/dump` |
| 模板 | `nx-sk section templates` | `GET /api/sections/templates` |

- **`remove` 在栏目非空时会被 `blocked` 挡住**（除非 `--force`）——防止一键抹掉全部档案。
- `remove` 目标不存在时**报 `NOT_FOUND`**（不静默成功），就是为了让「打错一个字」当场暴露。
- `dump` 是「快速获得一个栏目的全部信息」的正解：字段字典 + 全部条目 + 每个条目的完整度与**未填清单**。

内置模板：`job`（求职 / 个人信息，约 70 字段 / 9 分组）、`secret`（密钥，**单字段 KV**——细节见 `20-secrets`）。

## 三、条目命令

| 操作 | 命令 | 接口 |
| --- | --- | --- |
| 列表 | `nx-sk entry list [--section job] [--q 关键字]` | `GET /api/entries` |
| 字段字典 | `nx-sk entry fields [--section job]` | `GET /api/entries/fields` |
| 单条 | `nx-sk entry get <id或名字> [--reveal] [--section job]` | `GET /api/entries/:ref` |
| 新增 | `nx-sk entry add --section job --set 姓名=张三 [--set 电话=…]` | `POST /api/entries` |
| 修改 | `nx-sk entry update <ref> --set 期望城市=北京、上海 [--unset 微信]` | `PATCH /api/entries/:ref` |
| 删除 | `nx-sk entry remove <ref>` | `DELETE /api/entries/:ref` |

### 参数要点

| 参数 | 说明 |
| --- | --- |
| `--set 字段=值` | 可重复。键**可用字段 key 或中文标签**。值按字段 type 强转（bool 认`是/否/true/false`；tags 用 `、` 或 `,` 分隔；number 认数字串） |
| `--data <json>` / `--data @file.json` | 一次写多字段。`--data` 优先被 `--set` 覆盖 |
| `--unset a,b` | 清空若干字段（**这才是清空的正确姿势**，不是 `--set a=`） |
| （已取消）`--allow-new-field` | 现在**默认就是自动登记**，不必再带这个 flag |
| `--title` | 条目名。不传则取栏目的 `titleField`（求职栏目是 `name`/姓名） |
| `--dry-run` | 试运行：返回 `wouldCreate` / `wouldChange`，不落盘 |
| `--reveal` | 读命令专用：显示密文字段明文 |

### 三个容易踩的坑

1. **`--set 字段=`（空值）等于清空，与 `--unset` 等效**；但把**打码后的值**（含 `******`）写回去会被拒绝——那通常意味着「不修改」，什么都不传即可。
2. **`entry add` 同栏目同名直接报 `CONFLICT`**，不会静默再插一条。要改就用 `entry update`。
3. **`--section` 是栏目过滤，不是条目参数**。`entry update` 的 `--section` 只用来消歧同名条目。

## 四、AI 补全个人信息的推荐流程（本 skill 的主场景）

```bash
# ① 看现在有什么、缺什么
nx-sk section dump job --json
#    → entries[].missing[] 就是「还差哪些字段」的清单

# ② 看字段字典（key / label / type / options / hint），别猜字段名
nx-sk entry fields --section job --json

# ③ 批量补：先试运行，确认后再落盘
nx-sk entry update 张三 --data @补全.json --dry-run
nx-sk entry update 张三 --data @补全.json
#    补全.json 形如：{"身份证号":"…","英语等级":"CET-4","期望城市":["北京"]}

# ④ 复核
nx-sk entry get 张三 --json
```

**纪律**：

- 只写用户提供或已确认的值。不确定的字段**留空**，不要编造。
- 身份证号、手机号、紧急联系人电话这类字段，写之前跟用户确认一次来源。
- 每次批量写之前先 `--dry-run`。

## 五、扩字段字典（不写代码）

**最省事的做法：直接写。** 字典里没有的键会自动登记（键名就是它本身），类型按值推断
（`是/否` → bool，数组 → tags，其余 → text）。

```bash
nx-sk entry update 张三 --set 期望行业=互联网 --set 技术博客=https://example.com
```

**刻意不推 number**：18 位身份证号这类长数字超过 2^53，推成数字会静默丢精度。

需要给字段配上候选值 / 提示文案 / 密文标记时，再显式声明：

```bash
nx-sk section update job --add-field '{"key":"blog","label":"技术博客","type":"text","group":"contact","hint":"URL"}'

# 删字段：只影响台账，已填的值留在条目里（不再显示 ≠ 删掉）
nx-sk section update job --remove-field blog

# 整体替换字典（少数场景）
nx-sk section update job --fields @fields.json
```

字段定义支持：`key`（字母开头）、`label`、`type`（`text|textarea|number|date|month|bool|select|tags|secret`）、
`group`、`hint`、`options`（候选项）、`sensitive`（true 则密文落盘）、`maxItems`（tags 上限）。

> `select` 的 `options` 是**候选项不是白名单**：真实值（如某个少数民族）不在候选里也允许写入。

## 六、Web 面板

`nx-sk serve` → 每个栏目一个 tab，共用同一个条目视图：

- 左侧条目列表（带完整度），右侧按分组渲染的字段表单；
- 「显示密文字段明文」勾选控制 `--reveal` 等价行为（选择持久化在 localStorage）；
- 保存是 **PATCH**：只有被你改动过的字段才会发出去（面板会显示「N 处改动」）；
- 每个页面底部会派生显示该模块的 CLI 等价命令（可点击复制）。

面板上没有 CLI 做不到的事——两边共享同一套 action 声明。
