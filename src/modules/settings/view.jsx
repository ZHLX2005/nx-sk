import { useCallback, useEffect, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { useStore } from '../../web/frontend/store.jsx';
import { CliHints, Copyable, Empty, Tag } from '../../web/frontend/components/ui.jsx';

export default function SettingsView() {
  const { boot, reload, toast, guard } = useStore();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await api('/api/settings');
      setData(d);
      setForm({ ...d.settings });
    } catch (e) {
      toast(e.message, 'bad');
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const save = guard(async () => {
    const body = {
      exportDir: form.exportDir,
      exportFormat: form.exportFormat,
      includeSecretsInExport: !!form.includeSecretsInExport,
      defaultSection: form.defaultSection,
    };
    const r = await api('/api/settings', { method: 'PATCH', body });
    toast('设置已保存');
    setData({ ...data, settings: r.set });
    await reload();
  });

  if (!data || !form) return <div className="pad muted">加载中…</div>;

  return (
    <>
      <div className="toolbar rowgap pad">
        <strong>设置</strong>
        <span className="muted">本机配置与运行状态</span>
        <span className="grow" />
        <button className="btn small ghost" onClick={load}>重新读取</button>
      </div>

      <div className="card">
        <div className="colhead">存储与运行</div>
        <div className="colbody">
          <InfoRow label="数据目录" value={boot?.home} copy={boot?.home} />
          <InfoRow label="store.json" value={boot?.storePath} copy={boot?.storePathRaw} />
          <InfoRow label="栏目 / 条目" value={boot ? `${boot.counts.sections} / ${boot.counts.entries}` : ''} />
          <InfoRow label="命令条数" value={boot ? String(boot.counts.commands) : ''} />
          <InfoRow label="app / node" value={boot ? `v${boot.app.version} · node ${boot.app.node} · ${boot.app.platform}` : ''} />
          <InfoRow
            label="环境变量覆盖"
            value={boot ? Object.entries(boot.envOverrides).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('　') || '（无）' : ''}
          />
        </div>
      </div>

      <div className="card">
        <div className="colhead">密钥（密文落盘）</div>
        <div className="colbody">
          <InfoRow label="密钥来源" value={boot?.vault?.source === 'env' ? '环境变量 NX_SK_PASSPHRASE（口令不落盘）' : '本机密钥文件'} />
          <InfoRow label="密钥文件" value={boot?.vault?.keyFile || boot?.vault?.saltFile || ''} copy={boot?.vault?.keyFile || boot?.vault?.saltFile} />
          <div className="row">
            <span className="desc">{boot?.vault?.note}</span>
          </div>
          <div className="row">
            <span className="desc bad">删掉密钥文件或换掉口令后，已存的密文都解不开了——导出前先确认密钥可用。</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="colhead">面板与 CLI</div>
        <div className="colbody">
          <div className="row">
            <span className="name">面板地址</span>
            <span className="desc mono">{`http://127.0.0.1:7800`}</span>
            <span className="acts"><Copyable className="mono" text="http://127.0.0.1:7800">复制</Copyable></span>
          </div>
          <div className="row">
            <span className="name">重启面板</span>
            <span className="desc">面板本身就是 serve 提供的；改代码后重启它即可</span>
            <span className="acts"><Copyable className="mono" text="nx-sk serve --port 7800">nx-sk serve --port 7800</Copyable></span>
          </div>
          <div className="row">
            <span className="name">让 agent 学会用</span>
            <span className="desc">装到 ~/.claude/skills，或用 skill get 直接取上下文</span>
            <span className="acts"><Copyable className="mono" text="nx-sk skill install">nx-sk skill install</Copyable></span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="colhead">默认行为</div>
        <div className="pad">
          <div className="grid">
            <div className="field">
              <div className="flabel"><span>默认导出格式</span></div>
              <div className="fctrl">
                <select value={form.exportFormat} onChange={(e) => setForm({ ...form, exportFormat: e.target.value })}>
                  <option value="both">JSON + Markdown</option>
                  <option value="json">仅 JSON</option>
                  <option value="md">仅 Markdown</option>
                </select>
              </div>
            </div>
            <div className="field">
              <div className="flabel"><span>默认导出目录</span><span className="fkey">留空 = ~/nx-sk/export</span></div>
              <div className="fctrl"><input value={form.exportDir} onChange={(e) => setForm({ ...form, exportDir: e.target.value })} /></div>
            </div>
            <div className="field">
              <div className="flabel"><span>默认栏目</span><span className="fkey">CLI 未指定 --section 时的首选</span></div>
              <div className="fctrl"><input value={form.defaultSection} onChange={(e) => setForm({ ...form, defaultSection: e.target.value })} /></div>
            </div>
            <div className="field">
              <div className="flabel"><span>导出默认带明文密钥</span></div>
              <div className="fctrl">
                <label className="inline">
                  <input type="checkbox" checked={!!form.includeSecretsInExport} onChange={(e) => setForm({ ...form, includeSecretsInExport: e.target.checked })} />
                  <span className={form.includeSecretsInExport ? 'bad' : 'muted'}>{form.includeSecretsInExport ? '开（导出的文件会含真实凭据）' : '关（凭据打码）'}</span>
                </label>
              </div>
            </div>
          </div>
          <div className="rowgap" style={{ marginTop: 8 }}>
            <button className="btn" onClick={save}>保存设置</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="colhead">自动快照<span className="right muted">{boot?.snapshots?.length ?? 0}</span></div>
        <div className="colbody">
          <div className="row">
            <span className="desc">每次删除条目 / 栏目、修改设置前，都会在 ~/nx-sk/backup 留一份可回滚的整库快照。</span>
          </div>
          {boot?.snapshots?.length ? boot.snapshots.map((s) => (
            <div key={s.name} className="row">
              <span className="mono name">{s.name}</span>
              <span className="desc">{s.at}</span>
              <span className="acts"><span className="tag">{Math.ceil(s.bytes / 1024)} KB</span></span>
            </div>
          )) : <Empty>还没有快照。</Empty>}
        </div>
      </div>

      {boot?.corrupt ? (
        <div className="card">
          <div className="colhead">上次读取异常</div>
          <div className="colbody">
            <div className="row">
              <span className="desc bad">store.json 解析失败，已挪到 {boot.corrupt.to}（原文件没有被覆盖）</span>
            </div>
          </div>
        </div>
      ) : null}

      <CliHints module="settings" />
    </>
  );
}

function InfoRow({ label, value, copy }) {
  return (
    <div className="row">
      <span className="name">{label}</span>
      <span className="desc mono">{value || '（空）'}</span>
      {copy ? <span className="acts"><Copyable className="mono" text={copy}>复制</Copyable></span> : <Tag> </Tag>}
    </div>
  );
}
