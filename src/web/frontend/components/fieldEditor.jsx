// 字段编辑器：按字段字典的 type 决定控件。
// 字典来自后端（section.fields），所以**面板能填的字段与 CLI 能填的字段天然一致**。
export function FieldControl({ def, value, onChange, disabled }) {
  const type = def.type || 'text';
  const v = value === null || value === undefined ? '' : value;

  if (type === 'bool') {
    const checked = v === true || v === 'true' || v === '是';
    return (
      <label className="inline">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="muted">{checked ? '是' : '否'}</span>
      </label>
    );
  }

  if (type === 'select') {
    const options = def.options || [];
    const isCustom = v !== '' && !options.includes(v);
    return (
      <select value={isCustom ? '__custom' : String(v)} onChange={(e) => onChange(e.target.value === '__custom' ? '' : e.target.value)}>
        <option value="">（未填写）</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        {isCustom ? <option value="__custom">{String(v)}（当前值，不在候选里）</option> : null}
      </select>
    );
  }

  if (type === 'textarea') {
    return <textarea value={String(v)} onChange={(e) => onChange(e.target.value)} rows={3} />;
  }

  if (type === 'tags') {
    const text = Array.isArray(v) ? v.join('、') : String(v);
    return (
      <input
        value={text}
        placeholder={def.maxItems ? `多个用「、」分隔，最多 ${def.maxItems} 个` : '多个用「、」分隔'}
        onChange={(e) => onChange(e.target.value.split(/[,，、;；]+/).map((x) => x.trim()).filter(Boolean))}
      />
    );
  }

  const inputType = type === 'number' ? 'number' : (type === 'date' ? 'date' : (type === 'month' ? 'month' : 'text'));
  if (type === 'secret') {
    return (
      <input
        type="text"
        value={String(v)}
        placeholder="密文落盘；原样保留占位则视为不修改"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return <input type={inputType} value={String(v)} onChange={(e) => onChange(e.target.value)} />;
}

/** 一整组字段（同一 group）的矩阵。 */
export function FieldGroup({ title, fields, draft, onPatch }) {
  return (
    <>
      <div className="group-title">{title}</div>
      <div className="pad">
        <div className="grid">
          {fields.map((def) => (
            <div key={def.key} className={`field ${def.type === 'textarea' ? 'wide' : ''}`}>
              <div className="flabel">
                <span>{def.label}</span>
                {def.sensitive ? <span className="tag bad">密文</span> : null}
                {/* 填写策略来自后端字段字典；不计入完整度，所以标签用中性色而不是红色——
                    用户是**主动**跳过它，不是出错。 */}
                {def.fill && def.fill !== 'normal' ? <span className="tag">{def.fillLabel || def.fill}</span> : null}
                <span className="fkey">{def.key}</span>
              </div>
              <div className="fctrl">
                <FieldControl def={def} value={draft[def.key]} onChange={(v) => onPatch(def.key, v)} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
