/* Board animation names are project data; numeric labels remain navigation IDs. */
(function (root) {
  'use strict';
  const storageKey = 'novaflow.aiSequence.boardNames.v1';
  const projectKey = 'aiSequenceBoardNames';
  const components = new WeakMap();
  const fingerprints = new Map();
  const fallbackName = index => `animation_${index + 1}`;
  const limit = value => Array.from(value).slice(0, 80).join('');
  function cleanName(value) {
    let name = String(value ?? '').normalize('NFC').trim()
      .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_')
      .replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
    name = limit(name).replace(/[. ]+$/g, '');
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || /^(?:__proto__|constructor|prototype)$/i.test(name)) name = limit('_' + name);
    return name;
  }
  const comparisonKey = name => cleanName(name).toLowerCase();
  function uniqueName(value, usedNames, fallback = 'animation_1') {
    const base = cleanName(value) || cleanName(fallback) || 'animation_1';
    const used = new Set(Array.from(usedNames || [], comparisonKey));
    let name = base;
    for (let suffix = 2; used.has(comparisonKey(name)); suffix++) {
      const tail = `_${suffix}`;
      name = Array.from(base).slice(0, 80 - tail.length).join('').replace(/[. ]+$/g, '') + tail;
    }
    return name;
  }
  function normalizeBoards(boards) {
    const names = [];
    return (Array.isArray(boards) ? boards : []).map((board, index) => {
      const animationName = uniqueName(board?.animationName, names, fallbackName(index));
      names.push(animationName);
      return board?.animationName === animationName ? board : { ...board, animationName };
    });
  }
  function renameBoard(boards, id, value) {
    const current = normalizeBoards(boards), index = current.findIndex(board => board.id === id);
    if (index < 0) return current;
    const name = uniqueName(value, current.filter(board => board.id !== id).map(board => board.animationName), current[index].animationName);
    return current.map(board => board.id === id && board.animationName !== name ? { ...board, animationName: name } : board);
  }
  function duplicateBoard(boards, id, newId) {
    const current = normalizeBoards(boards), source = current.find(board => board.id === id);
    if (!source) throw new Error('找不到要复制的画板');
    if (!newId || current.some(board => board.id === newId)) throw new Error('复制画板需要新的画板 ID');
    const animationName = uniqueName(source.animationName, current.map(board => board.animationName));
    // The media is shared like an ordinary board switch; do not revoke its URL.
    return [...current, { ...source, id: newId, label: String(current.length + 1), animationName }];
  }
  function snapshot(boards, activeBoardId) {
    const current = normalizeBoards(boards);
    return {
      version: 1,
      activeBoardId: current.some(board => board.id === activeBoardId) ? activeBoardId : current[0]?.id || '',
      boards: current.map(board => ({ id: board.id, animationName: board.animationName }))
    };
  }
  function restoreNames(boards, saved) {
    if (!saved || saved.version !== 1 || !Array.isArray(saved.boards)) return normalizeBoards(boards);
    const byId = new Map(saved.boards.filter(board => board && typeof board.id === 'string').map(board => [board.id, board.animationName]));
    return normalizeBoards((Array.isArray(boards) ? boards : []).map(board => byId.has(board.id) ? { ...board, animationName: byId.get(board.id) } : board));
  }
  function withProjectNames(project, boards, activeBoardId) {
    if (!project || typeof project !== 'object' || Array.isArray(project)) throw new Error('无效的项目文件');
    return { ...project, [projectKey]: snapshot(boards, activeBoardId) };
  }
  function restoreProjectNames(project, boards) {
    const saved = project?.[projectKey], current = restoreNames(boards, saved);
    return { boards: current, activeBoardId: current.some(board => board.id === saved?.activeBoardId) ? saved.activeBoardId : current[0]?.id || '' };
  }
  const sourceRef = board => String(board?.loadedVideo?.objectUrl || board?.canvasImage?.dataUrl || '');
  async function fingerprint(board) {
    const source = sourceRef(board);
    if (!source || !root.crypto?.subtle || !root.fetch) return '';
    if (!fingerprints.has(source)) {
      const pending = (async () => {
        try {
          const response = await root.fetch(source);
          if (!response.ok) return '';
          const digest = await root.crypto.subtle.digest('SHA-256', await response.arrayBuffer());
          return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        } catch { return ''; }
      })();
      fingerprints.set(source, pending);
      if (fingerprints.size > 128) fingerprints.delete(fingerprints.keys().next().value);
    }
    return fingerprints.get(source);
  }
  async function saveNames(boards, activeBoardId, storage = root.localStorage) {
    const records = await Promise.all((Array.isArray(boards) ? boards : []).filter(board => cleanName(board?.animationName)).map(async board => ({
      id: board.id, animationName: cleanName(board.animationName), fingerprint: await fingerprint(board)
    })));
    const valid = records.filter(board => board.fingerprint);
    if (!valid.length) return false;
    try {
      const previous = readNames(storage)?.boards || [], bySource = new Map(previous.filter(board => /^[a-f0-9]{64}$/.test(board.fingerprint || '')).map(board => [`${board.id}:${board.fingerprint}`, board]));
      for (const board of valid) { const key = `${board.id}:${board.fingerprint}`; bySource.delete(key); bySource.set(key, board); }
      storage.setItem(storageKey, JSON.stringify({ version: 1, activeBoardId, boards: [...bySource.values()].slice(-128) }));
      return true;
    } catch { return false; }
  }
  function readNames(storage = root.localStorage) {
    try {
      const saved = JSON.parse(storage.getItem(storageKey) || 'null');
      return saved?.version === 1 && Array.isArray(saved.boards) ? saved : null;
    } catch { return null; }
  }
  async function restoreSavedNames(boards, storage = root.localStorage) {
    const saved = readNames(storage);
    if (!saved) return boards;
    const recovered = await Promise.all(boards.map(async board => {
      if (cleanName(board.animationName)) return board;
      const digest = await fingerprint(board);
      if (!digest) return board;
      const record = saved.boards.find(entry => entry?.id === board.id && entry.fingerprint === digest);
      return record && cleanName(record.animationName) ? { ...board, animationName: record.animationName } : board;
    }));
    return recovered.some((board, index) => board !== boards[index]) ? normalizeBoards(recovered) : boards;
  }
  function usePersistence(React, boards, setBoards, activeBoardId) {
    const sources = JSON.stringify(boards.map(board => [board.id, sourceRef(board)]));
    const names = JSON.stringify(boards.map(board => [board.id, board.animationName, sourceRef(board)]));
    React.useEffect(() => {
      let canceled = false;
      restoreSavedNames(boards).then(recovered => {
        if (canceled || recovered === boards) return;
        setBoards(current => normalizeBoards(current.map(board => {
          const index = boards.findIndex(entry => entry.id === board.id);
          return index >= 0 && sourceRef(board) === sourceRef(boards[index]) && board.animationName === boards[index].animationName ? { ...board, animationName: recovered[index].animationName } : board;
        })));
      }).catch(() => {});
      return () => { canceled = true; };
    }, [sources]);
    React.useEffect(() => { saveNames(boards, activeBoardId).catch(() => {}); }, [names]);
  }
  function exportNames(boards, baseName = 'NF') {
    const current = Array.isArray(boards) && boards.length ? boards : [{}];
    const names = [];
    const result = current.map((board, index) => {
      const explicitName = cleanName(board?.animationName);
      const animationName = uniqueName(explicitName, names, fallbackName(index));
      names.push(animationName);
      // Unnamed old boards keep the original frame paths; named boards use the
      // same safe value for the Spine animation key and their image prefix.
      return { id: board?.id, animationName, explicitName };
    });
    const prefixes = result.filter(board => board.explicitName).map(board => board.animationName);
    return result.map((board, index) => {
      const regionPrefix = board.explicitName ? board.animationName : uniqueName(current.length > 1 ? `${baseName}_${index + 1}` : baseName, prefixes);
      if (!board.explicitName) prefixes.push(regionPrefix);
      return { id: board.id, animationName: board.animationName, regionPrefix };
    });
  }
  function controls(React, props) {
    if (!components.has(React)) components.set(React, function BoardNameControls({ boards, activeBoardId, onRename, disabled = false }) {
      const h = React.createElement, index = boards.findIndex(board => board.id === activeBoardId);
      const value = cleanName(boards[index]?.animationName) || fallbackName(Math.max(0, index));
      const [draft, setDraft] = React.useState(value), canceled = React.useRef(false);
      React.useEffect(() => { setDraft(value); canceled.current = false; }, [activeBoardId, value]);
      const commit = () => {
        if (canceled.current) { canceled.current = false; return; }
        const name = uniqueName(draft, boards.filter(board => board.id !== activeBoardId).map(board => board.animationName), value);
        setDraft(name); onRename(activeBoardId, name);
      };
      return h('span', { 'data-novaflow-ai-board-names': '1', style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
        h('input', { key: activeBoardId, 'data-novaflow-ai-board-name': '1', 'aria-label': '当前画板动画名', title: '动画名（Enter 或移开焦点保存，Esc 取消）',
          type: 'text', value: draft, disabled, maxLength: 160,
          style: { width: 116, height: 28, minWidth: 80, padding: '0 6px', border: '1px solid #444', borderRadius: 5, background: '#242424', color: '#eaeaea', fontSize: 11 },
          onFocus: () => { canceled.current = false; }, onChange: event => setDraft(event.target.value), onBlur: commit,
          onKeyDown: event => {
            if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); canceled.current = true; setDraft(value); event.currentTarget.blur(); }
          } }));
    });
    return React.createElement(components.get(React), props);
  }
  root.NovaFlowAiSequenceBoardNames = Object.freeze({ cleanName, uniqueName, normalizeBoards, renameBoard, duplicateBoard, snapshot, restoreNames,
    withProjectNames, restoreProjectNames, saveNames, readNames, restoreSavedNames, fingerprint, usePersistence, exportNames, controls, storageKey, projectKey });
})(globalThis);
