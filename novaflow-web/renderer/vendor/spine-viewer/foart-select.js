// Match Foart's shared dropdown surface inside the isolated viewer document.
(() => {
  const controls = [];
  let opened = null;
  function close(focus = false) {
    if (!opened) return;
    const { button, panel } = opened;
    opened = null; panel.remove(); button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus({ preventScroll: true });
  }
  function enhance(select) {
    const label = select.closest('label')?.querySelector('span')?.textContent || select.id;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'viewer-select-button';
    button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', label);
    const value = document.createElement('span');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<path d="m7 10 5 5 5-5"/>';
    button.append(value, icon); select.after(button); select.hidden = true;
    const sync = () => { value.textContent = select.selectedOptions[0]?.textContent || ''; button.disabled = select.disabled; };
    const open = () => {
      if (button.disabled) return;
      if (opened?.button === button) { close(true); return; }
      close();
      const panel = document.createElement('div'); panel.className = 'viewer-select-panel';
      panel.setAttribute('role', 'listbox'); panel.setAttribute('aria-label', label);
      for (const option of select.options) {
        const item = document.createElement('button'); item.type = 'button'; item.setAttribute('role', 'option');
        item.textContent = option.textContent; item.disabled = option.disabled;
        item.setAttribute('aria-selected', String(option.selected));
        item.addEventListener('click', (event) => {
          event.preventDefault(); select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true })); sync(); close(true);
        });
        panel.appendChild(item);
      }
      document.body.appendChild(panel);
      const rect = button.getBoundingClientRect();
      panel.style.width = `${rect.width}px`; panel.style.left = `${Math.max(4, Math.min(rect.left, innerWidth - rect.width - 4))}px`;
      const height = Math.min(260, panel.scrollHeight);
      panel.style.top = `${rect.bottom + height + 4 > innerHeight && rect.top > height ? rect.top - height - 3 : Math.min(rect.bottom + 3, innerHeight - height - 4)}px`;
      button.setAttribute('aria-expanded', 'true'); opened = { button, panel };
      (panel.querySelector('[aria-selected="true"]') || panel.firstElementChild)?.focus({ preventScroll: true });
      panel.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
      panel.addEventListener('keydown', (event) => {
        const items = [...panel.querySelectorAll('button:not(:disabled)')];
        const index = items.indexOf(document.activeElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        } else if (event.key === 'Escape') { event.preventDefault(); close(true); }
        else if (event.key === 'Tab') close(true);
      });
    };
    button.addEventListener('click', (event) => { event.preventDefault(); open(); });
    button.addEventListener('keydown', (event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); } });
    select.addEventListener('change', sync);
    new MutationObserver(sync).observe(select, { attributes: true, childList: true, subtree: true });
    controls.push(sync); sync();
  }
  document.querySelectorAll('select').forEach(enhance);
  document.addEventListener('pointerdown', (event) => { if (opened && !opened.button.contains(event.target) && !opened.panel.contains(event.target)) close(); });
  document.addEventListener('scroll', (event) => { if (opened && !opened.panel.contains(event.target)) close(); }, true);
  window.addEventListener('resize', () => close());
  window.FoartViewerSelects = { sync: () => controls.forEach((sync) => sync()), close };
})();
