// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
'use strict';

const I18N = {
  fr: {
    title: 'Quota JemaOS',
    subtitle: 'Provisionner le quota d’installation signé sur une clé USB',
    langToggle: 'EN',
    step1: 'Choisir la clé USB',
    refresh: 'Actualiser',
    step2: 'Limite d’installations',
    scanning: 'Recherche des périphériques…',
    none: 'Aucun disque détecté.',
    tagEsp: 'ESP',
    tagNoEsp: 'aucune ESP',
    hintLimit: 'Nombre maximum d’installations autorisées pour cette clé.',
    initBtn: 'Initialiser la clé',
    initBusy: 'Initialisation…',
    hintSelect: 'Sélectionne une clé pour continuer.',
    hintReady: 'Prêt à écrire le compteur signé.',
    hintElevate: 'Une demande d’autorisation s’affichera à l’écriture.',
    hintAdmin: 'Lance l’application en administrateur (UAC).',
    statusTitle: 'État de la clé',
    statusCurrent: 'Quota actuel',
    statusNone: 'Aucun quota',
    statusError: 'Erreur',
    fieldEsp: 'ESP',
    fieldLimit: 'Limite',
    fieldUsed: 'Utilisées',
    fieldSig: 'Signature',
    valid: 'valide',
    invalid: 'invalide',
    notInit: 'non initialisé',
    noCount: 'Aucun compteur',
    error: 'Erreur',
    bannerAdmin: 'Lance l’application en tant qu’administrateur (UAC) pour écrire sur la clé.',
    bridgeUnavailable: 'Le module natif est indisponible. Réinstalle l’application Quota JemaOS.',
    bannerNoKey: 'Clé HMAC (jemaos-quota.key) introuvable — impossible de signer.',
    initOk: 'Clé initialisée : {limit} installations (0 utilisée), signature valide.',
  },
  en: {
    title: 'JemaOS Quota',
    subtitle: 'Provision the signed installation quota on a USB key',
    langToggle: 'FR',
    step1: 'Choose the USB key',
    refresh: 'Refresh',
    step2: 'Install limit',
    scanning: 'Scanning devices…',
    none: 'No disk detected.',
    tagEsp: 'ESP',
    tagNoEsp: 'no ESP',
    hintLimit: 'Maximum number of installs allowed for this key.',
    initBtn: 'Initialize key',
    initBusy: 'Initializing…',
    hintSelect: 'Select a key to continue.',
    hintReady: 'Ready to write the signed counter.',
    hintElevate: 'An authorization prompt will appear when writing.',
    hintAdmin: 'Run the app as administrator (UAC).',
    statusTitle: 'Key status',
    statusCurrent: 'Current quota',
    statusNone: 'No quota',
    statusError: 'Error',
    fieldEsp: 'ESP',
    fieldLimit: 'Limit',
    fieldUsed: 'Used',
    fieldSig: 'Signature',
    valid: 'valid',
    invalid: 'invalid',
    notInit: 'not initialized',
    noCount: 'No counter',
    error: 'Error',
    bannerAdmin: 'Run the app as administrator (UAC) to write on the key.',
    bridgeUnavailable: 'The native module is unavailable. Reinstall the Quota JemaOS application.',
    bannerNoKey: 'HMAC key (jemaos-quota.key) not found — cannot sign.',
    initOk: 'Key initialized: {limit} installs (0 used), valid signature.',
  },
};

const state = { devices: [], selected: null, meta: null, status: null, lang: 'fr', busy: false };

const el = (id) => document.getElementById(id);
const t = (key, params) => {
  let s = (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(`{${k}}`, v);
    }
  }
  return s;
};

// ---- theme ---------------------------------------------------------------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  el('theme').textContent = theme === 'dark' ? '☀' : '☾';
}
function initTheme() {
  const stored = localStorage.getItem('qt_theme');
  const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(stored || sys);
}

// ---- i18n ----------------------------------------------------------------
function applyI18n() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll('[data-i18n]').forEach(node => {
    node.textContent = t(node.dataset.i18n);
  });
  el('lang').textContent = t('langToggle');
}

// ---- native IPC ---------------------------------------------------------
const bridge = typeof window !== 'undefined' && window.jemaos ? window.jemaos : null;

async function invoke(action, payload) {
  if (!bridge) {
    throw new Error(t('bridgeUnavailable'));
  }
  return bridge.invoke(action, payload);
}

function fmtSize(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1e9;
  return gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${gb.toFixed(1)} GB`;
}

function showBanner(message, kind = '') {
  const banner = el('banner');
  banner.textContent = message;
  banner.className = `banner ${kind}`.trim();
}
function hideBanner() {
  el('banner').className = 'banner hidden';
}

// ---- devices -------------------------------------------------------------
async function loadDevices() {
  const res = await invoke('devices');
  state.devices = (Array.isArray(res) ? res : res.devices).filter(d => d.removable && !d.systemDisk);
  // Drop a selection whose key is no longer connected (unplugged / replaced).
  if (state.selected && !state.devices.some(d => d.id === state.selected)) {
    state.selected = null;
    state.status = null;
    el('status-card').classList.add('hidden');
  }
  renderDevices();
  // Never fall back to an internal/system disk when no USB key is connected.
  if (!state.selected) {
    const pick = state.devices.find(d => d.partitions.filter(p => p.esp).length === 1);
    if (pick) {
      await selectDevice(pick.id);
    }
  }
  updateActionState();
}

async function refreshDevices() {
  const btn = el('refresh');
  btn.disabled = true;
  hideBanner();
  try {
    await loadDevices();
  } catch (error) {
    showBanner(error.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function renderDevices() {
  const list = el('device-list');
  list.innerHTML = '';
  if (state.devices.length === 0) {
    list.innerHTML = `<div class="empty">${t('none')}</div>`;
    return;
  }
  const hasEsp = d => d.partitions.some(p => p.esp);
  const ordered = [...state.devices.filter(hasEsp), ...state.devices.filter(d => !hasEsp(d))];
  for (const disk of ordered) {
    const esp = hasEsp(disk);
    const row = document.createElement('div');
    row.className = `device${esp ? '' : ' disabled'}${state.selected === disk.id ? ' selected' : ''}`;
    const dot = document.createElement('span');
    dot.className = 'dot';
    const details = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = disk.model || disk.name || disk.id;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${disk.id}${fmtSize(disk.size) ? ' · ' + fmtSize(disk.size) : ''}${disk.transport ? ' · ' + disk.transport : ''}`;
    details.append(name, meta);
    const tag = document.createElement('span');
    tag.className = `tag ${esp ? '' : 'noesp'}`;
    tag.textContent = esp ? t('tagEsp') : t('tagNoEsp');
    row.append(dot, details, tag);
    if (esp) row.addEventListener('click', () => selectDevice(disk.id));
    list.appendChild(row);
  }
}

async function selectDevice(id) {
  state.selected = id;
  renderDevices();
  updateActionState();
  hideBanner();
  try {
    const disk = state.devices.find(d => d.id === id);
    state.status = await invoke('show', { device: id, identity: disk && disk.identity });
    renderStatus(state.status);
  } catch (error) {
    state.status = null;
    renderStatusError(error.message);
  }
}

// ---- status --------------------------------------------------------------
function renderStatus(status) {
  const card = el('status-card');
  card.classList.remove('hidden');
  el('status-title').textContent = status.present ? t('statusCurrent') : t('statusNone');
  if (!status.present) {
    renderStatusRows([[t('noCount'), t('notInit'), 'bad']]);
    return;
  }
  renderStatusRows([
    [t('fieldEsp'), status.esp],
    [t('fieldLimit'), status.limit],
    [t('fieldUsed'), status.used],
    [t('fieldSig'), status.valid ? t('valid') : t('invalid'), status.valid ? 'good' : 'bad'],
  ]);
}

function renderStatusRows(rows) {
  const grid = el('status-grid');
  grid.replaceChildren();
  for (const [label, value, className = ''] of rows) {
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = String(value);
    detail.className = className;
    grid.append(term, detail);
  }
}

function renderStatusError(message) {
  const card = el('status-card');
  card.classList.remove('hidden');
  el('status-title').textContent = t('statusError');
  renderStatusRows([[t('error'), message, 'bad']]);
}

// ---- actions -------------------------------------------------------------
function updateActionState() {
  const btn = el('init-btn');
  const hint = el('action-hint');
  const elevated = Boolean(state.meta && state.meta.elevated);
  btn.disabled = state.busy || !(state.selected && state.meta && state.meta.keyPresent && currentLimit() !== null);

  if (!state.selected) hint.textContent = t('hintSelect');
  else if (!elevated) hint.textContent = t('hintElevate');
  else hint.textContent = t('hintReady');
}

function currentLimit() {
  const value = el('limit').value.trim();
  const n = Number(value);
  return value !== '' && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

async function doInit() {
  const limit = currentLimit();
  if (limit === null || !state.selected || state.busy) return;
  state.busy = true;
  const btn = el('init-btn');
  btn.disabled = true;
  btn.textContent = t('initBusy');
  try {
    const disk = state.devices.find(d => d.id === state.selected);
    const result = await invoke('init', { device: state.selected, identity: disk && disk.identity, limit });
    // Render the status straight from the verified (re-read) result instead of
    // issuing another round-trip to re-read it.
    state.status = { esp: result.esp, present: true, valid: result.valid, limit: result.limit, used: result.used };
    renderStatus(state.status);
    showBanner(t('initOk', { limit: result.limit }), 'ok');
  } catch (error) {
    showBanner(error.message, 'error');
  } finally {
    state.busy = false;
    btn.textContent = t('initBtn');
    updateActionState();
  }
}

// ---- wiring --------------------------------------------------------------
function wireEvents() {
  el('limit-dec').addEventListener('click', () => {
    el('limit').value = Math.max(0, (currentLimit() ?? 0) - 1);
    updateActionState();
  });
  el('limit-inc').addEventListener('click', () => {
    el('limit').value = (currentLimit() ?? 0) + 1;
    updateActionState();
  });
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      el('limit').value = chip.dataset.limit;
      updateActionState();
    });
  });
  el('init-btn').addEventListener('click', doInit);
  el('limit').addEventListener('input', updateActionState);
  el('refresh').addEventListener('click', refreshDevices);

  el('theme').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('qt_theme', next);
  });

  el('lang').addEventListener('click', () => {
    state.lang = state.lang === 'fr' ? 'en' : 'fr';
    localStorage.setItem('qt_lang', state.lang);
    applyI18n();
    renderDevices();
    if (state.status) renderStatus(state.status);
    updateActionState();
  });
}

async function main() {
  initTheme();
  const storedLang = localStorage.getItem('qt_lang');
  const nav = (navigator.language || 'fr').slice(0, 2);
  state.lang = storedLang === 'en' || storedLang === 'fr' ? storedLang : nav === 'en' ? 'en' : 'fr';
  applyI18n();
  wireEvents();

  try {
    state.meta = await invoke('meta');
    if (!state.meta.keyPresent) {
      showBanner(t('bannerNoKey'), 'error');
    }
  } catch (error) {
    showBanner(error.message, 'error');
  }

  try {
    await loadDevices();
  } catch (error) {
    showBanner(error.message, 'error');
  }
  updateActionState();
}

main();
