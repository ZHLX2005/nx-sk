import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { useStore } from '../../web/frontend/store.jsx';
import { CliHints, Empty, Modal, Tag } from '../../web/frontend/components/ui.jsx';
import { FieldGroup } from '../../web/frontend/components/fieldEditor.jsx';

const norm = (x) => (x === null || x === undefined ? '' : (Array.isArray(x) ? x.join('、') : String(x)));

/**
 * 栏目详情视图：**一个视图服务所有栏目**（求职 / 密钥 / 以后新加的）。
 * 字段与分组全部来自后端的字段字典，所以新增字段不需要改前端。
 */
export default function SectionView({ sectionId }) {
  const { ui, patchUi, toast, guard, dialog, reload } = useStore();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [modal, setModal] = useState(null);
  const reveal = !!ui.reveal;

  const load = useCallback(async (keepId) => {
    setBusy(true);
    setErr(null);
    try {
      const d = await api(`/api/sections/${encodeURIComponent(sectionId)}/dump${reveal ? '?reveal=1' : ''}`);
      setData(d);
      const wanted = keepId || ui.entry;
      const hit = d.entries.find((e) => e.id === wanted) || d.entries[0] || null;
      setDraft(hit ? { id: hit.id, title: hit.title, values: { ...hit.values } } : null);
      if (hit && hit.id !== ui.entry) patchUi({ entry: hit.id });
    } catch (e) {
      setErr(e.message);
      setData(null);
      setDraft(null);
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId, reveal]);

  useEffect(() => { load(); }, [load]);

  const current = useMemo(() => data?.entries.find((e) => e.id === draft?.id) || null, [data, draft]);
  const groups = useMemo(() => {
    if (!data) return [];
    return data.groups.map((g) => ({ ...g, fields: data.fields.filter((f) => f.group === g.id) })).filter((g) => g.fields.length);
  }, [data]);

  const patchField = (key, value) => setDraft((d) => (d ? { ...d, values: { ...d.values, [key]: value } } : d));

  const dirty = useMemo(() => {
    if (!draft || !current) return { set: {}, titleChanged: false, count: 0 };
    const set = {};
    for (const f of data.fields) {
      if (norm(current.values[f.key]) !== norm(draft.values[f.key])) set[f.key] = draft.values[f.key];
    }
    return { set, titleChanged: draft.title !== current.title, count: Object.keys(set).length + (draft.title !== current.title ? 1 : 0) };
  }, [draft, current, data]);

  const save = guard(async () => {
    if (!draft || !current) return;
    if (!dirty.count) { toast('没有改动'); return; }
    const body = { set: dirty.set };
    if (dirty.titleChanged) body.title = draft.title;
    await api(`/api/entries/${encodeURIComponent(draft.id)}`, { method: 'PATCH', body });
    toast(`已保存 ${dirty.count} 处改动`);
    await load(draft.id);
    await reload();
  });

  const addEntry = guard(async () => {
    const label = data?.section.titleLabel || '名称';
    const name = await dialog({ message: `新建「${data?.section.title}」条目，${label}是？`, input: { placeholder: `例如 ${data?.section.titleField || '名称'}` } });
    if (!name) return;
    const body = { section: sectionId, title: name };
    if (data?.section.titleField) body.set = { [data.section.titleField]: name };
    const created = await api('/api/entries', { method: 'POST', body });
    toast(`已新建：${created.title}`);
    await load(created.id);
    await reload();
  });

  const removeEntry = guard(async () => {
    if (!current) return;
    const ok = await dialog({
      message: `删除条目「${current.title}」？删除前会自动留一份快照在 ~/nx-sk/backup。`,
      danger: true,
      confirmText: '删除',
    });
    if (!ok) return;
    await api(`/api/entries/${encodeURIComponent(current.id)}`, { method: 'DELETE' });
    toast('已删除');
    await load('');
    await reload();
  });

  const exportSection = guard(async () => {
    const r = await api('/api/export', { method: 'POST', body: { section: sectionId, format: 'both' } });
    setModal({
      title: '导出结果',
      body: <pre className="block">{`目录: ${r.dir}\n格式: ${r.format}\n条目: ${r.entries}\n凭据: ${r.withSecrets ? '含明文' : '已打码'}\n\n${r.files.map((f) => `${f.path}  ${f.bytes} 字节`).join('\n')}`}</pre>,
    });
  });

  if (err) {
    return (
      <div className="pad stack">
        <div className="bad"><strong>栏目读不到</strong></div>
        <pre className="block">{err}</pre>
        <div className="hint">如果这个栏目刚被删掉，切到「栏目」tab 看看现有栏目。</div>
      </div>
    );
  }
  if (!data) return <div className="pad muted">{busy ? '加载中…' : '暂无数据'}</div>;

  return (
    <>
      <div className="toolbar rowgap pad">
        <strong>{data.section.title}</strong>
        <Tag>{data.section.id}</Tag>
        <span className="muted">{data.count} 条 / {data.section.fields} 字段</span>
        {data.section.description ? <span className="desc muted nowrap grow">{data.section.description}</span> : <span className="grow" />}
        <label className="inline hint">
          <input type="checkbox" checked={reveal} onChange={() => patchUi({ reveal: !reveal })} />
          显示密文字段明文
        </label>
        <button className="btn small ghost" onClick={() => load()}>刷新</button>
        <button className="btn small ghost" onClick={exportSection}>导出本栏目</button>
        <button className="btn small" onClick={addEntry}>新建条目</button>
      </div>

      <div className="cols">
        <div className="col" style={{ flex: '0 0 300px' }}>
          <div className="card">
            <div className="colhead">条目列表<span className="right muted">{data.count}</span></div>
            <div className="colbody">
              {data.entries.length ? data.entries.map((e) => (
                <div
                  key={e.id}
                  className={`row selectable ${e.id === draft?.id ? 'selected' : ''}`}
                  onClick={() => { patchUi({ entry: e.id }); setDraft({ id: e.id, title: e.title, values: { ...e.values } }); }}
                >
                  <span className="name">{e.title || '（无名）'}</span>
                  <span className="acts">
                    {e.missing.length ? <span className="tag">{e.completeness.ratio}%</span> : <span className="tag strong">已填满</span>}
                  </span>
                </div>
              )) : <Empty>还没有条目。点右上角「新建条目」，或用 CLI：nx-sk entry add --section {data.section.id} --set ...</Empty>}
            </div>
          </div>
        </div>

        <div className="col">
          {!draft ? (
            <div className="card"><Empty>左边选一条，或新建一条</Empty></div>
          ) : (
            <div className="card">
              <div className="colhead">
                <span className="grow nowrap">{current?.title || draft.title}</span>
                <span className="muted mono">{draft.id}</span>
                {current ? <Tag kind={current.missing.length ? '' : 'strong'}>完整度 {current.completeness.ratio}%</Tag> : null}
              </div>

              <div className="field wide pad" style={{ borderBottom: '1px solid var(--soft-2)' }}>
                <div className="flabel">
                  <span>{data.section.titleLabel || '名称'}</span>
                  <span className="bad">改动后必须保存</span>
                </div>
                <div className="fctrl">
                  <input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
                </div>
              </div>

              {groups.map((g) => (
                <FieldGroup key={g.id} title={g.title} fields={g.fields} draft={draft.values} onPatch={patchField} />
              ))}

              <div className="rowgap pad">
                <button className="btn" onClick={save} disabled={!dirty.count}>保存{dirty.count ? `（${dirty.count} 处改动）` : ''}</button>
                <button className="btn ghost" onClick={() => load(draft.id)} disabled={!dirty.count}>放弃改动</button>
                <button className="btn ghost" onClick={removeEntry}>删除条目</button>
                {current?.missing.length ? (
                  <span className="hint after">未填 {current.missing.length} 项：{current.missing.slice(0, 5).map((m) => m.label).join('、')}{current.missing.length > 5 ? '…' : ''}</span>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>

      <CliHints module="entries" />

      {modal ? (
        <Modal title={modal.title} onClose={() => setModal(null)}>
          {modal.body}
        </Modal>
      ) : null}
    </>
  );
}
