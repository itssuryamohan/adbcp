// adbcp window logic. Talks to the Rust side through Tauri commands and turns the copy
// engine's JSON events ("start", "plan", "progress", ...) into what the window shows.
'use strict';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const $ = (id) => document.getElementById(id);

const ui = {
  device: $('device'), refresh: $('refresh'), deviceNote: $('device-note'),
  addFiles: $('add-files'), addFolder: $('add-folder'), addPhone: $('add-phone'), remove: $('remove'),
  sources: $('sources'), dest: $('dest'), browse: $('browse'),
  verify: $('verify'), skip: $('skip'), advanced: $('advanced'),
  streams: $('streams'), compression: $('compression'), split: $('split'),
  partSize: $('part-size'), splitMin: $('split-min'), fixNames: $('fix-names'),
  burst: $('burst'), libusb: $('libusb'), force: $('force'),
  tuning: $('tuning'), measure: $('measure'), dropHint: $('drop-hint'), safeNames: $('safe-names'),
  summary: $('summary'), bar: $('bar'), stats: $('stats'), result: $('result'),
  problems: $('problems'), problemsTitle: $('problems-title'), problemList: $('problem-list'),
  log: $('log'), start: $('start'), cancel: $('cancel'), retry: $('retry'),
  browser: $('browser'), up: $('up'), here: $('here'), entries: $('entries'),
  hiddenFiles: $('hidden-files'), choose: $('choose'), browserCancel: $('browser-cancel'),
};

const state = {
  direction: 'push',          // 'push': computer to phone, 'pull': phone to computer
  sources: [],
  selected: new Set(),
  devices: [],
  running: false,
  phoneDest: '/sdcard/Download/',
  localDest: '',
  run: null,                  // what the current copy has reported so far
  measuring: false,
  profileKey: '',             // phone + destination kind the shown measurements are for
};

// ------------------------------------------------------------------ formatting ---
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

// --------------------------------------------------------------------- phones ---
function deviceLabel(d) {
  const name = d.model || d.serial;
  if (d.state === 'unauthorized') return `${name} · allow this computer on the phone`;
  if (d.state !== 'device') return `${name} · ${d.state}`;
  if (d.connection !== 'usb') return `${name} · network`;
  if (!d.link_mbps) return `${name} · USB`;
  return `${name} · USB ${d.link_mbps >= 1000 ? d.link_mbps / 1000 + ' Gb/s' : d.link_mbps + ' Mb/s'}`;
}

async function refreshDevices() {
  ui.device.innerHTML = '';
  let devices = [];
  try {
    devices = await invoke('list_devices');
  } catch (err) {
    log(`adbcp: ${err}`);
  }
  state.devices = devices;
  for (const d of devices) {
    const o = el('option', '', deviceLabel(d));
    o.value = d.serial;
    o.disabled = d.state !== 'device';
    ui.device.append(o);
  }
  const ready = devices.find((d) => d.state === 'device');
  if (ready) ui.device.value = ready.serial;
  if (!devices.length) ui.device.append(el('option', '', 'No phone found'));
  showDeviceNote();
  updateControls();
  await refreshTuning(true);
}

function currentDevice() {
  return state.devices.find((d) => d.serial === ui.device.value && d.state === 'device');
}

function showDeviceNote() {
  const d = currentDevice();
  let text = '';
  if (!state.devices.length) {
    text = 'No phone found. Connect it with a USB cable, turn on USB debugging (Settings › Developer options), and allow this computer when the phone asks. Then press Refresh.';
  } else if (!d) {
    text = 'Unlock the phone and allow this computer when it asks, then press Refresh.';
  } else if (d.connection === 'usb' && d.link_mbps && d.link_mbps < 5000) {
    text = `The phone is connected at USB 2.0 speed (${d.link_mbps} Mb/s), about 40 MB/s at best. A USB 3 data cable and port can be 5–10 times faster.`;
  }
  ui.deviceNote.textContent = text;
  ui.deviceNote.hidden = !text;
}

// -------------------------------------------------------------------- sources ---
function renderSources() {
  ui.sources.innerHTML = '';
  if (!state.sources.length) {
    ui.sources.append(el('li', 'empty', state.direction === 'push'
      ? 'Drop files or folders here, or use Add files… / Add folder…'
      : 'Use Add from phone… to choose what to copy from the phone.'));
  }
  for (const p of state.sources) {
    const li = el('li', state.selected.has(p) ? 'selected' : '');
    li.append(el('span', 'name', basename(p)), el('span', 'path', p));
    li.addEventListener('click', () => {
      if (state.running) return;
      state.selected.has(p) ? state.selected.delete(p) : state.selected.add(p);
      renderSources();
    });
    ui.sources.append(li);
  }
  updateControls();
}

function addSources(paths) {
  for (const p of paths) if (p && !state.sources.includes(p)) state.sources.push(p);
  renderSources();
}

async function setDirection(dir) {
  if (dir === state.direction) return;
  if (state.direction === 'push') state.phoneDest = ui.dest.value; else state.localDest = ui.dest.value;
  state.direction = dir;
  state.sources = [];
  state.selected.clear();
  if (dir === 'pull' && !state.localDest) {
    try { state.localDest = (await window.__TAURI__.path.downloadDir()).replace(/\/?$/, '/'); } catch (_) { state.localDest = ''; }
  }
  ui.dest.value = dir === 'push' ? state.phoneDest : state.localDest;
  ui.addFiles.hidden = ui.addFolder.hidden = dir !== 'push';
  ui.addPhone.hidden = dir !== 'pull';
  renderSources();
  refreshTuning();
  saveSettingsSoon();
}

// ------------------------------------------------------------ phone browser ---
const browser = { mode: 'add', path: '/sdcard', checked: new Set(), entries: [] };

async function openBrowser(mode, start) {
  if (!currentDevice()) return;
  browser.mode = mode;
  browser.checked.clear();
  ui.browser.hidden = false;
  await browse(start || '/sdcard');
}
function closeBrowser() { ui.browser.hidden = true; }

async function browse(path) {
  path = path.replace(/\/+/g, '/').replace(/(.)\/$/, '$1') || '/';
  ui.here.textContent = path;
  ui.entries.innerHTML = '';
  ui.entries.append(el('li', 'empty', 'Loading…'));
  let entries;
  try {
    entries = await invoke('list_dir', { serial: ui.device.value, path });
  } catch (err) {
    ui.entries.innerHTML = '';
    ui.entries.append(el('li', 'empty', String(err)));
    return;
  }
  browser.path = path;
  browser.entries = entries;
  renderBrowser();
}

function renderBrowser() {
  const shown = browser.entries
    .filter((e) => ui.hiddenFiles.checked || !e.name.startsWith('.'))
    .sort((a, b) => (a.type === 'dir') === (b.type === 'dir')
      ? a.name.localeCompare(b.name, undefined, { numeric: true })
      : (a.type === 'dir' ? -1 : 1));
  ui.entries.innerHTML = '';
  if (!shown.length) ui.entries.append(el('li', 'empty', 'This folder is empty.'));
  for (const e of shown) {
    const li = el('li', e.type === 'dir' ? 'dir' : 'file');
    if (browser.mode === 'add') {
      const box = el('input');
      box.type = 'checkbox';
      box.checked = browser.checked.has(e.path);
      box.addEventListener('change', () => {
        box.checked ? browser.checked.add(e.path) : browser.checked.delete(e.path);
        updateChoose();
      });
      li.append(box);
    } else if (e.type !== 'dir') {
      li.classList.add('off');
    }
    const name = el('span', 'name', e.name);
    if (e.type === 'dir') name.addEventListener('click', () => browse(e.path));
    li.append(name);
    if (e.type !== 'dir') li.append(el('span', 'size', size(e.size)));
    ui.entries.append(li);
  }
  updateChoose();
}

function updateChoose() {
  if (browser.mode === 'dest') {
    ui.choose.textContent = 'Choose this folder';
    ui.choose.disabled = false;
  } else {
    ui.choose.textContent = browser.checked.size ? `Add ${plural(browser.checked.size, 'item')}` : 'Add selected';
    ui.choose.disabled = !browser.checked.size;
  }
}

// -------------------------------------------------------------------- tuning ---
// The engine keeps measurements per phone, connection and kind of destination.
function destKind(path) {
  if (/\/Android\/(data|obb)(\/|$)/.test(path)) return 'appdir';
  if (/^\/data\//.test(path)) return 'data';
  return 'media';
}
const KIND_NAMES = { media: 'shared storage', appdir: 'app folders', data: '/data' };
function tuningDest() {
  const d = ui.dest.value.trim();
  return d.startsWith('/') ? d : '/sdcard/Download/';
}
const numbersAt = (pairs) => Object.values(pairs || {}).join(' · ');

function showTuning(text, cls = '', title = '') {
  ui.tuning.textContent = text;
  ui.tuning.className = `grow small ${cls}`;
  ui.tuning.title = title;
}

async function refreshTuning(force = false) {
  const d = currentDevice();
  if (state.measuring) return;
  if (!d) { state.profileKey = ''; showTuning('—'); return; }
  if (state.direction === 'pull') {
    state.profileKey = '';
    showTuning('Copies from the phone use fixed settings: 8 parallel transfers, small files in groups on 4.');
    return;
  }
  const key = `${d.serial}|${destKind(tuningDest())}`;
  if (!force && key === state.profileKey) return;
  state.profileKey = key;
  try {
    const p = (await invoke('show_profile', { serial: d.serial, dest: tuningDest() })).find((e) => e.event === 'profile');
    if (p) describeProfile(p);
  } catch (err) {
    showTuning(String(err), 'bad');
  }
}

function describeProfile(p) {
  const where = KIND_NAMES[p.kind] || p.kind;
  if (!p.saved) {
    showTuning(`Not measured yet for this phone and ${where}. It is measured automatically before the first large copy (about 10 seconds), or now.`);
    return;
  }
  const detail = `Large files: ${numbersAt(p.large_mib_per_second)} MiB/s on 2 · 4 · 8 transfers. ` +
    `Small files: ${numbersAt(p.small_files_per_second)} files/s on 2 · 4 · 8 transfers.`;
  showTuning(`Measured ${p.date} for ${where}: ${plural(p.streams, 'parallel transfer')} for large files, ` +
    `up to ${p.small_streams} for small files.`, '', detail);
}

async function measureNow() {
  const d = currentDevice();
  if (!d || state.running || state.measuring) return;
  state.measuring = true;
  updateControls();
  showTuning('Measuring this phone, cable and destination (about 10 seconds)…', 'busy');
  try {
    const events = await invoke('measure', { serial: d.serial, dest: tuningDest() });
    const p = events.find((e) => e.event === 'profile');
    state.measuring = false;
    if (p) { describeProfile(p); state.profileKey = `${d.serial}|${p.kind}`; }
  } catch (err) {
    state.measuring = false;
    showTuning(`Measuring failed: ${err}`, 'bad');
  }
  updateControls();
}

// ------------------------------------------------------------------ settings ---
// Remembered between launches. Per-copy choices (what to copy, skip, free-space check)
// are deliberately not remembered.
function collectSettings() {
  if (state.direction === 'push') state.phoneDest = ui.dest.value; else state.localDest = ui.dest.value;
  return {
    direction: state.direction, phoneDest: state.phoneDest, localDest: state.localDest,
    verify: ui.verify.checked, streams: ui.streams.value, compression: ui.compression.value,
    split: ui.split.value, partSize: ui.partSize.value, splitMin: ui.splitMin.value,
    fixNames: ui.fixNames.checked, burst: ui.burst.checked, libusb: ui.libusb.checked,
    advancedOpen: ui.advanced.open,
  };
}
async function applySettings(s) {
  if (!s || typeof s !== 'object') return;
  const set = (select, v) => { if (v != null && [...select.options].some((o) => o.value === String(v))) select.value = String(v); };
  if (typeof s.phoneDest === 'string' && s.phoneDest) state.phoneDest = s.phoneDest;
  if (typeof s.localDest === 'string') state.localDest = s.localDest;
  ui.dest.value = state.phoneDest;
  if (typeof s.verify === 'boolean') ui.verify.checked = s.verify;
  set(ui.streams, s.streams); set(ui.compression, s.compression); set(ui.split, s.split);
  set(ui.partSize, s.partSize); set(ui.splitMin, s.splitMin);
  for (const k of ['fixNames', 'burst', 'libusb']) if (typeof s[k] === 'boolean') ui[k].checked = s[k];
  ui.advanced.open = !!s.advancedOpen;
  if (s.direction === 'pull') {
    document.querySelector('input[value="pull"]').checked = true;
    await setDirection('pull');
  }
}
let saveTimer = null;
function saveSettingsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => invoke('save_settings', { settings: collectSettings() }).catch((e) => log(`adbcp: ${e}`)), 300);
}

// ---------------------------------------------------------------------- copy ---
function updateControls() {
  const busy = state.running;
  const locked = busy || state.measuring;
  for (const c of [ui.device, ui.refresh, ui.addFiles, ui.addFolder, ui.addPhone, ui.dest, ui.browse,
    ui.verify, ui.skip, ui.streams, ui.compression, ui.split, ui.partSize, ui.splitMin,
    ui.fixNames, ui.burst, ui.libusb, ui.force]) c.disabled = locked;
  ui.partSize.disabled = ui.splitMin.disabled = locked || ui.split.value !== '1';
  ui.measure.hidden = state.direction !== 'push';
  ui.measure.disabled = locked || !currentDevice();
  for (const r of document.querySelectorAll('input[name="direction"]')) r.disabled = busy;
  ui.addPhone.disabled = busy || !currentDevice();
  ui.browse.disabled = busy || (state.direction === 'push' && !currentDevice());
  ui.remove.disabled = busy || !state.selected.size;
  ui.start.disabled = locked || !currentDevice() || !state.sources.length || !ui.dest.value.trim();
  ui.cancel.disabled = !busy;
}

function resetStatus() {
  state.run = { problems: 0, nameProblems: 0, otherProblems: 0, renamed: 0, done: null, verify: null, error: null };
  ui.summary.textContent = '';
  ui.result.textContent = '';
  ui.result.className = '';
  ui.bar.style.width = '0';
  ui.bar.classList.remove('busy');
  ui.problemList.innerHTML = '';
  ui.problems.hidden = true;
  ui.retry.hidden = true;
  ui.safeNames.hidden = true;
  ui.log.textContent = '';
}

async function startCopy(overrides = {}) {
  const pull = state.direction === 'pull';
  const dest = ui.dest.value.trim();
  if (!pull && !dest.startsWith('/')) {
    ui.result.textContent = 'The destination on the phone must start with /, for example /sdcard/Download/.';
    ui.result.className = 'bad';
    return;
  }
  resetStatus();
  ui.stats.textContent = 'Starting…';
  state.running = true;
  updateControls();
  const req = {
    serial: ui.device.value,
    pull,
    sources: state.sources,
    dest,
    verify: ui.verify.checked,
    skipExisting: overrides.skipExisting ?? ui.skip.checked,
    streams: ui.streams.value ? Number(ui.streams.value) : null,
    compression: ui.compression.value,
    split: ui.split.value === '1',
    // Sizes are passed only when changed: an explicit size keeps splitting on even where
    // the engine would switch it off by itself (USB 2.0).
    partSizeMib: ui.partSize.value !== '128' ? Number(ui.partSize.value) : null,
    splitMinMib: ui.splitMin.value !== '256' ? Number(ui.splitMin.value) : null,
    fixNames: !pull && (overrides.fixNames ?? ui.fixNames.checked),
    burst: ui.burst.checked,
    libusb: ui.libusb.checked,
    force: ui.force.checked,
  };
  saveSettingsSoon();
  try {
    await invoke('start_copy', { req });
  } catch (err) {
    state.running = false;
    ui.stats.textContent = 'Ready.';
    ui.result.textContent = String(err);
    ui.result.className = 'bad';
    updateControls();
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
  switch (e.event) {
    case 'start':
      ui.summary.textContent = `${plural(e.files, 'file')}, ${size(e.bytes)} → ${e.destination}`;
      break;
    case 'skip':
      log(`Skipping ${plural(e.files, 'file')} already there.`);
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
  state.running = false;
  ui.bar.classList.remove('busy');
  let text, ok = false;
  if (code === 130) {
    text = 'Cancelled. Files that finished copying are kept; partly copied files were removed. Turn on “Skip files already there” and press Start to continue.';
    ui.skip.checked = true;
  } else if (code === 0) {
    ok = true;
    text = r.done ? `Done: ${plural(r.done.files_copied, 'file')} copied.` : 'Done.';
    if (r.verify) text += ` All ${plural(r.verify.files, 'file')} verified.`;
    if (r.renamed) text += ` ${plural(r.renamed, 'file')} got safe names (see Details).`;
  } else if (r.done || r.verify) {
    // Files with names the phone does not allow are reported, never retried as they are:
    // "Copy with safe names" copies just those, with the characters replaced.
    const parts = [];
    if (r.otherProblems) parts.push(`${plural(r.otherProblems, 'file')} could not be copied or failed verification.`);
    if (r.nameProblems) parts.push(`${plural(r.nameProblems, 'file')} ${r.nameProblems === 1 ? 'has a name' : 'have names'} the phone does not allow.`);
    text = parts.join(' ') + ' See Problems below.';
    ui.retry.hidden = !r.otherProblems;
    ui.safeNames.hidden = !r.nameProblems;
  } else {
    text = r.error || `The copy stopped unexpectedly (code ${code}). See Details.`;
  }
  ui.result.textContent = text;
  ui.result.className = ok ? 'ok' : 'bad';
  if (code !== 0 && code !== 130) document.getElementById('details').open = !r.done && !r.verify;
  updateControls();
  refreshTuning(true);   // the copy may have measured the phone
}

// -------------------------------------------------------------------- wiring ---
ui.refresh.addEventListener('click', refreshDevices);
ui.device.addEventListener('change', () => { showDeviceNote(); updateControls(); refreshTuning(); });
ui.measure.addEventListener('click', measureNow);
for (const c of [ui.verify, ui.streams, ui.compression, ui.split, ui.partSize, ui.splitMin, ui.fixNames, ui.burst, ui.libusb]) {
  c.addEventListener('change', () => { updateControls(); saveSettingsSoon(); });
}
ui.advanced.addEventListener('toggle', saveSettingsSoon);
let destTimer = null;
ui.dest.addEventListener('input', () => {
  clearTimeout(destTimer);
  destTimer = setTimeout(() => { refreshTuning(); saveSettingsSoon(); }, 500);
});
for (const r of document.querySelectorAll('input[name="direction"]')) {
  r.addEventListener('change', () => setDirection(r.value));
}
ui.addFiles.addEventListener('click', async () => addSources(await invoke('pick_local', { folders: false, multiple: true })));
ui.addFolder.addEventListener('click', async () => addSources(await invoke('pick_local', { folders: true, multiple: true })));
ui.addPhone.addEventListener('click', () => openBrowser('add', '/sdcard'));
ui.remove.addEventListener('click', () => {
  state.sources = state.sources.filter((p) => !state.selected.has(p));
  state.selected.clear();
  renderSources();
});
ui.browse.addEventListener('click', async () => {
  if (state.direction === 'push') {
    const start = ui.dest.value.trim().startsWith('/') ? ui.dest.value.trim() : '/sdcard';
    openBrowser('dest', start);
  } else {
    const [dir] = await invoke('pick_local', { folders: true, multiple: false });
    if (dir) { ui.dest.value = dir.replace(/\/?$/, '/'); updateControls(); saveSettingsSoon(); }
  }
});
ui.dest.addEventListener('input', updateControls);
ui.start.addEventListener('click', startCopy);
ui.cancel.addEventListener('click', async () => {
  ui.stats.textContent = 'Cancelling…';
  await invoke('cancel_copy');
});
ui.retry.addEventListener('click', () => { ui.skip.checked = true; startCopy(); });
ui.safeNames.addEventListener('click', () => startCopy({ skipExisting: true, fixNames: true }));

ui.up.addEventListener('click', () => browse(parentOf(browser.path)));
ui.hiddenFiles.addEventListener('change', renderBrowser);
ui.browserCancel.addEventListener('click', closeBrowser);
ui.choose.addEventListener('click', () => {
  if (browser.mode === 'dest') {
    ui.dest.value = browser.path.replace(/\/?$/, '/');
    refreshTuning();
    saveSettingsSoon();
  } else {
    addSources([...browser.checked]);
  }
  closeBrowser();
  updateControls();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ui.browser.hidden) closeBrowser(); });

listen('engine-event', ({ payload }) => onEvent(payload));
listen('engine-log', ({ payload }) => log(payload));
listen('engine-exit', ({ payload }) => onExit(payload));
listen('files-dropped', ({ payload }) => {
  if (state.direction === 'push' && !state.running && !state.measuring) addSources(payload);
});
listen('drag-hover', ({ payload: over }) => {
  const accept = state.direction === 'push' && !state.running && !state.measuring;
  ui.dropHint.textContent = accept ? 'Drop to add to the list'
    : state.direction !== 'push' ? 'Files can be dropped when copying from the computer to the phone'
    : 'Wait for the current copy to finish';
  ui.dropHint.classList.toggle('refuse', !accept);
  ui.dropHint.hidden = !over;
});

// --------------------------------------------------------------------- start ---
(async () => {
  ui.dest.value = state.phoneDest;
  try { await applySettings(await invoke('load_settings')); } catch (err) { log(`adbcp: ${err}`); }
  renderSources();
  await refreshDevices();
  // Automated smoke tests: ADBCP_APP_AUTORUN describes a copy to start right away.
  const job = await invoke('autorun');
  if (job) {
    if (job.pull) {
      document.querySelector('input[value="pull"]').checked = true;
      await setDirection('pull');
    }
    addSources(job.sources || []);
    if (job.dest) ui.dest.value = job.dest;
    ui.verify.checked = job.verify !== false;
    ui.skip.checked = !!job.skipExisting;
    ui.fixNames.checked = !!job.fixNames;
    updateControls();
    if (!ui.start.disabled) startCopy();
  }
})();
