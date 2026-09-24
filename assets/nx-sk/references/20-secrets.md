# 20 · 密钥与密文

> 归属 `nx-sk` skill 主文档。存/读大模型 key、排查「解不开」时读这篇。

## 一、密文机制

- 算法 **AES-256-GCM**（`core/crypto.js`）。每个值独立 IV，带认证标签。
- 落盘的密文对象长这样（**明文绝不进 store.json**）：

```json
{ "v": 1, "alg": "aes-256-gcm", "kid": "9f3a1c07be22", "iv": "…", "tag": "…", "ct": "…" }
```

- `kid` 是**密钥指纹**（密钥 sha256 前 12 位）。用途：换过密钥来源后给出明确报错，
  而不是解出一堆乱码。
- 哪些字段密文落盘由**字段定义**决定：`type === 'secret'` 或 `sensitive: true`。
  默认只有「密钥」栏目的 `keyValue` 字段。

## 二、密钥从哪来（优先级固定）

| 优先级 | 来源 | 行为 |
| --- | --- | --- |
| 1 | 环境变量 `NX_SK_PASSPHRASE` | `scrypt(口令, ~/nx-sk/.vaultsalt)` 派生。**口令不落盘**，盐落盘 |
| 2 | `~/nx-sk/.vaultkey` | 32 字节随机密钥，首次写入密文时自动生成（权限尽力设 0600） |

```bash
# 用口令模式（更安全：口令不进磁盘）
export NX_SK_PASSPHRASE='你的长口令'
nx-sk entry get OpenAI --reveal

# 用本机密钥文件模式（默认，零配置）
nx-sk entry add --section secret --set provider=OpenAI --set keyValue=sk-...
```

**同一份密文只能由同一个密钥解开。** 因此：

- 换了口令 / 删了 `.vaultkey` → 旧密文报 `BLOCKED`「当前密钥与写入时的密钥不一致」。
- 这是**设计如此**，不是 bug。改回去就能解开。
- 所以：**密钥文件要跟数据一起备份**，或者干脆用口令模式并把口令记在别处。

查看当前来源：

```bash
nx-sk bootstrap --json          # vault 字段里有 source / keyFile / saltFile
```

## 三、读密钥

```bash
nx-sk entry list --section secret                 # 列表：值永远是打码的
nx-sk entry get 'OpenAI 主号' --json              # 默认打码：sk-1****cdef
nx-sk entry get 'OpenAI 主号' --json --reveal     # 显式揭示明文
nx-sk section dump secret --reveal                # 整个栏目含明文（谨慎）
```

打码规则：长度 ≤ 10 全部打码；否则前 4 + `******` + 后 4。

**写入时的防呆**：如果你把打码串（含 `******`）当值写回去，命令会报 `INVALID_INPUT` 拒绝执行；
如果值恰好等于当前明文对应的打码串（面板原样回传的常见情况），后端会**保留原密文**而不是把它覆盖掉。

## 四、纪律（写给 agent）

- **绝不**把 `--reveal` 的结果写进日志、注释、提交信息、issue、或任何给第三方的输出。
- **绝不**在没人要求时加 `--reveal`。默认打码是常态，明文是例外。
- 导出时默认也是打码；只有显式 `--with-secrets` 才出明文，而且会在返回里标 `withSecrets: true`。
- 用户想「把密钥同步到云端」——做不到，也别假装能做到。nx-sk 只在本机落盘与本地导出。

## 五、排查「解不开」

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| `BLOCKED 当前密钥与写入时的密钥不一致` | 换了口令，或删了 `.vaultkey` | 改回原来的来源（旧口令 / 恢复密钥文件） |
| `BLOCKED 解密失败：密文已损坏，或密钥不正确` | store.json 被手工改过 / GCM 认证失败 | 用 `~/nx-sk/backup/` 里的快照恢复 |
| `.vaultkey` 不见了 | 被系统清理或误删 | 有口令模式的盐文件 `.vaultsalt` 与口令还能救；否则密文不可逆 |

**密文不可逆是特性，不是缺陷** —— 代价是「忘记密钥 = 数据丢失」，回报是「store.json 泄露不等于凭据泄露」。
