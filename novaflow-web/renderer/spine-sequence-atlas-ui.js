/* Export-only controls. Shared by particle and AI sequence frame panels. */
(function (root) {
  'use strict';
  const key = 'novaflow.sequenceAtlas.settings.v1', components = new WeakMap();
  function readSettings() {
    try { return root.NovaFlowSequenceAtlas.normalizeSettings(JSON.parse(localStorage.getItem(key) || '{}')); }
    catch { return { ...root.NovaFlowSequenceAtlas.defaults }; }
  }
  function controls(React, props) {
    if (!components.has(React)) components.set(React, function Controls({ packed, onPackedChange }) {
      const h = React.createElement, [open, setOpen] = React.useState(false), [draft, setDraft] = React.useState(readSettings), dialog = React.useRef(null);
      React.useEffect(() => {
        if (!open) return;
        const previous = document.activeElement;
        dialog.current?.focus();
        const onKey = event => {
          if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
          if (event.key === 'Tab') {
            const fields = Array.from(dialog.current?.querySelectorAll('button,input,select') || []);
            const first = fields[0], last = fields[fields.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        };
        document.addEventListener('keydown', onKey, true);
        return () => { document.removeEventListener('keydown', onKey, true); previous?.focus?.(); };
      }, [open]);
      const field = (name, value) => setDraft(current => ({ ...current, [name]: value }));
      const toggle = (name, label) => h('label', { className: 'nf-atlas-check', key: name }, h('input', { type: 'checkbox', checked: draft[name], onChange: e => field(name, e.target.checked) }), label);
      const number = (name, label, min, max) => h('label', { className: 'nf-atlas-field', key: name }, label, h('input', { type: 'number', min, max, value: draft[name], onChange: e => field(name, e.target.value) }));
      const dimension = (name, label) => h('label', { className: 'nf-atlas-field' }, label, h('select', { value: draft[name], onChange: e => field(name, Number(e.target.value)) }, ...[1024, 2048, 4096].map(size => h('option', { key: size, value: size }, size))));
      const button = (text, action, primary = false) => h('button', { type: 'button', className: 'nf-atlas-button' + (primary ? ' primary' : ''), onClick: action }, text);
      return h('div', { className: 'nf-atlas-controls', 'data-sequence-atlas': '' },
        h('div', { className: 'nf-atlas-row' }, h('label', { className: 'nf-atlas-check' }, h('input', { type: 'checkbox', checked: packed, onChange: e => onPackedChange(e.target.checked) }), '打包图集'),
          packed && button('打包设置…', () => { setDraft(readSettings()); setOpen(true); })),
        h('p', { className: 'nf-atlas-hint' }, packed ? 'JSON＋atlas＋图集 PNG，可交给对应版本的 Spine 运行时播放。' : 'JSON＋images 序列帧，可导入 Spine 编辑。'),
        open && packed && h('div', { className: 'nf-atlas-overlay', onClick: e => { if (e.target === e.currentTarget) setOpen(false); } },
          h('div', { className: 'nf-atlas-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': '图集打包设置', tabIndex: -1, ref: dialog },
            h('h3', null, '图集打包设置'),
            h('div', { className: 'nf-atlas-grid' }, dimension('maxWidth', '最大宽度'), dimension('maxHeight', '最大高度'), number('paddingX', '横向间距（px）', 0, 32), number('paddingY', '纵向间距（px）', 0, 32), number('alphaThreshold', 'Alpha 阈值', 0, 254)),
            toggle('trim', '去除透明空白'), toggle('duplicatePadding', '边缘复制填充'), toggle('bleed', '透明像素颜色填充'), toggle('premultiplyAlpha', '预乘 Alpha（PMA）'),
            h('p', { className: 'nf-atlas-hint' }, '保留原尺寸、偏移和空白帧。默认阈值 0 保留烟雾柔边。PNG / Linear / ClampToEdge，不旋转；超出容量自动分为多张图集。'),
            h('p', { className: 'nf-atlas-hint' }, 'PMA 需与目标运行时的混合设置一致。'),
            h('div', { className: 'nf-atlas-actions' }, button('恢复默认', () => setDraft({ ...root.NovaFlowSequenceAtlas.defaults })), button('取消', () => setOpen(false)), button('保存', () => {
              const settings = root.NovaFlowSequenceAtlas.normalizeSettings(draft);
              try { localStorage.setItem(key, JSON.stringify(settings)); } catch { alert('无法保存设置，请检查浏览器存储权限'); return; }
              setDraft(settings); setOpen(false);
            }, true))))) ;
    });
    return React.createElement(components.get(React), props);
  }
  root.NovaFlowSequenceAtlasUI = Object.freeze({ controls, readSettings });
})(globalThis);
