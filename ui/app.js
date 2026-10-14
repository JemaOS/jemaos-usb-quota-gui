// Copyright (c) 2026 The JemaOS Authors. All rights reserved.
'use strict';

const state = { devices: [], selected: null, meta: null };

const el = (id) => document.getElementById(id);

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function fmtSize(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1e9;
  return gb >= 1000 ? `${(gb / 1000).toFixed(1)} To` : `${gb.toFixed(1)} Go`;
}

function showBanner(message, kind = 'warn') {
  const banner = el('banner');
  banner.textContent = message;
  banner.className = `banner ${kind}`;
}

function hideBanner() {
  el('banner').className = 'banner hidden';
}

function renderDevices() {
  const list = el('device-list');
  list.innerHTML = '';
  if (state.devices.length === 0) {
    list.innerHTML = '<div class="empty">Aucun disque détecté.</div>';
    return;
  }
  const usable = state.devices.filter(d => d.partitions.some(p => p.esp));
  const ordered = [...usable, ...state.devices.filter(d => !d.partitions.some(p => p.esp))];

  for (const disk of ordered) {
    const hasEsp = disk.partitions.some(p => p.esp);
    const row = document.createElement('div');
    row.className = `device${hasEsp ? '' : ' disabled'}${state.selected === disk.id ? ' selected' : ''}`;
    const label = disk.model || disk.name || disk.id;
    row.innerHTML = `
      <span class="dot"></span>
      <span>
        <span class="name">${label}</span>
        <span class="meta">${disk.id} · ${fmtSize(disk.size)}${disk.transport ? ' · ' + disk.transport : ''}</span>
      </span>
      <span class="tag ${hasEsp ? 'usb' : 'noesp'}">${hasEsp ? 'ESP' : 'aucune ESP'}</span>`;
    if (hasEsp) {
      row.addEventListener('click', () => selectDevice(disk.id));
    }
    list.appendChild(row);
  }
}

async function selectDevice(id) {
  state.selected = id;
  renderDevices();
  updateActionState();
  hideBanner();
  try {
    const status = await api('/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: id }),
    });
    renderStatus(status);
  } catch (error) {
    renderStatusError(error.message);
  }
}

function renderStatus(status) {
  const card = el('status-card');
  card.classList.remove('hidden');
  el('status-badge').className = 'step ok';
  el('status-title').textContent = status.present ? 'Quota actuel' : 'Aucun quota';
  const grid = el('status-grid');
  if (!status.present) {
    grid.innerHTML = '<dt>Aucun compteur</dt><dd class="bad">non initialisé</dd>';
    return;
  }
  grid.innerHTML = `
    <dt>ESP</dt><dd>${status.esp}</dd>
    <dt>Limite</dt><dd>${status.limit}</dd>
    <dt>Utilisées</dt><dd>${status.used}</dd>
    <dt>Signature</dt><dd class="${status.valid ? 'good' : 'bad'}">${status.valid ? 'valide' : 'invalide'}</dd>`;
}

function renderStatusError(message) {
  const card = el('status-card');
  card.classList.remove('hidden');
  el('status-title').textContent = 'Erreur';
  el('status-grid').innerHTML = `<dt>Détail</dt><dd class="bad">${message}</dd>`;
}

function updateActionState() {
  const btn = el('init-btn');
  const hint = el('action-hint');
  const elevated = state.meta && state.meta.elevated;
  const ready = state.selected && elevated;
  btn.disabled = !ready;
  if (!state.meta || !state.meta.elevated) {
    hint.textContent = 'Autorisations administrateur requises pour écrire sur la clé.';
  } else if (!state.selected) {
    hint.textContent = 'Sélectionne une clé pour continuer.';
  } else {
    hint.textContent = 'Prêt à écrire le compteur signé.';
  }
}

function currentLimit() {
  const n = Number.parseInt(el('limit').value, 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

async function doInit() {
  const limit = currentLimit();
  if (limit === null || !state.selected) return;
  const btn = el('init-btn');
  btn.classList.add('busy');
  btn.disabled = true;
  btn.textContent = 'Initialisation…';
  try {
    const result = await api('/api/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: state.selected, limit }),
    });
    showBanner(`Clé initialisée : ${result.limit} installations (0 utilisée), signature valide.`, 'ok');
    await selectDevice(state.selected);
  } catch (error) {
    showBanner(error.message, 'error');
  } finally {
    btn.classList.remove('busy');
    btn.textContent = 'Initialiser la clé';
    updateActionState();
  }
}

function wireEvents() {
  el('limit-dec').addEventListener('click', () => {
    const n = currentLimit() ?? 0;
    el('limit').value = Math.max(0, n - 1);
  });
  el('limit-inc').addEventListener('click', () => {
    const n = currentLimit() ?? 0;
    el('limit').value = n + 1;
  });
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      el('limit').value = chip.dataset.limit;
    });
  });
  el('init-btn').addEventListener('click', doInit);
}

async function main() {
  wireEvents();
  try {
    state.meta = await api('/api/meta');
    el('platform-pill').textContent = state.meta.platform;
    if (state.meta.needsElevation && !state.meta.elevated) {
      showBanner('Lance l’application avec les droits administrateur (sudo / UAC) pour pouvoir monter et écrire sur la clé.');
    }
    if (!state.meta.keyPresent) {
      showBanner('Clé HMAC (jemaos-quota.key) introuvable — impossible de signer.', 'error');
    }
  } catch (error) {
    showBanner(error.message, 'error');
  }
  try {
    const { devices } = await api('/api/devices');
    state.devices = devices;
    renderDevices();
  } catch (error) {
    showBanner(error.message, 'error');
  }
  updateActionState();
}

main();
