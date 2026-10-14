// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
'use strict';

const I18N = {
  fr: {
    title: 'Quota JemaOS',
    subtitle: 'Provisionner le quota d’installation signé sur une clé USB',
    langToggle: 'EN',
    step1: 'Choisir la clé USB',
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
    bannerNoKey: 'Clé HMAC (jemaos-quota.key) introuvable — impossible de signer.',
    initOk: 'Clé initialisée : {limit} installations (0 utilisée), signature valide.',
  },
  en: {
    title: 'JemaOS Quota',
    subtitle: 'Provision the signed installation quota on a USB key',
    langToggle: 'FR',
    step1: 'Choose the USB key',
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
    bannerNoKey: 'HMAC key (jemaos-quota.key) not found — cannot sign.',
    initOk: 'Key initialized: {limit} installs (0 used), valid signature.',
  },
};

const state = { devices: [], selected: null, meta: null, status: null, lang: 'fr' };

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

// ---- api -----------------------------------------------------------------
async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
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
    row.innerHTML = `
      <span class="dot"></span>
      <span>
        <span class="name">${disk.model || disk.name || disk.id}</span>
        <span class="meta">${disk.id}${fmtSize(disk.size) ? ' · ' + fmtSize(disk.size) : ''}${disk.transport ? ' · ' + disk.transport : ''}</span>
      </span>
      <span class="tag ${esp ? '' : 'noesp'}">${esp ? t('tagEsp') : t('tagNoEsp')}</span>`;
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
    state.status = await api('/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: id }),
    });
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
  const grid = el('status-grid');
  if (!status.present) {
    grid.innerHTML = `<dt>${t('noCount')}</dt><dd class="bad">${t('notInit')}</dd>`;
    return;
  }
  grid.innerHTML = `
    <dt>${t('fieldEsp')}</dt><dd>${status.esp}</dd>
    <dt>${t('fieldLimit')}</dt><dd>${status.limit}</dd>
    <dt>${t('fieldUsed')}</dt><dd>${status.used}</dd>
    <dt>${t('fieldSig')}</dt><dd class="${status.valid ? 'good' : 'bad'}">${status.valid ? t('valid') : t('invalid')}</dd>`;
}

function renderStatusError(message) {
  const card = el('status-card');
  card.classList.remove('hidden');
  el('status-title').textContent = t('statusError');
  el('status-grid').innerHTML = `<dt>${t('error')}</dt><dd class="bad">${message}</dd>`;
}

// ---- actions -------------------------------------------------------------
function updateActionState() {
  const btn = el('init-btn');
  const hint = el('action-hint');
  const platform = state.meta ? state.meta.platform : null;
  const elevated = Boolean(state.meta && state.meta.elevated);
  const canElevate = platform !== 'win32';
  btn.disabled = !(state.selected && (elevated || canElevate));

  if (!state.selected) hint.textContent = t('hintSelect');
  else if (!elevated && !canElevate) hint.textContent = t('hintAdmin');
  else if (!elevated) hint.textContent = t('hintElevate');
  else hint.textContent = t('hintReady');
}

function currentLimit() {
  const n = Number.parseInt(el('limit').value, 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

async function doInit() {
  const limit = currentLimit();
  if (limit === null || !state.selected) return;
  const btn = el('init-btn');
  btn.disabled = true;
  btn.textContent = t('initBusy');
  try {
    const result = await api('/api/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: state.selected, limit }),
    });
    showBanner(t('initOk', { limit: result.limit }), 'ok');
    await selectDevice(state.selected);
  } catch (error) {
    showBanner(error.message, 'error');
  } finally {
    btn.textContent = t('initBtn');
    updateActionState();
  }
}

// ---- wiring --------------------------------------------------------------
function wireEvents() {
  el('limit-dec').addEventListener('click', () => {
    el('limit').value = Math.max(0, (currentLimit() ?? 0) - 1);
  });
  el('limit-inc').addEventListener('click', () => {
    el('limit').value = (currentLimit() ?? 0) + 1;
  });
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      el('limit').value = chip.dataset.limit;
    });
  });
  el('init-btn').addEventListener('click', doInit);

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
    state.meta = await api('/api/meta');
    if (state.meta.needsElevation && !state.meta.elevated && state.meta.platform === 'win32') {
      showBanner(t('bannerAdmin'));
    }
    if (!state.meta.keyPresent) {
      showBanner(t('bannerNoKey'), 'error');
    }
  } catch (error) {
    showBanner(error.message, 'error');
  }

  try {
    const { devices } = await api('/api/devices');
    state.devices = devices;
    renderDevices();
    // Auto-select the most likely key (removable USB with an ESP) so the user
    // only has to set the limit and click. Falls back to any disk with an ESP.
    if (!state.selected) {
      const pick =
        state.devices.find(d => d.removable && d.partitions.some(p => p.esp)) ||
        state.devices.find(d => d.partitions.some(p => p.esp));
      if (pick) {
        await selectDevice(pick.id);
      }
    }
  } catch (error) {
    showBanner(error.message, 'error');
  }
  updateActionState();
}

main();
