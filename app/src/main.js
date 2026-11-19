// adbcp window: two file panes (this Mac, the phone) and a transfer bar. Copies are run
// by the adbcp engine through the Rust side; its JSON events ("start", "plan",
// "progress", ...) drive the transfer bar. See ../../docs/app-spec.md.
'use strict';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const $ = (id) => document.getElementById(id);

const ui = {
  device: $('device'), refresh: $('refresh'), deviceNote: $('device-note'), openSettings: $('open-settings'),
  summary: $('summary'), bar: $('bar'), stats: $('stats'), result: $('result'), queueInfo: $('queue-info'),
  retry: $('retry'), safeNames: $('safe-names'), cancel: $('cancel'),
  problems: $('problems'), problemsTitle: $('problems-title'), problemList: $('problem-list'), log: $('log'),
  settings: $('settings'), closeSettings: $('close-settings'),
  verify: $('verify'), conflicts: $('conflicts'), showHidden: $('show-hidden'),
  tuning: $('tuning'), measure: $('measure'), adbInfo: $('adb-info'),
  streams: $('streams'), compression: $('compression'), split: $('split'),
  partSize: $('part-size'), splitMin: $('split-min'), fixNames: $('fix-names'),
  burst: $('burst'), libusb: $('libusb'), force: $('force'),
  dialog: $('dialog'), dialogTitle: $('dialog-title'), dialogText: $('dialog-text'), dialogList: $('dialog-list'),
  dialogInput: $('dialog-input'), dialogError: $('dialog-error'), dialogButtons: $('dialog-buttons'),
  ghost: $('drag-ghost'),
  wifi: $('wifi'), wifiSheet: $('wifi-sheet'), wifiClose: $('wifi-close'), wifiQr: $('wifi-qr'),
  wifiStatus: $('wifi-status'), wifiAddr: $('wifi-addr'), wifiPin: $('wifi-pin'), wifiPair: $('wifi-pair'),
  wifiList: $('wifi-list'),
};

const PHONE_PLACES = [
  ['Internal storage', '/sdcard'], ['Download', '/sdcard/Download'], ['DCIM', '/sdcard/DCIM'],
  ['Pictures', '/sdcard/Pictures'], ['Movies', '/sdcard/Movies'], ['Music', '/sdcard/Music'],
  ['Documents', '/sdcard/Documents'], ['App folders (Android/data)', '/sdcard/Android/data'],
  ['App files (Android/obb)', '/sdcard/Android/obb'],
];
// Characters Android's shared storage refuses in names.
const BAD_PHONE_CHARS = /["*:<>?|\\]/;

const state = {
  devices: [],
  running: false,             // a copy is running
  measuring: false,
  queue: [],                  // copies waiting their turn
  current: null,              // the copy running now
  lastJob: null,              // the last copy started (for Retry / safe names)
  run: null,                  // what the running copy has reported so far
  profileKey: '',
  activeSide: 'mac',
  localPlaces: [],
  adb: null,                  // the engine's "adb" report: found, path, source, version
  adbMissing: false,          // no adb, and the user has not agreed to download it
  adbError: '',
  autoDownloadAdb: false,     // test hook only
};

// ---------------------------------------------------------------- formatting ---
const pad = (n) => String(n).padStart(2, '0');
function size(n) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return i ? `${n.toFixed(1)} ${units[i]}` : `${n} B`;
}
function duration(s) {
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
const num = (n) => Number(n).toLocaleString('en-US');
const plural = (n, word) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;
const basename = (p) => p.replace(/\/+$/, '').split('/').pop() || p;
function parentOf(p) {
  const i = p.replace(/\/+$/, '').lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}
const join = (dir, name) => (dir === '/' ? '' : dir.replace(/\/+$/, '')) + '/' + name;
const withSlash = (dir) => dir.replace(/\/?$/, '/');
function normalize(p) {
  p = p.trim().replace(/\/+/g, '/');
  return p.length > 1 ? p.replace(/\/$/, '') : p || '/';
}
function dateText(sec) {
  if (!sec) return '';
  const d = new Date(sec * 1000), now = new Date();
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return d.getFullYear() === now.getFullYear()
    ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${day} ${d.getFullYear()}`;
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function log(line) {
  ui.log.textContent += line + '\n';
  const lines = ui.log.textContent.split('\n');
  if (lines.length > 600) ui.log.textContent = lines.slice(-500).join('\n');
  ui.log.scrollTop = ui.log.scrollHeight;
}
function showResult(text, ok) {
  ui.result.textContent = text;
  ui.result.className = ok === undefined ? '' : ok ? 'ok' : 'bad';
}

// ------------------------------------------------------------------- dialogs ---
// dialog({ title, text, list, input, validate, buttons }) resolves with
// { button, value }. Enter presses the primary button, Esc presses "cancel".
let dialogKey = null;
function dialog({ title, text = '', list = [], input = null, validate = null, buttons }) {
  return new Promise((resolve) => {
    ui.dialogTitle.textContent = title;
    ui.dialogText.textContent = text;
    ui.dialogList.innerHTML = '';
    for (const item of list.slice(0, 12)) ui.dialogList.append(el('li', '', item));
    if (list.length > 12) ui.dialogList.append(el('li', '', `… and ${num(list.length - 12)} more`));
    ui.dialogError.textContent = '';
    ui.dialogInput.hidden = input === null;
    ui.dialogInput.value = input ?? '';
    ui.dialogButtons.innerHTML = '';
    const finish = (id) => {
      const value = ui.dialogInput.value;
      if (id !== 'cancel' && validate) {
        const problem = validate(value);
        if (problem) { ui.dialogError.textContent = problem; return; }
      }
      ui.dialog.hidden = true;
      dialogKey = null;
      resolve({ button: id, value });
    };
    for (const b of buttons) {
      const btn = el('button', b.style || '', b.label);
      btn.addEventListener('click', () => finish(b.id));
      ui.dialogButtons.append(btn);
    }
    dialogKey = (key) => {
      if (key === 'Escape') finish('cancel');
      else if (key === 'Enter') { const p = buttons.find((b) => b.primary); if (p) finish(p.id); }
    };
    ui.dialog.hidden = false;
    if (input !== null) {
      ui.dialogInput.focus();
      const dot = ui.dialogInput.value.lastIndexOf('.');
      ui.dialogInput.setSelectionRange(0, dot > 0 ? dot : ui.dialogInput.value.length);
    }
  });
}

// ----------------------------------------------------------------------- adb ---
// Google's adb is not bundled with the app. The engine finds an installed one (PATH,
// Homebrew, Android Studio); otherwise the window asks before downloading it.
const ADB_SOURCES = {
  environment: 'set with ADB', bundled: 'next to the engine', path: 'from PATH', homebrew: 'Homebrew',
  'android-sdk': 'Android Studio SDK', downloaded: 'downloaded by adbcp',
};
async function adbStatus() {
  try { return (await invoke('adb_status')).find((e) => e.event === 'adb') || { found: false }; }
  catch (err) { return { found: false }; }
}
function showAdbInfo() {
  const a = state.adb;
  ui.adbInfo.textContent = a && a.found
    ? `Google platform-tools ${a.version || ''} · ${ADB_SOURCES[a.source] || a.source} · ${a.path}`
    : 'Not installed. adbcp asks before downloading it from Google.';
}
function setPhoneMessage(text) {
  const pane = panes.phone;
  pane.path$.value = pane.path;
  pane.message = text;
  pane.entries = [];
  pane.selected.clear();
  renderPane(pane);
}

// True when adb is available, asking to download it if needed.
async function ensureAdb() {
  let a = await adbStatus();
  while (!a.found) {
    let choice = state.autoDownloadAdb ? 'download' : null;
    if (!choice) {
      ({ button: choice } = await dialog({
        title: 'adbcp needs Google’s adb',
        text: 'adbcp reaches the phone through adb, part of Google’s Android SDK Platform-Tools. ' +
          'It is not included with adbcp, and none was found on this Mac.\n\n' +
          'Download it now from Google? It is about 16 MB, downloaded once, and its signature is checked. ' +
          'By downloading it you agree to Google’s terms for the Platform-Tools.',
        buttons: [{ id: 'cancel', label: 'Not now' }, { id: 'terms', label: 'Google’s terms…' },
          { id: 'download', label: 'Download', style: 'primary', primary: true }],
      }));
    }
    if (choice === 'terms') { invoke('open_adb_terms').catch((e) => log(`adbcp: ${e}`)); continue; }
    if (choice !== 'download') {
      state.adb = a; state.adbMissing = true; state.adbError = '';
      showAdbInfo();
      return false;
    }
    state.autoDownloadAdb = false;
    setPhoneMessage('Downloading adb from Google (about 16 MB, once)…');
    ui.device.innerHTML = '';
    ui.device.append(el('option', '', 'Downloading adb…'));
    try {
      a = (await invoke('get_adb')).find((e) => e.event === 'adb') || { found: false };
      if (!a.found) throw new Error('the download did not produce a usable adb');
    } catch (err) {
      state.adb = { found: false }; state.adbMissing = true; state.adbError = String(err);
      showAdbInfo();
      return false;
    }
  }
  state.adb = a; state.adbMissing = false; state.adbError = '';
  showAdbInfo();
  return true;
}

// -------------------------------------------------------------------- phones ---
function deviceLabel(d) {
  const name = d.model || d.serial;
  if (d.state === 'unauthorized') return `${name} · allow this computer on the phone`;
  if (d.state !== 'device') return `${name} · ${d.state}`;
  if (d.connection !== 'usb') return `${name} · Wi-Fi`;
  if (!d.link_mbps) return `${name} · USB`;
  return `${name} · USB ${d.link_mbps >= 1000 ? d.link_mbps / 1000 + ' Gb/s' : d.link_mbps + ' Mb/s'}`;
}
function currentDevice() {
  return state.devices.find((d) => d.serial === ui.device.value && d.state === 'device');
}

async function refreshDevices() {
  const before = currentDevice()?.serial;
  if (!(state.adb && state.adb.found) && !(await ensureAdb())) {
    state.devices = [];
    ui.device.innerHTML = '';
    ui.device.append(el('option', '', 'adb is not installed'));
    updateControls();
    await loadPane(panes.phone, panes.phone.path);
    return;
  }
  ui.device.innerHTML = '';
  let devices = [];
  try { devices = await invoke('list_devices'); } catch (err) { log(`adbcp: ${err}`); }
  state.devices = devices;
  for (const d of devices) {
    const o = el('option', '', deviceLabel(d));
    o.value = d.serial;
    o.disabled = d.state !== 'device';
    ui.device.append(o);
  }
  const ready = devices.find((d) => d.serial === before && d.state === 'device') || devices.find((d) => d.state === 'device');
  if (ready) ui.device.value = ready.serial;
  if (!devices.length) ui.device.append(el('option', '', 'No phone found'));
  const d = currentDevice();
  ui.deviceNote.textContent = d && d.connection === 'usb' && d.link_mbps && d.link_mbps < 5000
    ? `USB 2.0 speed (${d.link_mbps} Mb/s): a USB 3 cable and port can be 5–10× faster.` : '';
  updateControls();
  await loadPane(panes.phone, panes.phone.path);
}

// --------------------------------------------------------------------- Wi-Fi ---
// Wireless debugging setup. The sheet shows a QR code that the phone scans in
// Developer options › Wireless debugging › Pair device with QR code. The phone then
// offers a pairing service named after the code; the window finds it, pairs with the
// password from the code, and connects. "Pair with a code" does the same with the
// address and 6-digit code that the phone shows.
const wifi = { open: false, name: '', password: '', timer: 0, busy: false, pairing: false, services: [], devices: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function token(n, chars) {
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  return [...a].map((x) => chars[x % chars.length]).join('');
}
function setWifiStatus(text, ok) {
  ui.wifiStatus.textContent = text;
  ui.wifiStatus.className = 'wifi-status' + (ok === true ? ' ok' : ok === false ? ' bad' : '');
}
async function wifiScan() {
  return (await invoke('wifi_scan')).filter((e) => e.event === 'wifi_service');
}
// A connect service is connected when adb lists it by address or by its mDNS name.
const wifiDeviceFor = (svc, devices) =>
  devices.find((d) => d.connection !== 'usb' && (d.serial === svc.address || d.serial.startsWith(svc.name + '.')));

async function openWifi() {
  if (!(state.adb && state.adb.found) && !(await ensureAdb())) return;
  wifi.name = 'adbcp-' + token(8, 'abcdefghijklmnopqrstuvwxyz0123456789');
  wifi.password = token(12, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  try {
    ui.wifiQr.innerHTML = await invoke('qr_svg', { text: `WIFI:T:ADB;S:${wifi.name};P:${wifi.password};;` });
  } catch (err) { ui.wifiQr.textContent = String(err); }
  setWifiStatus('Waiting for the phone to scan the code…');
  ui.wifiList.innerHTML = '';
  ui.wifiList.append(el('li', 'empty', 'Looking for phones…'));
  ui.wifiSheet.hidden = false;
  wifi.open = true;
  wifi.pairing = false;
  wifiTick();
}
function closeWifi() {
  wifi.open = false;
  clearTimeout(wifi.timer);
  ui.wifiSheet.hidden = true;
  refreshDevices();
}
async function wifiTick() {
  if (!wifi.open) return;
  if (!wifi.busy && !wifi.pairing) {
    wifi.busy = true;
    try {
      wifi.services = await wifiScan();
      wifi.devices = await invoke('list_devices');
      const mine = wifi.services.find((s) => s.kind === 'pairing' && s.name === wifi.name);
      if (mine) await pairAndConnect(mine.address, wifi.password);
      // The phone's "pairing code" screen announces its address too: fill it in.
      const other = wifi.services.find((s) => s.kind === 'pairing' && s.name !== wifi.name);
      if (other && !ui.wifiAddr.value) ui.wifiAddr.value = other.address;
      renderWifiList();
    } catch (err) {
      setWifiStatus(String(err), false);
    }
    wifi.busy = false;
  }
  if (wifi.open) wifi.timer = setTimeout(wifiTick, 1500);
}
async function pairAndConnect(address, code) {
  wifi.pairing = true;
  const ip = address.replace(/:\d+$/, '');
  try {
    setWifiStatus(`Pairing with ${address}…`);
    await invoke('wifi_op', { op: 'pair', args: [address, code] });
    setWifiStatus('Paired. Connecting…');
    // After pairing, the phone offers its connect service on the same IP address, and
    // adb often connects by itself. If it has not after a few seconds, connect directly.
    for (let i = 0; i < 20 && wifi.open; i++) {
      const services = await wifiScan();
      const devices = await invoke('list_devices');
      const svc = services.find((s) => s.kind === 'connect' && s.address.startsWith(ip + ':'));
      let dev = svc && wifiDeviceFor(svc, devices);
      if (svc && !dev && i >= 3) {
        await invoke('wifi_op', { op: 'connect', args: [svc.address] });
        dev = wifiDeviceFor(svc, await invoke('list_devices'));
      }
      if (dev) {
        setWifiStatus(`Connected: ${dev.model || dev.serial} over Wi-Fi.`, true);
        await useDevice(dev.serial);
        return;
      }
      await sleep(1000);
    }
    setWifiStatus('Paired, but the phone did not appear. Make sure Wireless debugging is still on, then press Connect below.', false);
  } catch (err) {
    setWifiStatus(`${err}`, false);
  } finally {
    wifi.pairing = false;
    // A fresh code for the next phone (a pairing code can be used once).
    wifi.name = 'adbcp-' + token(8, 'abcdefghijklmnopqrstuvwxyz0123456789');
    wifi.password = token(12, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    invoke('qr_svg', { text: `WIFI:T:ADB;S:${wifi.name};P:${wifi.password};;` })
      .then((svg) => { ui.wifiQr.innerHTML = svg; }).catch(() => {});
  }
}
// Select a phone in the toolbar and open it in the phone pane.
async function useDevice(serial) {
  await refreshDevices();
  if (state.devices.some((d) => d.serial === serial && d.state === 'device')) {
    ui.device.value = serial;
    updateControls();
    await loadPane(panes.phone, panes.phone.path);
    refreshTuning(true);
  }
}
function renderWifiList() {
  const rows = [];
  const usb = wifi.devices.filter((d) => d.connection === 'usb');
  for (const svc of wifi.services.filter((s) => s.kind === 'connect')) {
    const dev = wifiDeviceFor(svc, wifi.devices);
    // "adb-SERIAL-xxxxxx": name it after the phone if it is also on USB.
    const serial = (svc.name.match(/^adb-(.+)-[^-]+$/) || [])[1];
    const model = dev?.model || usb.find((d) => d.serial === serial)?.model || serial || svc.name;
    rows.push({ model, address: svc.address, dev, svc });
  }
  for (const d of wifi.devices.filter((x) => x.connection !== 'usb')) {
    if (!rows.some((r) => r.dev && r.dev.serial === d.serial)) rows.push({ model: d.model || d.serial, address: d.serial, dev: d });
  }
  ui.wifiList.innerHTML = '';
  if (!rows.length) {
    ui.wifiList.append(el('li', 'empty', 'No phone with Wireless debugging found on this network yet.'));
    return;
  }
  for (const r of rows) {
    const li = el('li');
    const text = el('div', 'grow');
    text.append(el('div', '', r.model), el('div', 'sub',
      `${r.address} · ${r.dev ? (r.dev.state === 'device' ? 'connected' : r.dev.state) : 'not connected'}`));
    const btn = el('button', '', r.dev ? 'Disconnect' : 'Connect');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        if (r.dev) {
          await invoke('wifi_op', { op: 'disconnect', args: [r.dev.serial] });
          setWifiStatus(`Disconnected ${r.model}.`);
        } else {
          setWifiStatus(`Connecting to ${r.address}…`);
          await invoke('wifi_op', { op: 'connect', args: [r.address] });
          setWifiStatus(`Connected: ${r.model} over Wi-Fi.`, true);
          await useDevice(r.address);
        }
      } catch (err) {
        setWifiStatus(`${err}\nIf this phone was never paired with this Mac, scan the QR code first.`, false);
      }
      wifi.devices = await invoke('list_devices').catch(() => wifi.devices);
      renderWifiList();
    });
    li.append(text, btn);
    ui.wifiList.append(li);
  }
}
async function pairWithCode() {
  const address = ui.wifiAddr.value.trim();
  const code = ui.wifiPin.value.trim();
  if (!/^(\d{1,3}\.){3}\d{1,3}:\d+$|^\[[0-9a-fA-F:]+\]:\d+$/.test(address)) {
    setWifiStatus('Enter the IP address and port shown on the phone, for example 192.168.1.23:37123.', false); return;
  }
  if (!/^\d{6}$/.test(code)) { setWifiStatus('Enter the 6-digit code shown on the phone.', false); return; }
  if (wifi.pairing) return;
  ui.wifiPair.disabled = true;
  await pairAndConnect(address, code);
  ui.wifiPair.disabled = false;
  ui.wifiPin.value = '';
}

// --------------------------------------------------------------------- panes ---
function makePane(side) {
  const root = $(`pane-${side}`);
  const q = (s) => root.querySelector(s);
  return {
    side, root,
    list: q('.entries'), path$: q('.path'), places: q('.places'), up: q('.up'), reload: q('.reload'),
    mkdir: q('.mkdir'), rename: q('.rename'), del: q('.delete'), copy: q('.copy'),
    selInfo: q('.sel-info'), hint: q('.drop-hint'), heads: [...root.querySelectorAll('.list-head button')],
    path: '', entries: [], shown: [], selected: new Set(), anchor: -1,
    sort: { key: 'name', dir: 1 }, message: '', loadSeq: 0,
  };
}
const panes = { mac: makePane('mac'), phone: makePane('phone') };
const other = (side) => (side === 'mac' ? 'phone' : 'mac');

async function listFolder(side, path) {
  if (side === 'mac') return invoke('list_local', { path });
  const d = currentDevice();
  if (!d) throw new Error('no phone');
  return invoke('list_dir', { serial: d.serial, path });
}

async function loadPane(pane, path, { keepSelection = false } = {}) {
  path = normalize(path || '/');
  const seq = ++pane.loadSeq;
  pane.path$.value = path;
  if (pane.side === 'phone' && !currentDevice()) {
    pane.path = path;
    pane.entries = [];
    pane.message = state.adbMissing
      ? (state.adbError ? `Downloading adb failed: ${state.adbError}\n\n` : '') +
        'adbcp needs Google’s adb to reach the phone.\nPress Refresh to download it from Google, or install it yourself (for example with Homebrew: brew install android-platform-tools) and press Refresh.'
      : state.devices.length
        ? 'The phone is not ready.\nUnlock it and allow this computer when it asks, then press Refresh.'
        : 'No phone found.\nConnect it with a USB cable, turn on USB debugging (Settings › Developer options), allow this computer when the phone asks, then press Refresh.\nOr press Wi-Fi… to connect over Wi-Fi (Wireless debugging).';
    pane.selected.clear();
    renderPane(pane);
    return;
  }
  let entries;
  try {
    entries = await listFolder(pane.side, path);
  } catch (err) {
    if (seq !== pane.loadSeq) return;
    pane.message = `Cannot open ${path}:\n${err}`;
    pane.entries = [];
    pane.path = path;
    pane.selected.clear();
    renderPane(pane, true);
    return;
  }
  if (seq !== pane.loadSeq) return;     // a newer folder was opened meanwhile
  if (path !== pane.path || !keepSelection) pane.selected.clear();
  pane.path = path;
  pane.message = '';
  pane.entries = entries;
  for (const p of [...pane.selected]) if (!entries.some((e) => e.path === p)) pane.selected.delete(p);
  renderPane(pane);
  saveSettingsSoon();
  if (pane.side === 'phone') refreshTuning();
}

function sortedEntries(pane) {
  const { key, dir } = pane.sort;
  return pane.entries
    .filter((e) => ui.showHidden.checked || !e.name.startsWith('.'))
    .sort((a, b) => {
      const da = a.type === 'dir', db = b.type === 'dir';
      if (da !== db) return da ? -1 : 1;
      let c = key === 'name' ? 0 : (a[key] || 0) - (b[key] || 0);
      if (c === 0) c = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      return c * dir;
    });
}

function renderPane(pane, isError = false) {
  pane.shown = sortedEntries(pane);
  const frag = document.createDocumentFragment();
  if (pane.message) {
    frag.append(el('li', `message${isError ? ' bad' : ''}`, pane.message));
  } else if (!pane.shown.length) {
    frag.append(el('li', 'message', 'This folder is empty.'));
  }
  pane.shown.forEach((e, i) => {
    const li = el('li', `row ${e.type}${pane.selected.has(e.path) ? ' selected' : ''}`);
    li.dataset.index = i;
    li.append(el('span', 'name', e.name), el('span', 'size', e.type === 'file' ? size(e.size) : '—'), el('span', 'date', dateText(e.mtime)));
    frag.append(li);
  });
  pane.list.innerHTML = '';
  pane.list.append(frag);
  for (const h of pane.heads) {
    h.classList.toggle('sorted', h.dataset.sort === pane.sort.key);
    h.classList.toggle('desc', h.dataset.sort === pane.sort.key && pane.sort.dir < 0);
  }
  updatePaneControls(pane);
}

function renderSelection(pane) {
  for (const li of pane.list.querySelectorAll('li.row')) {
    li.classList.toggle('selected', pane.selected.has(pane.shown[li.dataset.index].path));
  }
  updatePaneControls(pane);
}

function selectedEntries(pane) {
  return pane.shown.filter((e) => pane.selected.has(e.path));
}

function updatePaneControls(pane) {
  const sel = selectedEntries(pane);
  const files = sel.filter((e) => e.type === 'file');
  const bytes = files.reduce((s, e) => s + e.size, 0);
  pane.selInfo.textContent = sel.length
    ? `${plural(sel.length, 'item')} selected${files.length ? ` · ${size(bytes)}` : ''}`
    : pane.message ? '' : plural(pane.shown.length, 'item');
  const ready = pane.side === 'mac' || !!currentDevice();
  const fileOpsOk = ready && !state.running && !state.measuring && !pane.message;
  pane.mkdir.disabled = !fileOpsOk;
  pane.rename.disabled = !fileOpsOk || sel.length !== 1;
  pane.del.disabled = !fileOpsOk || !sel.length;
  pane.up.disabled = !ready || pane.path === '/';
  pane.reload.disabled = pane.path$.disabled = pane.places.disabled = !ready;
  pane.copy.disabled = !sel.length || !currentDevice() || state.measuring;
}

function setActive(side) {
  state.activeSide = side;
  panes.mac.root.classList.toggle('active', side === 'mac');
  panes.phone.root.classList.toggle('active', side === 'phone');
}

function openEntry(pane, e) {
  if (e.type === 'dir') loadPane(pane, e.path);
}

function clickRow(pane, index, ev) {
  const e = pane.shown[index];
  if (!e) return;
  if (ev.shiftKey && pane.anchor >= 0) {
    const [a, b] = [Math.min(pane.anchor, index), Math.max(pane.anchor, index)];
    if (!ev.metaKey) pane.selected.clear();
    for (let i = a; i <= b; i++) pane.selected.add(pane.shown[i].path);
  } else if (ev.metaKey) {
    pane.selected.has(e.path) ? pane.selected.delete(e.path) : pane.selected.add(e.path);
    pane.anchor = index;
  } else {
    pane.selected.clear();
    pane.selected.add(e.path);
    pane.anchor = index;
  }
  renderSelection(pane);
}

function fillPlaces(pane, places) {
  pane.places.innerHTML = '';
  const head = el('option', '', 'Places');
  head.value = '';
  pane.places.append(head);
  for (const [name, path] of places) {
    const o = el('option', '', name);
    o.value = path;
    pane.places.append(o);
  }
}

// ----------------------------------------------------------- file operations ---
function nameProblem(side, dir, name) {
  if (!name.trim()) return 'Enter a name.';
  if (name.includes('/')) return 'Names cannot contain /.';
  if (name.trim() === '.' || name.trim() === '..') return 'That name is not allowed.';
  if (side === 'phone' && destKind(dir) === 'media' && BAD_PHONE_CHARS.test(name)) {
    return 'The phone does not allow these characters in names: " * : < > ? | \\';
  }
  return '';
}

async function newFolder(pane) {
  if (pane.mkdir.disabled) return;
  const { button, value } = await dialog({
    title: 'New folder', text: `In ${pane.path}`, input: 'New folder',
    validate: (v) => nameProblem(pane.side, pane.path, v) ||
      (pane.entries.some((e) => e.name === v.trim()) ? 'Something with that name already exists here.' : ''),
    buttons: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: 'Create', style: 'primary', primary: true }],
  });
  if (button !== 'ok') return;
  const path = join(pane.path, value.trim());
  try {
    if (pane.side === 'mac') await invoke('local_mkdir', { path });
    else await invoke('phone_op', { serial: currentDevice().serial, op: 'mkdir', paths: [path] });
    await loadPane(pane, pane.path);
    pane.selected = new Set([path]);
    renderSelection(pane);
  } catch (err) {
    showResult(`Could not create the folder: ${err}`, false);
  }
}

async function renameItem(pane) {
  if (pane.rename.disabled) return;
  const [e] = selectedEntries(pane);
  const { button, value } = await dialog({
    title: `Rename “${e.name}”`, input: e.name,
    validate: (v) => nameProblem(pane.side, pane.path, v) ||
      (v.trim() !== e.name && pane.entries.some((x) => x.name === v.trim()) ? 'Something with that name already exists here.' : ''),
    buttons: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: 'Rename', style: 'primary', primary: true }],
  });
  if (button !== 'ok' || value.trim() === e.name) return;
  const to = join(pane.path, value.trim());
  try {
    if (pane.side === 'mac') await invoke('local_rename', { from: e.path, to });
    else await invoke('phone_op', { serial: currentDevice().serial, op: 'rename', paths: [e.path, to] });
    await loadPane(pane, pane.path);
    pane.selected = new Set([to]);
    renderSelection(pane);
  } catch (err) {
    showResult(`Could not rename: ${err}`, false);
  }
}

async function deleteItems(pane) {
  if (pane.del.disabled) return;
  const sel = selectedEntries(pane);
  const names = sel.map((e) => e.name + (e.type === 'dir' ? '/' : ''));
  const phone = pane.side === 'phone';
  const { button } = await dialog({
    title: phone ? `Delete ${plural(sel.length, 'item')} from the phone?` : `Move ${plural(sel.length, 'item')} to the Trash?`,
    text: phone ? 'This cannot be undone: the phone has no trash for adb. Folders are deleted with everything inside.'
      : 'You can put them back from the Trash.',
    list: names,
    buttons: [{ id: 'cancel', label: 'Cancel', primary: true },
      { id: 'ok', label: phone ? 'Delete' : 'Move to Trash', style: phone ? 'danger' : 'primary' }],
  });
  if (button !== 'ok') return;
  try {
    const paths = sel.map((e) => e.path);
    if (phone) await invoke('phone_op', { serial: currentDevice().serial, op: 'delete', paths });
    else await invoke('local_trash', { paths });
    showResult(phone ? `Deleted ${plural(sel.length, 'item')} from the phone.` : `Moved ${plural(sel.length, 'item')} to the Trash.`);
  } catch (err) {
    showResult(`Could not delete: ${err}`, false);
  }
  await loadPane(pane, pane.path);
}

// ------------------------------------------------------------------- copying ---
async function namesIn(side, dir) {
  const pane = panes[side];
  if (normalize(dir) === pane.path && !pane.message) return new Set(pane.entries.map((e) => e.name));
  try { return new Set((await listFolder(side, dir)).map((e) => e.name)); } catch (_) { return new Set(); }
}

// Copies `sources` (on side `from`) into folder `destDir` on the other side.
async function copyItems(from, sources, destDir) {
  if (!sources.length) return;
  if (!currentDevice()) { showResult('Connect a phone first.', false); return; }
  const to = other(from);
  destDir = normalize(destDir);
  const existing = await namesIn(to, destDir);
  const clashes = sources.map(basename).filter((n) => existing.has(n));
  let skipExisting = false;
  if (clashes.length) {
    let choice = ui.conflicts.value;
    if (choice === 'ask') {
      const { button } = await dialog({
        title: `${plural(clashes.length, 'item')} already ${clashes.length === 1 ? 'exists' : 'exist'} in ${basename(destDir) || destDir}`,
        text: 'Replace overwrites them. Skip existing leaves files that are already there with the same size and copies the rest.',
        list: clashes,
        buttons: [{ id: 'cancel', label: 'Cancel' }, { id: 'skip', label: 'Skip existing' },
          { id: 'replace', label: 'Replace', style: 'primary', primary: true }],
      });
      if (button === 'cancel') return;
      choice = button;
    }
    skipExisting = choice === 'skip';
  }
  const where = to === 'phone' ? 'the phone' : 'this Mac';
  enqueue({
    pull: from === 'phone', sources, dest: withSlash(destDir), destSide: to, skipExisting, fixNames: false,
    label: `Copying ${sources.length === 1 ? `“${basename(sources[0])}”` : plural(sources.length, 'item')} to ${destDir} on ${where}`,
  });
}

function copySelection(from) {
  const pane = panes[from];
  copyItems(from, selectedEntries(pane).map((e) => e.path), panes[other(from)].path);
}

function enqueue(job) {
  state.queue.push(job);
  renderQueueInfo();
  startNext();
}

function renderQueueInfo() {
  ui.queueInfo.textContent = state.queue.length ? `${plural(state.queue.length, 'copy')} waiting` : '';
}

function resetStatus() {
  state.run = { problems: 0, nameProblems: 0, otherProblems: 0, renamed: 0, done: null, verify: null, error: null };
  showResult('');
  ui.bar.style.width = '0';
  ui.bar.classList.remove('busy');
  ui.problemList.innerHTML = '';
  ui.problems.hidden = true;
  ui.retry.hidden = ui.safeNames.hidden = true;
  ui.log.textContent = '';
}

async function startNext() {
  if (state.running || state.measuring) return;
  const job = state.queue.shift();
  renderQueueInfo();
  if (!job) return;
  const d = currentDevice();
  if (!d) { state.queue = []; renderQueueInfo(); showResult('The phone is no longer connected.', false); return; }
  state.current = state.lastJob = job;
  resetStatus();
  state.running = true;
  updateControls();
  ui.summary.textContent = job.label;
  ui.stats.textContent = 'Starting…';
  const req = {
    serial: d.serial,
    pull: job.pull,
    sources: job.sources,
    dest: job.dest,
    verify: ui.verify.checked,
    skipExisting: job.skipExisting,
    streams: ui.streams.value ? Number(ui.streams.value) : null,
    compression: ui.compression.value,
    split: ui.split.value === '1',
    // Sizes are passed only when changed: an explicit size keeps splitting on even where
    // the engine would switch it off by itself (USB 2.0).
    partSizeMib: ui.partSize.value !== '128' ? Number(ui.partSize.value) : null,
    splitMinMib: ui.splitMin.value !== '256' ? Number(ui.splitMin.value) : null,
    fixNames: !job.pull && (job.fixNames || ui.fixNames.checked),
    burst: ui.burst.checked,
    libusb: ui.libusb.checked,
    force: ui.force.checked,
  };
  try {
    await invoke('start_copy', { req });
  } catch (err) {
    state.running = false;
    state.current = null;
    ui.stats.textContent = 'Ready.';
    showResult(String(err), false);
    updateControls();
    startNext();
  }
}

const safeName = (path) => path.replace(/["*:<>?|\\]/g, '_');

function addProblem(path, why, kind = 'other') {
  state.run.problems++;
  if (kind === 'name') state.run.nameProblems++; else state.run.otherProblems++;
  const li = el('li');
  li.append(el('span', 'path', path), el('span', 'why', why));
  if (kind === 'name') li.append(el('span', 'path', `With safe names it would be copied as ${basename(safeName(path))}`));
  ui.problemList.append(li);
  ui.problemsTitle.textContent = `Problems (${state.run.problems})`;
  ui.problems.hidden = false;
}

function planText(e) {
  const parts = [];
  if (e.large_files) parts.push(`${plural(e.large_files, 'large file')} on ${plural(e.streams, 'parallel transfer')}`);
  if (e.split_files) parts.push(`${plural(e.split_files, 'file')} split into parts`);
  if (e.small_files) parts.push(`${plural(e.small_files, 'small file')} in ${plural(e.small_jobs, 'group')}`);
  return parts.join(', ');
}

const VERIFY_PROBLEMS = {
  missing: 'The copy is missing or cannot be read.',
  unreadable: 'The original cannot be read.',
  different: 'The copy is different from the original.',
};

function onEvent(e) {
  const r = state.run;
  if (!r) return;
  switch (e.event) {
    case 'start':
      ui.summary.textContent = `${state.current?.label || 'Copying'} · ${plural(e.files, 'file')}, ${size(e.bytes)}`;
      break;
    case 'skip':
      log(`Skipping ${plural(e.files, 'file')} already there.`);
      break;
    case 'resume':
      log(`Resuming ${plural(e.files, 'file')} sent in parts earlier: ${size(e.bytes)} is already there.`);
      ui.summary.textContent += `\nResuming ${plural(e.files, 'file')} (${size(e.bytes)} already there)`;
      break;
    case 'calibration':
      log(`Measured this phone: ${plural(e.streams, 'parallel transfer')} for large files.`);
      ui.stats.textContent = 'Measured this phone. Starting the copy…';
      break;
    case 'compression_test':
      log(`Compression test: ${Object.entries(e.mib_per_second).map(([k, v]) => `${k} ${v} MiB/s`).join(', ')} → ${e.choice}`);
      break;
    case 'plan':
      ui.summary.textContent += `\n${planText(e)} · compression: ${e.compression === 'none' ? 'off' : e.compression} · ${e.tuning}`;
      break;
    case 'progress': {
      const pct = e.bytes_total ? Math.floor((e.bytes_done * 100) / e.bytes_total) : 100;
      ui.bar.style.width = `${pct}%`;
      const left = e.seconds_left == null ? 'estimating…' : `about ${duration(e.seconds_left)} left`;
      ui.stats.textContent = `${pct}% · ${size(e.bytes_done)} of ${size(e.bytes_total)} · ${size(e.bytes_per_second)}/s · ${left} · ${num(e.files_done)} of ${plural(e.files_total, 'file')}${e.files_failed ? ` · ${num(e.files_failed)} failed` : ''}`;
      break;
    }
    case 'file_failed':
      addProblem(e.path, e.error, e.reason === 'name_not_allowed' ? 'name' : 'other');
      break;
    case 'renamed':
      r.renamed++;
      log(`Renamed for the phone: ${e.from} → ${basename(e.to)}`);
      break;
    case 'done':
      r.done = e;
      ui.bar.style.width = '100%';
      ui.stats.textContent = `Copied ${plural(e.files_copied, 'file')}, ${size(e.bytes)} in ${duration(e.seconds)}${e.seconds > 0 ? ` (${size(e.bytes_per_second)}/s)` : ''}.`;
      break;
    case 'verify_start':
      ui.bar.classList.add('busy');
      ui.stats.textContent += ` Verifying ${plural(e.files, 'file')}…`;
      break;
    case 'verify_problem':
      addProblem(e.path, VERIFY_PROBLEMS[e.problem] || e.problem);
      break;
    case 'verify_done':
      r.verify = e;
      ui.bar.classList.remove('busy');
      ui.stats.textContent = ui.stats.textContent.replace(/ Verifying .*$/, '') + (e.problems
        ? ` Verification found ${plural(e.problems, 'problem')}.`
        : ` Verified: all ${plural(e.files, 'file')} match.`);
      break;
    case 'warning':
      log(`Warning: ${e.message}`);
      break;
    case 'error':
      r.error = e.message;
      break;
  }
}

function onExit(code) {
  const r = state.run || {};
  const job = state.current;
  state.running = false;
  state.current = null;
  ui.bar.classList.remove('busy');
  let text, ok = false;
  if (code === 130) {
    text = 'Cancelled. Files that finished copying are kept; partly copied files were removed.';
  } else if (code === 0) {
    ok = true;
    text = r.done ? `Done: ${plural(r.done.files_copied, 'file')} copied.` : 'Done.';
    if (r.verify) text += ` All ${plural(r.verify.files, 'file')} verified.`;
    if (r.renamed) text += ` ${plural(r.renamed, 'file')} got safe names (see Details).`;
  } else if (r.done || r.verify) {
    // Names the phone does not allow are reported, never retried as they are:
    // "Copy with safe names" copies just those, with the characters replaced.
    const parts = [];
    if (r.otherProblems) parts.push(`${plural(r.otherProblems, 'file')} could not be copied or failed verification.`);
    if (r.nameProblems) parts.push(`${plural(r.nameProblems, 'file')} ${r.nameProblems === 1 ? 'has a name' : 'have names'} the phone does not allow.`);
    text = parts.join(' ') + ' See Problems.';
    ui.retry.hidden = !r.otherProblems;
    ui.safeNames.hidden = !r.nameProblems;
  } else {
    text = r.error || `The copy stopped unexpectedly (code ${code}). See Details.`;
    $('details').open = true;
  }
  showResult(text, ok);
  updateControls();
  // Show the result in both panes, then run the next waiting copy.
  if (job) {
    loadPane(panes.mac, panes.mac.path, { keepSelection: true });
    loadPane(panes.phone, panes.phone.path, { keepSelection: true });
  }
  refreshTuning(true);
  startNext();
}

function updateControls() {
  ui.cancel.disabled = !state.running;
  ui.device.disabled = ui.refresh.disabled = state.running || state.measuring;
  ui.measure.disabled = state.running || state.measuring || !currentDevice();
  for (const p of Object.values(panes)) updatePaneControls(p);
}

// -------------------------------------------------------------------- tuning ---
function destKind(path) {
  if (/\/Android\/(data|obb)(\/|$)/.test(path)) return 'appdir';
  if (/^\/data\//.test(path)) return 'data';
  return 'media';
}
const KIND_NAMES = { media: 'shared storage', appdir: 'app folders', data: '/data' };
const numbersAt = (pairs) => Object.values(pairs || {}).join(' · ');

function showTuning(text, cls = '', title = '') {
  ui.tuning.textContent = text;
  ui.tuning.className = `grow small ${cls}`;
  ui.tuning.title = title;
}

async function refreshTuning(force = false) {
  const d = currentDevice();
  if (state.measuring) return;
  if (!d) { state.profileKey = ''; showTuning('Connect a phone to see its measurements.'); return; }
  const dest = panes.phone.path || '/sdcard';
  const key = `${d.serial}|${destKind(dest)}`;
  if (!force && key === state.profileKey) return;
  state.profileKey = key;
  try {
    const p = (await invoke('show_profile', { serial: d.serial, dest })).find((e) => e.event === 'profile');
    if (p) describeProfile(p);
  } catch (err) {
    showTuning(String(err), 'bad');
  }
}

function describeProfile(p) {
  const where = KIND_NAMES[p.kind] || p.kind;
  const fixed = ' Copies from the phone use fixed settings (8 parallel transfers).';
  if (!p.saved) {
    showTuning(`Not measured yet for this phone and ${where}. It is measured automatically before the first large copy to the phone (about 10 seconds), or now.${fixed}`);
    return;
  }
  const detail = `Large files: ${numbersAt(p.large_mib_per_second)} MiB/s on 2 · 4 · 8 transfers. ` +
    `Small files: ${numbersAt(p.small_files_per_second)} files/s on 2 · 4 · 8 transfers.`;
  showTuning(`Measured ${p.date} for ${where}: ${plural(p.streams, 'parallel transfer')} for large files, ` +
    `up to ${p.small_streams} for small files.${fixed}`, '', detail);
}

async function measureNow() {
  const d = currentDevice();
  if (!d || state.running || state.measuring) return;
  state.measuring = true;
  updateControls();
  showTuning(`Measuring this phone, cable and ${panes.phone.path} (about 10 seconds)…`, 'busy');
  try {
    const events = await invoke('measure', { serial: d.serial, dest: panes.phone.path || '/sdcard/Download' });
    const p = events.find((e) => e.event === 'profile');
    state.measuring = false;
    if (p) { describeProfile(p); state.profileKey = `${d.serial}|${p.kind}`; }
  } catch (err) {
    state.measuring = false;
    showTuning(`Measuring failed: ${err}`, 'bad');
  }
  updateControls();
  startNext();
}

// ------------------------------------------------------------------ settings ---
// Remembered between launches; "Skip the free-space check" is deliberately not.
function collectSettings() {
  return {
    macPath: panes.mac.path, phonePath: panes.phone.path,
    macSort: panes.mac.sort, phoneSort: panes.phone.sort,
    verify: ui.verify.checked, conflicts: ui.conflicts.value, showHidden: ui.showHidden.checked,
    streams: ui.streams.value, compression: ui.compression.value, split: ui.split.value,
    partSize: ui.partSize.value, splitMin: ui.splitMin.value,
    fixNames: ui.fixNames.checked, burst: ui.burst.checked, libusb: ui.libusb.checked,
  };
}
function applySettings(s) {
  if (!s || typeof s !== 'object') return;
  const set = (select, v) => { if (v != null && [...select.options].some((o) => o.value === String(v))) select.value = String(v); };
  if (typeof s.verify === 'boolean') ui.verify.checked = s.verify;
  if (typeof s.showHidden === 'boolean') ui.showHidden.checked = s.showHidden;
  set(ui.conflicts, s.conflicts);
  set(ui.streams, s.streams); set(ui.compression, s.compression); set(ui.split, s.split);
  set(ui.partSize, s.partSize); set(ui.splitMin, s.splitMin);
  for (const k of ['fixNames', 'burst', 'libusb']) if (typeof s[k] === 'boolean') ui[k].checked = s[k];
  for (const side of ['mac', 'phone']) {
    const sort = s[`${side}Sort`];
    if (sort && ['name', 'size', 'mtime'].includes(sort.key)) panes[side].sort = { key: sort.key, dir: sort.dir < 0 ? -1 : 1 };
    if (typeof s[`${side}Path`] === 'string' && s[`${side}Path`]) panes[side].path = s[`${side}Path`];
  }
}
let saveTimer = null;
let settingsLoaded = false;
function saveSettingsSoon() {
  if (!settingsLoaded) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => invoke('save_settings', { settings: collectSettings() }).catch((e) => log(`adbcp: ${e}`)), 300);
}

// ------------------------------------------------------------------ dragging ---
// Dragging between the panes is tracked with the mouse (not HTML drag and drop, which
// competes with the window's own handling of files dropped from Finder).
let drag = null;
let suppressClick = false;

function paneAt(x, y) {
  const t = document.elementFromPoint(x, y);
  const root = t && t.closest('.pane');
  return root ? panes[root.dataset.side] : null;
}
function rowAt(pane, x, y) {
  const t = document.elementFromPoint(x, y);
  const li = t && t.closest('li.row');
  return li && pane.list.contains(li) ? pane.shown[li.dataset.index] : null;
}
function showDropHint(target, text, accept) {
  for (const p of Object.values(panes)) {
    const on = p === target;
    p.hint.hidden = !on;
    if (on) { p.hint.textContent = text; p.hint.classList.toggle('refuse', !accept); }
  }
}
function clearDropMarks() {
  for (const p of Object.values(panes)) {
    p.hint.hidden = true;
    for (const li of p.list.querySelectorAll('.drop-into')) li.classList.remove('drop-into');
  }
}

// Where items dragged from side `from` would be copied to at (x, y), if anywhere.
function dragTarget(from, x, y) {
  const target = paneAt(x, y);
  if (!target || target.side === from || target.message) return null;
  const row = rowAt(target, x, y);
  return { pane: target, dir: row && row.type === 'dir' ? row.path : target.path, row };
}

document.addEventListener('mousemove', (ev) => {
  if (!drag) return;
  if (!drag.active) {
    if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 6) return;
    drag.active = true;
    ui.ghost.textContent = plural(drag.items.length, 'item');
    ui.ghost.hidden = false;
  }
  ui.ghost.style.left = `${ev.clientX + 14}px`;
  ui.ghost.style.top = `${ev.clientY + 10}px`;
  clearDropMarks();
  const t = dragTarget(drag.from, ev.clientX, ev.clientY);
  if (!t) return;
  if (t.row && t.row.type === 'dir') {
    const li = t.pane.list.querySelector(`li[data-index="${t.pane.shown.indexOf(t.row)}"]`);
    if (li) li.classList.add('drop-into');
  } else {
    showDropHint(t.pane, `Drop to copy into ${basename(t.dir) || t.dir}`, true);
  }
});

document.addEventListener('mouseup', (ev) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  ui.ghost.hidden = true;
  clearDropMarks();
  if (!d.active) return;
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
  const t = dragTarget(d.from, ev.clientX, ev.clientY);
  if (t) copyItems(d.from, d.items, t.dir);
});

// Files dragged in from Finder: only the phone pane accepts them.
listen('drag-hover', ({ payload }) => {
  if (!payload.over) { clearDropMarks(); return; }
  const target = paneAt(payload.at.x, payload.at.y);
  if (!target) { clearDropMarks(); return; }
  if (target.side === 'phone') {
    const ok = !!currentDevice();
    showDropHint(target, ok ? `Drop to copy to the phone, into ${basename(target.path) || target.path}` : 'Connect a phone first', ok);
  } else {
    showDropHint(target, 'Drop on the phone side to copy to the phone', false);
  }
});
listen('files-dropped', ({ payload }) => {
  clearDropMarks();
  const target = paneAt(payload.at.x, payload.at.y);
  if (target && target.side === 'phone' && currentDevice()) copyItems('mac', payload.paths, target.path);
});

// -------------------------------------------------------------------- wiring ---
for (const pane of Object.values(panes)) {
  pane.root.addEventListener('mousedown', () => setActive(pane.side));
  pane.list.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    const li = ev.target.closest('li.row');
    if (!li) return;
    const e = pane.shown[li.dataset.index];
    // Pressing on an unselected item selects it, so it can be dragged right away.
    if (!pane.selected.has(e.path) && !ev.metaKey && !ev.shiftKey) {
      pane.selected = new Set([e.path]);
      pane.anchor = Number(li.dataset.index);
      renderSelection(pane);
    }
    if (!ev.metaKey && !ev.shiftKey && currentDevice()) {
      drag = { from: pane.side, x: ev.clientX, y: ev.clientY, active: false, items: selectedEntries(pane).map((x) => x.path) };
    }
  });
  pane.list.addEventListener('click', (ev) => {
    if (suppressClick) return;
    const li = ev.target.closest('li.row');
    if (li) clickRow(pane, Number(li.dataset.index), ev);
    else { pane.selected.clear(); renderSelection(pane); }
  });
  pane.list.addEventListener('dblclick', (ev) => {
    const li = ev.target.closest('li.row');
    if (li) openEntry(pane, pane.shown[li.dataset.index]);
  });
  pane.up.addEventListener('click', () => loadPane(pane, parentOf(pane.path)));
  pane.reload.addEventListener('click', () => loadPane(pane, pane.path, { keepSelection: true }));
  pane.path$.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { loadPane(pane, pane.path$.value); pane.list.focus(); } });
  pane.places.addEventListener('change', () => {
    if (pane.places.value) loadPane(pane, pane.places.value);
    pane.places.value = '';
  });
  pane.mkdir.addEventListener('click', () => newFolder(pane));
  pane.rename.addEventListener('click', () => renameItem(pane));
  pane.del.addEventListener('click', () => deleteItems(pane));
  pane.copy.addEventListener('click', () => copySelection(pane.side));
  for (const h of pane.heads) {
    h.addEventListener('click', () => {
      pane.sort = pane.sort.key === h.dataset.sort ? { key: h.dataset.sort, dir: -pane.sort.dir } : { key: h.dataset.sort, dir: 1 };
      renderPane(pane);
      saveSettingsSoon();
    });
  }
}

document.addEventListener('keydown', (ev) => {
  if (!ui.dialog.hidden) {
    if (dialogKey && (ev.key === 'Escape' || ev.key === 'Enter')) { ev.preventDefault(); dialogKey(ev.key); }
    return;
  }
  if (!ui.settings.hidden) { if (ev.key === 'Escape') ui.settings.hidden = true; return; }
  if (!ui.wifiSheet.hidden) {
    if (ev.key === 'Escape') closeWifi();
    else if (ev.key === 'Enter' && (ev.target === ui.wifiAddr || ev.target === ui.wifiPin)) pairWithCode();
    return;
  }
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
  const pane = panes[state.activeSide];
  if (ev.metaKey && ev.key === 'a') { ev.preventDefault(); pane.selected = new Set(pane.shown.map((e) => e.path)); renderSelection(pane); }
  else if (ev.metaKey && ev.key === 'ArrowUp') { ev.preventDefault(); loadPane(pane, parentOf(pane.path)); }
  else if (ev.metaKey && ev.key === 'Backspace') { ev.preventDefault(); deleteItems(pane); }
  else if (ev.metaKey && ev.shiftKey && (ev.key === 'n' || ev.key === 'N')) { ev.preventDefault(); newFolder(pane); }
  else if (ev.key === 'Enter') {
    const sel = selectedEntries(pane);
    if (sel.length === 1) { ev.preventDefault(); openEntry(pane, sel[0]); }
  }
});

ui.refresh.addEventListener('click', async () => { await refreshDevices(); refreshTuning(true); });
ui.wifi.addEventListener('click', openWifi);
ui.wifiClose.addEventListener('click', closeWifi);
ui.wifiPair.addEventListener('click', pairWithCode);
ui.device.addEventListener('change', () => { updateControls(); loadPane(panes.phone, panes.phone.path); refreshTuning(true); });
ui.openSettings.addEventListener('click', () => { ui.settings.hidden = false; refreshTuning(true); });
ui.closeSettings.addEventListener('click', () => { ui.settings.hidden = true; });
ui.settings.addEventListener('mousedown', (ev) => { if (ev.target === ui.settings) ui.settings.hidden = true; });
ui.measure.addEventListener('click', measureNow);
ui.showHidden.addEventListener('change', () => { renderPane(panes.mac); renderPane(panes.phone); });
for (const c of [ui.verify, ui.conflicts, ui.showHidden, ui.streams, ui.compression, ui.split, ui.partSize, ui.splitMin, ui.fixNames, ui.burst, ui.libusb]) {
  c.addEventListener('change', () => {
    ui.partSize.disabled = ui.splitMin.disabled = ui.split.value !== '1';
    saveSettingsSoon();
  });
}
ui.cancel.addEventListener('click', async () => {
  // Cancel stops the running copy and drops the waiting ones.
  state.queue = [];
  renderQueueInfo();
  ui.stats.textContent = 'Cancelling…';
  await invoke('cancel_copy');
});
ui.retry.addEventListener('click', () => { if (state.lastJob) enqueue({ ...state.lastJob, skipExisting: true }); });
ui.safeNames.addEventListener('click', () => {
  if (state.lastJob) enqueue({ ...state.lastJob, skipExisting: true, fixNames: true, label: `${state.lastJob.label} (with safe names)` });
});

listen('engine-event', ({ payload }) => onEvent(payload));
listen('engine-log', ({ payload }) => log(payload));
listen('engine-exit', ({ payload }) => onExit(payload));

// --------------------------------------------------------------------- start ---
(async () => {
  try { applySettings(await invoke('load_settings')); } catch (err) { log(`adbcp: ${err}`); }
  settingsLoaded = true;
  ui.partSize.disabled = ui.splitMin.disabled = ui.split.value !== '1';
  try { state.localPlaces = await invoke('local_places'); } catch (_) { state.localPlaces = []; }
  fillPlaces(panes.mac, state.localPlaces);
  fillPlaces(panes.phone, PHONE_PLACES);
  const downloads = state.localPlaces.find(([n]) => n === 'Downloads');
  if (!panes.mac.path) panes.mac.path = downloads ? downloads[1] : '/';
  if (!panes.phone.path) panes.phone.path = '/sdcard/Download';
  setActive('mac');
  await loadPane(panes.mac, panes.mac.path);
  // Automated smoke tests: ADBCP_APP_AUTORUN describes a copy to start right away
  // ("downloadAdb": true downloads adb without asking, if it is missing).
  const job = await invoke('autorun');
  state.autoDownloadAdb = !!(job && job.downloadAdb);
  setPhoneMessage('Looking for the phone…');
  await refreshDevices();          // checks adb first, then loads the phone pane
  await refreshTuning(true);
  if (job && Array.isArray(job.sources) && job.dest && currentDevice()) {
    if (job.verify !== undefined) ui.verify.checked = job.verify !== false;
    if (job.pull) await loadPane(panes.mac, job.dest); else await loadPane(panes.phone, job.dest);
    enqueue({
      pull: !!job.pull, sources: job.sources, dest: withSlash(normalize(job.dest)), destSide: job.pull ? 'mac' : 'phone',
      skipExisting: !!job.skipExisting, fixNames: !!job.fixNames, label: `Copying (test run) to ${job.dest}`,
    });
  }
})();
