const {
  app,
  BrowserWindow,
  WebContentsView,
  dialog,
  ipcMain,
  net,
  session,
  shell
} = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_URL = 'https://platforma-fa.ru/';
const NEW_TAB_URL = 'https://ya.ru/';
const CODE_URL = 'https://steps.2035.university/account/verify-code?context=kb-2026';
const UPDATE_REPOSITORY = 'https://github.com/Misha5757/PrepodKodBydyshie';
const UPDATE_API = 'https://api.github.com/repos/Misha5757/PrepodKodBydyshie/releases/latest';
const SUPPORT_EMAIL = 'ra107696@gmail.com';
const PALETTE = ['#9682df', '#719bcf', '#81a693', '#c99979', '#a481ba', '#7da9b7', '#b7a266', '#a88195'];
const PROVIDERS = {
  duckai: { name: 'Duck.ai · без регистрации', url: 'https://duck.ai/' },
  alice: { name: 'Алиса AI', url: 'https://alice.yandex.ru/' },
  deepseek: { name: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  qwen: { name: 'Qwen', url: 'https://chat.qwen.ai/' },
  gigachat: { name: 'GigaChat', url: 'https://giga.chat/' },
  mistral: { name: 'Le Chat · Mistral', url: 'https://chat.mistral.ai/chat' },
  perplexity: { name: 'Perplexity', url: 'https://www.perplexity.ai/' },
  copilot: { name: 'Microsoft Copilot', url: 'https://copilot.com/' }
};

let window = null;
let state = null;
let statePath = '';
let shellReady = false;
let closing = false;
let gestureActive = false;
let lastLayout = [];
let latestRelease = null;
let downloadedUpdate = '';
const views = new Map();
const attachedViews = new Set();

const updateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  latestVersion: app.getVersion(),
  progress: null,
  message: '',
  notes: '',
  repository: UPDATE_REPOSITORY,
  autoPrompt: false
};

function id(prefix) {
  return `${prefix}-${crypto.randomUUID().replaceAll('-', '')}`;
}

function createTab(url = DEFAULT_URL, title = 'Новая вкладка') {
  return { id: id('tab'), url, title, loading: false, codeRequest: url === CODE_URL, error: null };
}

function createAccount(name, number, accountId = id('account')) {
  const tab = createTab(DEFAULT_URL, 'Код будущего');
  return {
    id: accountId,
    name,
    color: PALETTE[Math.max(0, number - 1) % PALETTE.length],
    activeTab: tab.id,
    zoom: 1,
    legacyNumber: number,
    subgroup: 1,
    pinned: false,
    tabs: [tab]
  };
}

function defaultState() {
  const accounts = Array.from({ length: 20 }, (_, index) => createAccount(`Аккаунт ${index + 1}`, index + 1, `account-${index + 1}`));
  return {
    version: 5,
    subgroupCount: 1,
    accounts,
    settings: {
      page: 0,
      pageSize: 4,
      layoutScale: 1,
      positions: {},
      subgroupFilter: 0,
      assistantOpen: false,
      assistantProvider: 'duckai',
      assistantRect: null,
      assistantDocked: false
    },
    activeId: accounts[0].id,
    expandedId: null
  };
}

function normalizeState(source) {
  const fallback = defaultState();
  if (!source || !Array.isArray(source.accounts)) return fallback;
  const seenAccounts = new Set();
  const accounts = source.accounts.map((raw, index) => {
    const accountId = typeof raw.id === 'string' && raw.id && !seenAccounts.has(raw.id) ? raw.id : id('account');
    seenAccounts.add(accountId);
    const seenTabs = new Set();
    let tabs = Array.isArray(raw.tabs) ? raw.tabs.map(item => {
      const tabId = typeof item.id === 'string' && item.id && !seenTabs.has(item.id) ? item.id : id('tab');
      seenTabs.add(tabId);
      const url = safeUrl(item.url, DEFAULT_URL);
      return {
        id: tabId,
        url,
        title: String(item.title || 'Новая вкладка').slice(0, 180),
        loading: false,
        codeRequest: Boolean(item.codeRequest) || url === CODE_URL,
        error: null
      };
    }) : [];
    if (!tabs.length) tabs = [createTab(DEFAULT_URL)];
    const activeTab = tabs.some(tab => tab.id === raw.activeTab) ? raw.activeTab : tabs[0].id;
    return {
      id: accountId,
      name: String(raw.name || `Аккаунт ${index + 1}`).slice(0, 80),
      color: typeof raw.color === 'string' ? raw.color : PALETTE[index % PALETTE.length],
      activeTab,
      zoom: clamp(Number(raw.zoom) || 1, 0.25, 3),
      legacyNumber: Number(raw.legacyNumber) || 0,
      subgroup: Math.max(1, Number(raw.subgroup) || 1),
      pinned: Boolean(raw.pinned),
      tabs
    };
  });
  if (!accounts.length) accounts.push(createAccount('Аккаунт 1', 1));
  const subgroupCount = Math.max(1, Number(source.subgroupCount) || 1, ...accounts.map(item => item.subgroup));
  let pinnedFound = false;
  for (const account of accounts) {
    account.subgroup = clamp(account.subgroup, 1, subgroupCount);
    if (account.pinned && !pinnedFound) pinnedFound = true;
    else if (account.pinned) account.pinned = false;
  }
  const settings = { ...fallback.settings, ...(source.settings || {}) };
  settings.page = Math.max(0, Number(settings.page) || 0);
  settings.pageSize = clamp(Number(settings.pageSize) || 4, 1, 4);
  settings.layoutScale = clamp(Number(settings.layoutScale) || 1, 0.5, 1.6);
  settings.positions = settings.positions && typeof settings.positions === 'object' ? settings.positions : {};
  settings.subgroupFilter = clamp(Number(settings.subgroupFilter) || 0, 0, subgroupCount);
  settings.assistantProvider = PROVIDERS[settings.assistantProvider] ? settings.assistantProvider : 'duckai';
  return {
    version: 5,
    subgroupCount,
    accounts,
    settings,
    activeId: accounts.some(item => item.id === source.activeId) ? source.activeId : accounts[0].id,
    expandedId: accounts.some(item => item.id === source.expandedId) ? source.expandedId : null
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeUrl(value, fallback = NEW_TAB_URL) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
  } catch {}
  if (/^[\w.-]+\.[a-zа-я]{2,}(?:\/.*)?$/iu.test(raw)) return `https://${raw}`;
  return `https://yandex.ru/search/?text=${encodeURIComponent(raw)}`;
}

function saveState() {
  if (!statePath || !state) return;
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const temporary = `${statePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), 'utf8');
    if (fs.existsSync(statePath)) fs.copyFileSync(statePath, `${statePath}.bak`);
    fs.renameSync(temporary, statePath);
  } catch (error) {
    console.error('Save state:', error);
    toast('Не удалось сохранить настройки.');
  }
}

function loadState() {
  try {
    if (fs.existsSync(statePath)) return normalizeState(JSON.parse(fs.readFileSync(statePath, 'utf8')));
  } catch (error) {
    console.error('Load state:', error);
    try {
      const backup = `${statePath}.bak`;
      if (fs.existsSync(backup)) return normalizeState(JSON.parse(fs.readFileSync(backup, 'utf8')));
    } catch {}
  }
  return defaultState();
}

function post(data) {
  if (!window || window.isDestroyed() || !shellReady) return;
  window.webContents.send('teacher-host-message', data);
}

function toast(message) {
  post({ type: 'toast', message });
}

function provider() {
  return PROVIDERS[state?.settings?.assistantProvider] || PROVIDERS.duckai;
}

function sendState() {
  if (!state) return;
  post({
    type: 'state',
    state: {
      ...state,
      assistant: {
        provider: state.settings.assistantProvider,
        url: provider().url,
        loading: false,
        error: null
      }
    }
  });
}

function sendUpdateState() {
  post({ type: 'updateState', state: { ...updateState } });
}

function accountById(accountId) {
  return state.accounts.find(item => item.id === accountId);
}

function tabById(account, tabId) {
  return account?.tabs.find(item => item.id === tabId);
}

function activeTab(account) {
  return tabById(account, account?.activeTab) || account?.tabs[0];
}

function partitionFor(accountId) {
  return accountId === '__assistant__' ? 'persist:teacher-assistant' : `persist:teacher-${accountId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function key(accountId, tabId) {
  return `${accountId}/${tabId}`;
}

function itemFor(accountId, tabId) {
  if (accountId === '__assistant__') {
    return { account: null, tab: { id: 'assistant-tab', url: provider().url, title: provider().name }, assistant: true };
  }
  const account = accountById(accountId);
  const tab = tabById(account, tabId);
  return account && tab ? { account, tab, assistant: false } : null;
}

function ensureView(accountId, tabId) {
  const viewKey = key(accountId, tabId);
  if (views.has(viewKey)) return views.get(viewKey);
  const item = itemFor(accountId, tabId);
  if (!item) return null;
  const view = new WebContentsView({
    webPreferences: {
      partition: partitionFor(accountId),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true
    }
  });
  view.setBackgroundColor('#ffffff');
  const contents = view.webContents;
  const entry = { view, accountId, tabId, navigatingTo: item.tab.url };
  views.set(viewKey, entry);

  contents.setWindowOpenHandler(({ url }) => {
    if (item.assistant) {
      shell.openExternal(url).catch(() => {});
    } else {
      const account = accountById(accountId);
      if (account) {
        const next = createTab(safeUrl(url));
        account.tabs.push(next);
        account.activeTab = next.id;
        state.activeId = account.id;
        saveState();
        sendState();
      }
    }
    return { action: 'deny' };
  });
  contents.on('did-start-loading', () => updateTabFromView(entry, { loading: true, error: null }));
  contents.on('did-stop-loading', () => updateTabFromView(entry, { loading: false }));
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    updateTabFromView(entry, { loading: false, error: `${description} (${code})`, url: url || undefined });
  });
  contents.on('page-title-updated', event => {
    event.preventDefault();
    updateTabFromView(entry, { title: contents.getTitle() || 'Новая вкладка' });
  });
  contents.on('did-navigate', (_event, url) => updateTabFromView(entry, navigationPatch(contents, url)));
  contents.on('did-navigate-in-page', (_event, url) => updateTabFromView(entry, navigationPatch(contents, url)));
  contents.on('before-input-event', (_event, input) => {
    if (!item.assistant && input.type === 'keyDown') activateFromView(accountId);
  });
  contents.on('render-process-gone', () => updateTabFromView(entry, { loading: false, error: 'Вкладка остановилась. Обновите её.' }));
  if (!item.assistant && item.account) contents.setZoomFactor(item.account.zoom || 1);
  contents.loadURL(item.tab.url).catch(error => updateTabFromView(entry, { loading: false, error: error.message }));
  return entry;
}

function navigationPatch(contents, url) {
  return {
    url,
    loading: contents.isLoading(),
    error: null,
    canGoBack: contents.canGoBack(),
    canGoForward: contents.canGoForward()
  };
}

function updateTabFromView(entry, patch) {
  if (entry.accountId === '__assistant__') return;
  const account = accountById(entry.accountId);
  const tab = tabById(account, entry.tabId);
  if (!tab) return;
  Object.assign(tab, patch);
  saveState();
  sendState();
}

function activateFromView(accountId) {
  if (state.activeId === accountId) return;
  state.activeId = accountId;
  saveState();
  sendState();
}

function detachViews() {
  if (!window || window.isDestroyed()) return;
  for (const entry of attachedViews) {
    try { window.contentView.removeChildView(entry.view); } catch {}
  }
  attachedViews.clear();
}

function intersectBounds(slot) {
  const clip = slot.clip || { x: 0, y: 0, width: window.getContentBounds().width, height: window.getContentBounds().height };
  const left = Math.max(Number(slot.x) || 0, Number(clip.x) || 0);
  const top = Math.max(Number(slot.y) || 0, Number(clip.y) || 0);
  const right = Math.min((Number(slot.x) || 0) + (Number(slot.width) || 0), (Number(clip.x) || 0) + (Number(clip.width) || 0));
  const bottom = Math.min((Number(slot.y) || 0) + (Number(slot.height) || 0), (Number(clip.y) || 0) + (Number(clip.height) || 0));
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(1, Math.round(right - left)),
    height: Math.max(1, Math.round(bottom - top))
  };
}

function applyLayout(slots = lastLayout) {
  lastLayout = Array.isArray(slots) ? slots.filter(slot => slot && slot.visible !== false) : [];
  if (!window || window.isDestroyed() || gestureActive) return;
  detachViews();
  for (const slot of [...lastLayout].sort((a, b) => (Number(a.z) || 0) - (Number(b.z) || 0))) {
    const entry = ensureView(String(slot.accountId || ''), String(slot.tabId || ''));
    if (!entry) continue;
    const bounds = intersectBounds(slot);
    if (bounds.width < 2 || bounds.height < 2) continue;
    entry.view.setBounds(bounds);
    window.contentView.addChildView(entry.view);
    attachedViews.add(entry);
  }
}

async function beginGesture(gestureId) {
  if (gestureActive) return;
  const previews = [];
  try {
    for (const entry of attachedViews) {
      if (entry.accountId === '__assistant__') continue;
      const image = await entry.view.webContents.capturePage();
      if (!image.isEmpty()) previews.push({ accountId: entry.accountId, tabId: entry.tabId, image: image.toDataURL() });
    }
    post({ type: 'gesturePreview', gestureId, previews });
  } catch {
    post({ type: 'gesturePreviewFailed', gestureId });
  }
}

function activateGesture(gestureId) {
  gestureActive = true;
  detachViews();
  post({ type: 'gesturePreviewActive', gestureId });
}

function finishGesture(gestureId) {
  gestureActive = false;
  applyLayout();
  post({ type: 'gestureFinished', gestureId });
}

function disposeView(entry) {
  if (!entry) return;
  if (attachedViews.has(entry)) {
    try { window.contentView.removeChildView(entry.view); } catch {}
    attachedViews.delete(entry);
  }
  views.delete(key(entry.accountId, entry.tabId));
  try { entry.view.webContents.close(); } catch {}
}

function disposeAccountViews(accountId) {
  for (const entry of [...views.values()]) if (entry.accountId === accountId) disposeView(entry);
}

function navigateView(account, tab, destination) {
  tab.url = safeUrl(destination);
  tab.error = null;
  const entry = ensureView(account.id, tab.id);
  entry?.view.webContents.loadURL(tab.url).catch(error => updateTabFromView(entry, { loading: false, error: error.message }));
}

async function clearAccount(account, fullReset) {
  const isolated = session.fromPartition(partitionFor(account.id));
  await isolated.clearCache();
  if (fullReset) {
    await isolated.clearStorageData();
    await isolated.clearAuthCache().catch(() => {});
    disposeAccountViews(account.id);
    const tab = createTab(DEFAULT_URL, 'Код будущего');
    account.tabs = [tab];
    account.activeTab = tab.id;
    toast(`Данные «${account.name}» полностью сброшены.`);
  } else {
    for (const entry of views.values()) if (entry.accountId === account.id) entry.view.webContents.reload();
    toast(`Кэш «${account.name}» очищен. Входы сохранены.`);
  }
  saveState();
  sendState();
}

async function deleteAccount(account) {
  disposeAccountViews(account.id);
  const isolated = session.fromPartition(partitionFor(account.id));
  await isolated.clearStorageData().catch(() => {});
  await isolated.clearCache().catch(() => {});
  state.accounts = state.accounts.filter(item => item.id !== account.id);
  if (!state.accounts.length) state.accounts.push(createAccount('Аккаунт 1', 1));
  state.activeId = state.accounts[0].id;
  state.expandedId = null;
  state.settings.page = 0;
  state.settings.positions = {};
  saveState();
  sendState();
  toast('Аккаунт и его данные удалены.');
}

function cookieForBackup(cookie) {
  const result = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || '/',
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    session: Boolean(cookie.session)
  };
  if (!cookie.session && Number.isFinite(cookie.expirationDate)) result.expirationDate = cookie.expirationDate;
  if (cookie.sameSite && cookie.sameSite !== 'unspecified') result.sameSite = cookie.sameSite;
  return result;
}

function cookieRestoreUrl(cookie) {
  const domain = String(cookie.domain || '').replace(/^\./, '');
  if (!domain) return null;
  return `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path || '/'}`;
}

async function exportPortable() {
  try {
    const cookies = {};
    for (const account of state.accounts) {
      cookies[account.id] = (await session.fromPartition(partitionFor(account.id)).cookies.get({})).map(cookieForBackup);
    }
    cookies.__assistant__ = (await session.fromPartition(partitionFor('__assistant__')).cookies.get({})).map(cookieForBackup);
    const result = await dialog.showSaveDialog(window, {
      title: 'Сохранить копию аккаунтов',
      defaultPath: `Код-будущего-копия-${new Date().toISOString().slice(0, 10)}.kfb`,
      filters: [{ name: 'Копия «Код будущего»', extensions: ['kfb'] }]
    });
    if (result.canceled || !result.filePath) return post({ type: 'portableResult', success: false, message: 'Сохранение отменено.' });
    const backup = { format: 'code-future-teacher', version: 1, createdAt: new Date().toISOString(), state, cookies };
    await fsp.writeFile(result.filePath, JSON.stringify(backup), 'utf8');
    post({ type: 'portableResult', success: true, message: 'Копия сохранена. Её можно перенести на флешке.' });
  } catch (error) {
    console.error('Export:', error);
    post({ type: 'portableResult', success: false, message: 'Не удалось сохранить копию.' });
  }
}

async function importPortable() {
  try {
    const result = await dialog.showOpenDialog(window, {
      title: 'Восстановить аккаунты',
      properties: ['openFile'],
      filters: [{ name: 'Копия «Код будущего»', extensions: ['kfb'] }]
    });
    if (result.canceled || !result.filePaths[0]) return post({ type: 'portableResult', success: false, message: 'Восстановление отменено.' });
    const backup = JSON.parse(await fsp.readFile(result.filePaths[0], 'utf8'));
    if (backup?.format !== 'code-future-teacher' || !backup.state) throw new Error('Unknown backup format');
    detachViews();
    for (const entry of [...views.values()]) disposeView(entry);
    state = normalizeState(backup.state);
    for (const account of state.accounts) {
      const isolated = session.fromPartition(partitionFor(account.id));
      await isolated.clearStorageData();
      for (const cookie of backup.cookies?.[account.id] || []) {
        const url = cookieRestoreUrl(cookie);
        if (!url) continue;
        const restored = { ...cookie, url };
        delete restored.session;
        await isolated.cookies.set(restored).catch(() => {});
      }
    }
    const assistantCookies = backup.cookies?.__assistant__ || [];
    const assistantSession = session.fromPartition(partitionFor('__assistant__'));
    await assistantSession.clearStorageData();
    for (const cookie of assistantCookies) {
      const url = cookieRestoreUrl(cookie);
      if (!url) continue;
      const restored = { ...cookie, url };
      delete restored.session;
      await assistantSession.cookies.set(restored).catch(() => {});
    }
    saveState();
    sendState();
    post({ type: 'portableResult', success: true, message: 'Аккаунты и данные входа восстановлены.' });
  } catch (error) {
    console.error('Import:', error);
    post({ type: 'portableResult', success: false, message: 'Не удалось прочитать копию.' });
  }
}

function versionParts(value) {
  return String(value || '').replace(/^v/i, '').split(/[^0-9]+/).filter(Boolean).slice(0, 4).map(Number);
}

function newerVersion(candidate, current) {
  const a = versionParts(candidate);
  const b = versionParts(current);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0);
  }
  return false;
}

async function checkUpdates(autoPrompt) {
  updateState.status = 'checking';
  updateState.progress = null;
  updateState.message = '';
  updateState.autoPrompt = Boolean(autoPrompt);
  sendUpdateState();
  try {
    const response = await net.fetch(UPDATE_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    latestRelease = await response.json();
    updateState.latestVersion = String(latestRelease.tag_name || latestRelease.name || app.getVersion()).replace(/^v/i, '');
    updateState.notes = String(latestRelease.body || '').slice(0, 4000);
    if (newerVersion(updateState.latestVersion, app.getVersion())) {
      updateState.status = 'available';
      updateState.message = `Доступна версия ${updateState.latestVersion}.`;
    } else {
      updateState.status = 'current';
      updateState.message = 'У вас установлена последняя версия.';
      updateState.autoPrompt = false;
    }
  } catch (error) {
    console.error('Update check:', error);
    updateState.status = 'error';
    updateState.message = 'Не удалось проверить обновление. Проверьте интернет.';
    updateState.autoPrompt = false;
  }
  sendUpdateState();
}

function macAsset() {
  const assets = Array.isArray(latestRelease?.assets) ? latestRelease.assets : [];
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return assets.find(item => item.name?.toLowerCase().endsWith('.dmg') && item.name.toLowerCase().includes(arch))
    || assets.find(item => item.name?.toLowerCase().endsWith('.dmg'));
}

async function installUpdate() {
  if (downloadedUpdate && fs.existsSync(downloadedUpdate)) {
    await shell.openPath(downloadedUpdate);
    return;
  }
  const asset = macAsset();
  if (!asset?.browser_download_url) {
    await shell.openExternal(latestRelease?.html_url || `${UPDATE_REPOSITORY}/releases/latest`);
    updateState.status = 'available';
    updateState.message = 'Открыта страница загрузки.';
    sendUpdateState();
    return;
  }
  updateState.status = 'downloading';
  updateState.progress = 0;
  updateState.message = 'Загружаем обновление…';
  sendUpdateState();
  session.defaultSession.once('will-download', (_event, item) => {
    const target = path.join(app.getPath('downloads'), item.getFilename());
    item.setSavePath(target);
    item.on('updated', () => {
      const total = item.getTotalBytes();
      updateState.progress = total > 0 ? item.getReceivedBytes() / total * 100 : null;
      sendUpdateState();
    });
    item.once('done', (_doneEvent, status) => {
      if (status === 'completed') {
        downloadedUpdate = target;
        updateState.status = 'ready';
        updateState.progress = 100;
        updateState.message = 'Обновление загружено. Нажмите «Установить».';
      } else {
        updateState.status = 'error';
        updateState.progress = null;
        updateState.message = 'Загрузка обновления прервана.';
      }
      sendUpdateState();
    });
  });
  session.defaultSession.downloadURL(asset.browser_download_url);
}

async function handleMessage(message) {
  if (!message || typeof message.type !== 'string' || closing) return;
  const type = message.type;
  if (type === 'ready') {
    shellReady = true;
    sendState();
    sendUpdateState();
    setTimeout(() => checkUpdates(true), 800);
    return;
  }
  if (type === 'layout') return applyLayout(message.slots);
  if (type === 'beginGesture') return beginGesture(Number(message.gestureId) || 0);
  if (type === 'gesturePreviewReady') return activateGesture(Number(message.gestureId) || 0);
  if (type === 'endGesture') return finishGesture(Number(message.gestureId) || 0);
  if (type === 'exportPortable') return exportPortable();
  if (type === 'importPortable') return importPortable();
  if (type === 'updateCheck') return checkUpdates(false);
  if (type === 'updateInstall') return installUpdate();
  if (type === 'updateLater') { updateState.autoPrompt = false; return sendUpdateState(); }
  if (type === 'updateRepository') return;
  if (type === 'contactSupport') return shell.openExternal(`mailto:${SUPPORT_EMAIL}`);

  if (type === 'createSubgroup') {
    state.subgroupCount++;
    state.settings.subgroupFilter = state.subgroupCount;
    state.settings.page = 0;
    state.settings.positions = {};
    toast(`Создана Подгруппа ${state.subgroupCount}.`);
  } else if (type === 'deleteSubgroup') {
    const subgroup = Number(message.subgroup) || 0;
    if (subgroup <= 1 || subgroup > state.subgroupCount) return toast('Подгруппу 1 удалить нельзя.');
    for (const account of state.accounts) {
      if (account.subgroup === subgroup) account.subgroup = 1;
      else if (account.subgroup > subgroup) account.subgroup--;
    }
    state.subgroupCount--;
    state.settings.subgroupFilter = 1;
    state.settings.page = 0;
    state.settings.positions = {};
    toast('Подгруппа удалена. Аккаунты перенесены в Подгруппу 1.');
  } else if (type === 'createAccount') {
    const number = state.accounts.length + 1;
    const name = String(message.name || `Аккаунт ${number}`).trim().slice(0, 80) || `Аккаунт ${number}`;
    const account = createAccount(name, number);
    account.subgroup = clamp(Number(message.subgroup) || Number(state.settings.subgroupFilter) || 1, 1, state.subgroupCount);
    state.accounts.push(account);
    state.activeId = account.id;
    state.expandedId = null;
    state.settings.page = Math.floor((state.accounts.length - 1) / state.settings.pageSize);
  } else if (type === 'settings') {
    const allowed = ['page', 'pageSize', 'layoutScale', 'positions', 'subgroupFilter', 'assistantOpen', 'assistantRect', 'assistantProvider', 'assistantDocked'];
    for (const name of allowed) if (Object.prototype.hasOwnProperty.call(message.patch || {}, name)) state.settings[name] = message.patch[name];
    state.settings.pageSize = clamp(Number(state.settings.pageSize) || 4, 1, 4);
    state.settings.layoutScale = clamp(Number(state.settings.layoutScale) || 1, 0.5, 1.6);
    state.settings.subgroupFilter = clamp(Number(state.settings.subgroupFilter) || 0, 0, state.subgroupCount);
  } else if (type === 'assistantProvider') {
    const next = PROVIDERS[message.providerId] ? message.providerId : 'duckai';
    state.settings.assistantProvider = next;
    disposeAccountViews('__assistant__');
  } else if (type === 'assistantReload') {
    ensureView('__assistant__', 'assistant-tab')?.view.webContents.reload();
    return;
  } else if (type === 'assistantNewChat') {
    const entry = ensureView('__assistant__', 'assistant-tab');
    entry?.view.webContents.loadURL(provider().url);
    return;
  } else if (type === 'openExternalAssistant') {
    return shell.openExternal(provider().url);
  } else {
    const account = accountById(String(message.accountId || ''));
    if (!account) return;
    const tab = activeTab(account);
    if (type === 'activate') state.activeId = account.id;
    else if (type === 'rename') {
      const name = String(message.name || '').trim();
      if (!name) return;
      account.name = name.slice(0, 80);
      toast('Название аккаунта сохранено.');
    } else if (type === 'setSubgroup') account.subgroup = clamp(Number(message.subgroup) || 1, 1, state.subgroupCount);
    else if (type === 'togglePin') {
      const next = !account.pinned;
      for (const item of state.accounts) item.pinned = false;
      account.pinned = next;
      state.settings.page = 0;
      state.settings.positions = {};
      toast(next ? `«${account.name}» закреплён.` : 'Закрепление снято.');
    } else if (type === 'expand') {
      state.activeId = account.id;
      state.expandedId = state.expandedId === account.id ? null : account.id;
    } else if (type === 'newTab') {
      const next = createTab(safeUrl(message.url || NEW_TAB_URL));
      account.tabs.push(next);
      account.activeTab = next.id;
      state.activeId = account.id;
    } else if (type === 'openCode') {
      let codeTab = account.tabs.find(item => item.codeRequest || item.url.startsWith('https://steps.2035.university/account/verify-code'));
      if (!codeTab) {
        codeTab = createTab(CODE_URL, 'Код подтверждения');
        account.tabs.push(codeTab);
      }
      account.activeTab = codeTab.id;
      state.activeId = account.id;
    } else if (type === 'selectTab') {
      if (account.tabs.some(item => item.id === message.tabId)) account.activeTab = message.tabId;
      state.activeId = account.id;
    } else if (type === 'closeTab') {
      const index = account.tabs.findIndex(item => item.id === message.tabId);
      if (index < 0) return;
      disposeView(views.get(key(account.id, message.tabId)));
      account.tabs.splice(index, 1);
      if (!account.tabs.length) account.tabs.push(createTab(DEFAULT_URL));
      if (account.activeTab === message.tabId) account.activeTab = account.tabs[Math.min(index, account.tabs.length - 1)].id;
    } else if (type === 'navigate') {
      if (!tab) return;
      navigateView(account, tab, message.url);
    } else if (type === 'reload') ensureView(account.id, tab.id)?.view.webContents.reload();
    else if (type === 'back') {
      const contents = ensureView(account.id, tab.id)?.view.webContents;
      if (contents?.canGoBack()) contents.goBack();
    } else if (type === 'forward') {
      const contents = ensureView(account.id, tab.id)?.view.webContents;
      if (contents?.canGoForward()) contents.goForward();
    } else if (type === 'zoom') {
      account.zoom = clamp(Number(message.value) || 1, 0.25, 3);
      for (const entry of views.values()) if (entry.accountId === account.id) entry.view.webContents.setZoomFactor(account.zoom);
    } else if (type === 'legacy') return shell.openExternal(tab?.url || DEFAULT_URL);
    else if (type === 'clearCache') return clearAccount(account, false);
    else if (type === 'resetAccount') return clearAccount(account, true);
    else if (type === 'deleteAccount') return deleteAccount(account);
    else return;
  }
  saveState();
  sendState();
}

function createWindow() {
  window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 920,
    minHeight: 650,
    title: 'Код будущего — Преподаватель',
    backgroundColor: '#f4f5f8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  window.setMenuBarVisibility(false);
  window.once('ready-to-show', () => window.show());
  window.on('resize', () => applyLayout());
  window.on('close', () => {
    closing = true;
    saveState();
    detachViews();
  });
  window.on('closed', () => { window = null; });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'ui.html'));
}

ipcMain.on('teacher-shell-message', (_event, message) => {
  Promise.resolve(handleMessage(message)).catch(error => {
    console.error('Command:', error);
    toast('Не удалось выполнить действие.');
  });
});

app.whenReady().then(() => {
  statePath = path.join(app.getPath('userData'), 'workspace.json');
  state = loadState();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  closing = true;
  saveState();
});
