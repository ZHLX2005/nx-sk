import { useCallback, useEffect, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { useStore } from '../../web/frontend/store.jsx';
import { CliHints, Copyable, Empty, Modal, Tag } from '../../web/frontend/components/ui.jsx';

export default function SkillView() {
  const { toast, guard } = useStore();
  const [data, setData] = useState(null);
  const [to, setTo] = useState('');
  const [force, setForce] = useState(false);
  const [modal, setModal] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api('/api/skills'));
    } catch (e) {
      toast(e.message, 'bad');
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const install = guard(async () => {
    const r = await api('/api/skills/install', { method: 'POST', body: { to: to.trim() || undefined, force } });
    setModal({ title: '安装结果', body: <pre className="block">{JSON.stringify(r, null, 2)}</pre> });
    toast(r.status === 'conflict' ? '目标已存在且内容不同' : '安装完成', r.status === 'conflict' ? 'bad' : 'ok');
  });

  const get = guard(async (name, ref) => {
    const r = await api('/api/skills/get', { method: 'POST', body: { name, ref } });
    setModal({
      title: `${r.skillName} · ${r.ref}（${r.contentBytes} 字节）`,
      body: (
        <div className="stack">
          <div className="rowgap">
            <Copyable className="btn small ghost" text={r.content}>复制全文</Copyable>
            <span className="hint">install 状态：{r.install.status}{r.install.path ? ` · ${r.install.path}` : ''}</span>
          </div>
          <pre className="block">{r.content}</pre>
        </div>
      ),
    });
  });

  if (!data) return <div className="pad muted">加载中…</div>;

  return (
    <>
      <div className="toolbar rowgap pad">
        <strong>Skill</strong>
        <span className="muted">让 agent 学会用 nx-sk：装到本机 skill 目录，或直接取上下文塞给外部 agent</span>
        <span className="grow" />
        <button className="btn small ghost" onClick={load}>刷新</button>
      </div>

      <div className="card">
        <div className="colhead">内置 skill<span className="right muted">{data.count}</span></div>
        <div className="colbody">
          {data.skills.length ? data.skills.map((s) => (
            <div key={s.name}>
              <div className="row">
                <span className="name">{s.name}</span>
                <Tag>{s.files} 个文件</Tag>
                {s.hasSkillMd ? <Tag kind="strong">SKILL.md</Tag> : <Tag kind="bad">缺 SKILL.md</Tag>}
                <span className="desc mono">{s.assetsPath}</span>
                <span className="acts">
                  <button className="btn small ghost" onClick={() => get(s.name, '')}>取 SKILL.md</button>
                </span>
              </div>
              {s.refs.length ? s.refs.map((r) => (
                <div key={r} className="row" style={{ paddingLeft: 30 }}>
                  <span className="desc mono">references/{r}.md</span>
                  <span className="acts">
                    <button className="btn small ghost" onClick={() => get(s.name, `references/${r}.md`)}>取这篇</button>
                  </span>
                </div>
              )) : <div className="row" style={{ paddingLeft: 30 }}><span className="desc">（没有 references）</span></div>}
            </div>
          )) : <Empty>assets/ 下没有内置 skill。</Empty>}
        </div>
      </div>

      <div className="card">
        <div className="colhead">装到本机（让本骨架的 agent 学得会用）</div>
        <div className="pad">
          <div className="grid">
            <div className="field">
              <div className="flabel"><span>目标目录</span><span className="fkey">留空 = {data.defaultTarget}</span></div>
              <div className="fctrl"><input value={to} onChange={(e) => setTo(e.target.value)} placeholder={data.defaultTarget} /></div>
            </div>
            <div className="field">
              <div className="flabel"><span>冲突时覆盖</span><span className="fkey">目标存在且内容不同时才会用到</span></div>
              <div className="fctrl">
                <label className="inline">
                  <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                  <span className="muted">--force（不勾选则返回冲突状态，不静默覆盖）</span>
                </label>
              </div>
            </div>
          </div>
          <div className="rowgap" style={{ marginTop: 8 }}>
            <button className="btn" onClick={install}>安装内置 skill</button>
            <span className="hint">三态：安装 / 已是最新（跳过）/ 冲突。冲突退出码仍是 0 —— 那是业务结果，不是失败。</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="colhead">给外部 agent 取上下文</div>
        <div className="colbody">
          <div className="row">
            <span className="desc">`skill get` 输出三段：prefix 引导 → 文档全文 → install 状态。`--json` 时只输出 <code className="cli-cmd">{'{skillName, ref, content, contentBytes, install}'}</code>。</span>
          </div>
          <div className="row">
            <span className="name">命令行</span>
            <span className="desc" />
            <span className="acts">
              <Copyable className="mono" text="nx-sk skill get --json">nx-sk skill get --json</Copyable>
              <Copyable className="mono" text="nx-sk skill get nx-sk references/栏目与条目.md">取指定 ref</Copyable>
            </span>
          </div>
        </div>
      </div>

      <CliHints module="skill" />

      {modal ? <Modal title={modal.title} onClose={() => setModal(null)}>{modal.body}</Modal> : null}
    </>
  );
}
