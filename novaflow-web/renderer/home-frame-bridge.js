(function (root) {
  'use strict';
  const doc = root.document;
  const logoWithFocusRing = new WeakSet();
  function prepareLogo() {
    const logo = doc.querySelector('.nf-brand img[alt="logo"]');
    if (!logo) return;
    logo.tabIndex = 0;
    logo.setAttribute('role', 'button');
    logo.setAttribute('aria-label', '返回 Foart 首页');
    logo.title = '返回首页';
    if (!logoWithFocusRing.has(logo)) {
      let saved = null;
      logo.addEventListener('focus', () => {
        saved = {outline:logo.style.getPropertyValue('outline'), outlinePriority:logo.style.getPropertyPriority('outline'), offset:logo.style.getPropertyValue('outline-offset'), offsetPriority:logo.style.getPropertyPriority('outline-offset')};
        logo.style.setProperty('outline', '2px solid #9be4cd', 'important');
        logo.style.setProperty('outline-offset', '2px', 'important');
      });
      logo.addEventListener('blur', () => {
        if (!saved) return;
        if (saved.outline) logo.style.setProperty('outline', saved.outline, saved.outlinePriority); else logo.style.removeProperty('outline');
        if (saved.offset) logo.style.setProperty('outline-offset', saved.offset, saved.offsetPriority); else logo.style.removeProperty('outline-offset');
        saved = null;
      });
      logoWithFocusRing.add(logo);
    }
  }
  function prepareBrandControls() {
    if (!doc.getElementById('foart-home-bridge-style')) {
      const style = doc.createElement('style');
      style.id = 'foart-home-bridge-style';
      style.textContent = 'html body .nf-brand img[alt="logo"][role="button"]{cursor:pointer!important}html body .nf-brand img[alt="logo"][role="button"]:focus{outline:2px solid #9be4cd!important;outline-offset:2px}html body .nf-brand[data-novaflow-brand] .nf-brand-version[disabled]{cursor:default!important}';
      (doc.head || doc.documentElement).appendChild(style);
    }
    prepareLogo();
    const version = doc.querySelector('.nf-brand .nf-brand-version');
    if (!version) return;
    // React owns this node. Disable its legacy copy action without replacing it.
    if (version.tagName === 'BUTTON') version.disabled = true;
    version.tabIndex = -1;
    version.setAttribute('role', 'none');
    version.removeAttribute('title');
  }
  function suppressVersionAction(event) {
    if (!event.target?.closest?.('.nf-brand .nf-brand-version')) return;
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
  }
  function returnHome(event) {
    const logo = event.target?.closest?.('.nf-brand img[alt="logo"]');
    if (!logo) return;
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (root.parent !== root) root.parent.postMessage({type:'foart:return-home'}, root.location.origin);
    else if (root.confirm('返回首页将离开当前页面，请先确认已保存作品。继续吗？')) root.location.assign('./');
  }
  doc.addEventListener('click', suppressVersionAction, true);
  doc.addEventListener('keydown', suppressVersionAction, true);
  doc.addEventListener('click', returnHome, true);
  doc.addEventListener('keydown', returnHome, true);
  if (typeof MutationObserver === 'function') new MutationObserver(prepareBrandControls).observe(doc.documentElement, {childList:true,subtree:true});
  prepareBrandControls();
})(window);
