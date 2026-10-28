(function (global) {
  'use strict';
  const allowedStatuses = new Set(['unconfigured', 'idle', 'checking', 'current', 'available', 'downloading', 'ready', 'error']);
  const icons = {
    update: '<path d="M20 7v5h-5M5 8a8 8 0 0 1 13-2l2 3M4 17v-5h5m10 4a8 8 0 0 1-13 2l-2-3"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    arrow: '<path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>',
    github: '<path d="M9 19c-5 1-5-3-7-3m14 6v-4a4 4 0 0 0-1-3c4-.5 7-2 7-6a5 5 0 0 0-1-3 5 5 0 0 0 0-4s-1 0-4 2a13 13 0 0 0-7 0C7 2 6 2 6 2a5 5 0 0 0 0 4 5 5 0 0 0-1 3c0 4 3 5.5 7 6a4 4 0 0 0-1 3v4"/>'
  };
  function svg(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + '</svg>'; }
  function normalize(input, product) {
    const source = input && typeof input === 'object' ? input : {};
    return {
      product: source.product || product,
      currentVersion: String(source.currentVersion || '1.0.0'),
      latestVersion: source.latestVersion ? String(source.latestVersion) : '',
      status: allowedStatuses.has(source.status) ? source.status : 'unconfigured',
      progress: typeof source.progress === 'number' && Number.isFinite(source.progress) ? Math.max(0, Math.min(100, source.progress)) : null,
      message: typeof source.message === 'string' ? source.message : '',
      notes: Array.isArray(source.notes) ? source.notes.map(String).join('\n') : typeof source.notes === 'string' ? source.notes : '',
      repository: typeof source.repository === 'string' ? source.repository : '',
      supportEmail: 'ra107696@gmail.com',
      autoPrompt: source.autoPrompt === true
    };
  }
  function validRepository(value) { return /^https:\/\/github\.com\/[^/\s?#]+\/[^/\s?#]+\/?$/i.test(value); }
  function create(options) {
    if (!options || typeof options.send !== 'function') throw new TypeError('Updates requires a send callback.');
    const send = options.send;
    const product = options.product === 'student' ? 'student' : 'teacher';
    const productName = product === 'student' ? 'Студент — Код будущего' : 'Код будущего';
    let state = normalize(null, product), opened = false, popup = false, pending = null, retryTimer = 0, promptedVersion = '', previousFocus = null, disposed = false;
    const overlay = document.createElement('div');
    overlay.className = 'cfu-overlay';
    overlay.dataset.cfuProduct = product;
    overlay.hidden = true;
    overlay.innerHTML = '<section class="cfu-panel" role="dialog" aria-modal="true" aria-labelledby="cfu-heading-' + product + '">' +
      '<header class="cfu-header"><div><span class="cfu-eyebrow">ОБНОВЛЕНИЯ</span><p class="cfu-product" data-cfu="product"></p></div><button class="cfu-close" data-cfu="close" type="button" aria-label="Закрыть обновления" title="Закрыть">' + svg('close') + '</button></header>' +
      '<div class="cfu-hero"><div class="cfu-orbit" data-cfu="orbit" aria-hidden="true"><svg class="cfu-ring" viewBox="0 0 100 100"><circle class="cfu-ring-track" cx="50" cy="50" r="44"/><circle class="cfu-ring-progress" data-cfu="ring" cx="50" cy="50" r="44"/></svg><div class="cfu-orb"></div><span class="cfu-center" data-cfu="center"></span><svg class="cfu-check" viewBox="0 0 36 36"><path d="m9 18 6 6 13-13"/></svg></div>' +
      '<div class="cfu-heading-group"><h2 data-cfu="heading" id="cfu-heading-' + product + '" tabindex="-1">Обновления приложения</h2><p class="cfu-status" data-cfu="status" role="status" aria-live="polite"></p></div></div>' +
      '<div class="cfu-versions"><div><span>Ваша версия</span><strong data-cfu="current">1.0.0</strong></div><span class="cfu-version-arrow" aria-hidden="true">→</span><div><span data-cfu="latest-label">Последняя версия</span><strong data-cfu="latest">—</strong></div></div>' +
      '<div class="cfu-download" data-cfu="download" hidden><div><span>Загрузка обновления</span><strong data-cfu="download-value"></strong></div><div class="cfu-download-track"><span data-cfu="download-bar"></span></div></div>' +
      '<section class="cfu-release" data-cfu="release"><h3 data-cfu="notes-title">Что нового</h3><p class="cfu-notes" data-cfu="notes"></p></section>' +
      '<section class="cfu-repository" data-cfu="repository-section" hidden><div class="cfu-repository-icon">' + svg('github') + '</div><div class="cfu-repository-body"><h3>Источник обновлений встроен</h3><p>Адрес официального источника задаётся издателем программы.</p><form data-cfu="repository-form"><input data-cfu="repository-input" type="hidden"><button class="cfu-connect" data-cfu="connect" type="submit" hidden>Подключить GitHub</button><p class="cfu-field-error" data-cfu="repository-error" role="alert"></p></form></div></section>' +
      '<div class="cfu-source" data-cfu="source" hidden><span>Источник</span><span data-cfu="source-name"></span><span class="cfu-source-lock">официальный</span><button data-cfu="change-source" type="button" hidden>Изменить</button></div>' +
      '<footer class="cfu-actions"><button class="cfu-secondary" data-cfu="later" type="button">Позже</button><button class="cfu-secondary" data-cfu="check" type="button">' + svg('update') + '<span>Проверить</span></button><button class="cfu-primary" data-cfu="install" type="button">' + svg('arrow') + '<span data-cfu="install-label">Обновить</span></button></footer>' +
      '<div class="cfu-support"><span>Нужна помощь?</span><button data-cfu="support" type="button" title="Написать в поддержку">' + svg('mail') + '<span>ra107696@gmail.com</span></button></div></section>';
    document.body.appendChild(overlay);
    const get = role => overlay.querySelector('[data-cfu="' + role + '"]');
    const panel = overlay.querySelector('.cfu-panel');
    get('product').textContent = productName;
    const launchers = [];
    let mounts = Array.from(document.querySelectorAll('[data-updates-launcher]'));
    if (!mounts.length) { const mount = document.createElement('div'); mount.className = 'cfu-fallback-launcher'; document.body.appendChild(mount); mounts = [mount]; }
    mounts.forEach(mount => {
      const button = document.createElement('button');
      button.className = 'cfu-launcher';
      button.dataset.cfuProduct = product;
      button.type = 'button';
      button.title = 'Обновления приложения';
      button.setAttribute('aria-haspopup', 'dialog');
      button.innerHTML = svg('update') + '<span>Обновления</span><i class="cfu-badge" aria-hidden="true"></i>';
      button.onclick = () => open(false);
      mount.appendChild(button);
      launchers.push(button);
    });
    function clearRetry() { if (retryTimer) { global.clearTimeout(retryTimer); retryTimer = 0; } }
    function armRetry() {
      if (retryTimer || !pending || disposed) return;
      retryTimer = global.setTimeout(() => { retryTimer = 0; if (pending) attemptOpen(); }, 600);
    }
    function attemptOpen() {
      if (!pending || disposed) return false;
      if (pending.auto && (state.status !== 'available' || !state.autoPrompt || promptedVersion === state.latestVersion)) { pending = null; clearRetry(); return false; }
      if (document.hidden || (typeof options.openOverlay === 'function' && options.openOverlay() === false)) { armRetry(); return false; }
      popup = pending.auto;
      if (popup) promptedVersion = state.latestVersion;
      pending = null;
      clearRetry();
      previousFocus = document.activeElement;
      opened = true;
      overlay.hidden = false;
      render();
      get('heading').focus({ preventScroll: true });
      return true;
    }
    function open(auto) {
      if (disposed) return false;
      if (opened) return true;
      pending = { auto: auto === true };
      return attemptOpen();
    }
    function close() {
      pending = null;
      clearRetry();
      if (!opened) return;
      opened = false;
      popup = false;
      overlay.hidden = true;
      render();
      if (typeof options.closeOverlay === 'function') options.closeOverlay();
      if (previousFocus && previousFocus.isConnected !== false && !previousFocus.disabled && typeof previousFocus.focus === 'function') previousFocus.focus({ preventScroll: true });
      previousFocus = null;
    }
    function receive(incoming) {
      state = normalize(incoming, product);
      render();
      if (state.status === 'available' && state.autoPrompt && state.latestVersion && promptedVersion !== state.latestVersion && !opened) open(true);
      else if (pending?.auto && state.status !== 'available') { pending = null; clearRetry(); }
    }
    function render() {
      const status = state.status;
      const busy = status === 'checking' || status === 'downloading';
      const available = status === 'available' || status === 'ready';
      overlay.dataset.status = status;
      launchers.forEach(button => {
        button.dataset.status = status;
        button.setAttribute('aria-expanded', String(opened));
        button.setAttribute('aria-label', available ? 'Обновления · доступна новая версия' : status === 'downloading' ? 'Обновления · идёт загрузка' : 'Обновления приложения');
        button.title = available ? 'Доступна версия ' + (state.latestVersion || '') : status === 'downloading' ? 'Загрузка обновления' : 'Обновления приложения';
      });
      const headings = { unconfigured: 'Обновления приложения', idle: 'Всё начинается с проверки', checking: 'Проверяем обновления', current: 'У вас последняя версия', available: 'Вышло новое обновление приложения', downloading: 'Загружаем обновление', ready: 'Обновление готово', error: 'Не удалось обновить приложение' };
      const messages = { unconfigured: 'Источник обновлений ещё не подключён', idle: 'Проверьте, появилась ли новая версия приложения.', checking: 'Ищем новую версию. Это займёт немного времени.', current: 'Можно продолжать работу. Обновлений пока нет.', available: 'Новая версия готова к загрузке.', downloading: state.progress === null ? 'Подготавливаем загрузку…' : 'Пожалуйста, дождитесь окончания загрузки.', ready: 'Установите новую версию, когда будете готовы.', error: 'Попробуйте ещё раз или обратитесь в поддержку.' };
      get('heading').textContent = headings[status];
      get('status').textContent = state.message || messages[status];
      get('current').textContent = state.currentVersion;
      get('latest').textContent = state.latestVersion || '—';
      get('latest-label').textContent = available || status === 'downloading' ? 'Новая версия' : 'Последняя версия';
      get('orbit').dataset.phase = status;
      get('center').textContent = status === 'downloading' && state.progress !== null ? Math.round(state.progress) + '%' : '';
      get('ring').style.strokeDashoffset = String(status === 'downloading' && state.progress !== null ? 276.46 * (1 - state.progress / 100) : 0);
      get('download').hidden = status !== 'downloading';
      get('download-value').textContent = state.progress === null ? '…' : Math.round(state.progress) + '%';
      get('download-bar').style.width = state.progress === null ? '28%' : state.progress + '%';
      get('download-bar').classList.toggle('cfu-indeterminate', state.progress === null);
      get('repository-section').hidden = true;
      get('repository-input').value = state.repository;
      get('source').hidden = !state.repository || status === 'unconfigured';
      get('source-name').textContent = state.repository.replace(/^https:\/\/github\.com\//i, '').replace(/\/$/, '');
      get('source-name').title = state.repository;
      get('change-source').disabled = true;
      get('release').hidden = status === 'unconfigured';
      get('notes-title').textContent = state.notes ? 'Что нового' : 'О приложении';
      get('notes').textContent = state.notes || (status === 'checking' ? 'Проверяем официальный источник обновлений.' : 'Здесь появится описание новой версии, когда она будет опубликована.');
      get('check').hidden = status === 'unconfigured' || status === 'downloading' || status === 'ready';
      get('check').disabled = busy;
      get('install').hidden = !available && status !== 'downloading';
      get('install').disabled = busy;
      get('install-label').textContent = status === 'ready' ? 'Установить и перезапустить' : status === 'downloading' ? 'Загрузка…' : 'Обновить';
      get('later').hidden = !available;
      get('later').textContent = status === 'available' ? 'Позже' : 'Закрыть';
      get('connect').disabled = busy;
    }
    get('close').onclick = close;
    get('later').onclick = () => { if (state.status === 'available') send({ type: 'updateLater' }); close(); };
    get('check').onclick = () => { if (state.status === 'checking' || state.status === 'downloading') return; state = { ...state, status: 'checking', progress: null, message: '' }; render(); send({ type: 'updateCheck' }); };
    get('install').onclick = () => {
      if (state.status !== 'available' && state.status !== 'ready') return;
      state = { ...state, status: 'downloading', progress: null, message: 'Подготавливаем обновление…' };
      render();
      send({ type: 'updateInstall' });
    };
    get('support').onclick = () => send({ type: 'contactSupport' });
    get('change-source').onclick = () => {};
    get('repository-form').onsubmit = event => { event.preventDefault(); };
    overlay.onpointerdown = event => { if (event.target === overlay) close(); };
    function onKeyDown(event) {
      if (!opened) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
      if (event.key !== 'Tab') return;
      const elements = Array.from(panel.querySelectorAll('button:not(:disabled),input:not(:disabled)')).filter(el => !el.hidden && el.getClientRects().length && !el.closest('[hidden]'));
      if (!elements.length) { event.preventDefault(); return; }
      const index = elements.indexOf(document.activeElement);
      if ((event.shiftKey && index <= 0) || (!event.shiftKey && (index < 0 || index === elements.length - 1))) { event.preventDefault(); elements[event.shiftKey ? elements.length - 1 : 0].focus(); }
    }
    document.addEventListener('keydown', onKeyDown, true);
    function destroy() { close(); disposed = true; document.removeEventListener('keydown', onKeyDown, true); overlay.remove(); launchers.forEach(button => button.remove()); }
    render();
    return { receive, open: () => open(false), close, destroy };
  }
  global.CodeFutureUpdates = { create };
})(window);
