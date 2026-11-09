import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import JSZip from 'jszip';
import { isPropertyKey, mergeGscData } from './lib/gsc.js';
import { DAYS, SCHEDULES, alarmName, normalizeJob, scheduleJobAlarm } from './lib/schedule.js';

const $ = (id) => document.getElementById(id);

const formatDateTime = (value) =>
  new Date(value).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });

/** Build an element: el('td', { className: 'x', title: 'y' }, child1, 'text', ...). */
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) {
    if (child != null) node.append(child);
  }
  return node;
}

const icon = (name) => el('i', { className: `bi bi-${name}` });

// ── Backup & Restore ─────────────────────────────────────────

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  el('a', { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function backupData() {
  const data = await chrome.storage.local.get(null);
  const zip = new JSZip();
  zip.file('backup.json', JSON.stringify(data));
  downloadBlob(await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' }), `${Date.now()}-backup.zip`);
}

let pendingRestore = null;

async function readFile(file) {
  if (!file) return;
  pendingRestore = null;
  $('restoreBtn').disabled = true;
  try {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entry = zip.file('backup.json');
    if (!entry) throw new Error('backup.json not found in ZIP');
    const parsed = JSON.parse(await entry.async('string'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('unexpected backup format');

    pendingRestore = parsed;
    const count = Object.keys(parsed).filter(isPropertyKey).length;
    const jobs = Object.keys(parsed.cronJobs || {}).length;
    $('restoreBtn').disabled = false;
    $('restoreInfo').textContent =
      `${count} propert${count === 1 ? 'y' : 'ies'}, ${jobs} scheduled job${jobs === 1 ? '' : 's'} found in backup`;
  } catch (e) {
    $('restoreInfo').textContent = 'Invalid backup file';
    console.error(e);
  }
}

/**
 * Merge the backup into existing storage instead of overwriting it: dates only
 * present locally are kept; for dates in both, the backup wins.
 */
async function restoreBackup(backup) {
  const current = await chrome.storage.local.get(null);
  const updates = {};

  for (const [key, data] of Object.entries(backup)) {
    if (!isPropertyKey(key) || !data || typeof data !== 'object') continue;
    updates[key] = mergeGscData(current[key], data);
  }

  const cronJobs = { ...(current.cronJobs || {}) };
  for (const [id, job] of Object.entries(backup.cronJobs || {})) {
    if (!job || typeof job.property !== 'string') continue;
    cronJobs[id] = normalizeJob({ ...job, id }).job;
  }
  updates.cronJobs = cronJobs;

  await chrome.storage.local.set(updates);
  await chrome.runtime.sendMessage({ type: 'rescheduleAlarms' });
  return {
    properties: Object.keys(updates).filter(isPropertyKey).length,
    jobs: Object.keys(backup.cronJobs || {}).length,
  };
}

$('backup').addEventListener('click', backupData);

$('restoreBtn').addEventListener('click', async () => {
  if (!pendingRestore) return;
  $('restoreBtn').disabled = true;
  try {
    const { properties, jobs } = await restoreBackup(pendingRestore);
    $('restoreInfo').textContent =
      `Restore complete: ${properties} propert${properties === 1 ? 'y' : 'ies'} merged, ${jobs} job${jobs === 1 ? '' : 's'}`;
  } catch (e) {
    $('restoreInfo').textContent = `Restore failed: ${e.message}`;
    console.error(e);
  }
  pendingRestore = null;
  await populatePropertyList();
  await renderProperties();
  await renderJobs(await loadJobs());
});

const dropArea = $('drop-area');
dropArea.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
dropArea.addEventListener('drop', (e) => { e.preventDefault(); readFile(e.dataTransfer.files[0]); });
$('fileInput').addEventListener('change', (e) => readFile(e.target.files[0]));

// ── Cron jobs ────────────────────────────────────────────────

function scheduleLabel(job) {
  const base = SCHEDULES[job.periodInMinutes] || `Every ${job.periodInMinutes} min.`;
  const dayPart = job.periodInMinutes === 10080 ? ` (${DAYS[job.dayOfWeek]})` : '';
  return `${base}${dayPart} at ${job.time}`;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function loadJobs() {
  const { cronJobs = {} } = await chrome.storage.local.get('cronJobs');
  return cronJobs;
}

async function saveJobs(cronJobs) {
  await chrome.storage.local.set({ cronJobs });
}

async function addJob(property, periodInMinutes, time, dayOfWeek) {
  const cronJobs = await loadJobs();
  const id = uid();
  const { job } = normalizeJob({
    id,
    property,
    periodInMinutes,
    time,
    dayOfWeek,
    enabled: true,
    lastRun: null,
    lastError: null,
    createdAt: new Date().toISOString(),
  });
  cronJobs[id] = job;
  await saveJobs(cronJobs);
  await scheduleJobAlarm(job);
  return cronJobs;
}

async function deleteJob(id) {
  const cronJobs = await loadJobs();
  delete cronJobs[id];
  await saveJobs(cronJobs);
  await chrome.alarms.clear(alarmName(id));
  return cronJobs;
}

async function toggleJob(id) {
  const cronJobs = await loadJobs();
  const job = cronJobs[id];
  if (!job) return cronJobs;
  job.enabled = !job.enabled;
  await saveJobs(cronJobs);
  await scheduleJobAlarm(job);
  return cronJobs;
}

function statusBadge(job) {
  if (job.lastError) {
    const title = job.lastErrorAt ? `${formatDateTime(job.lastErrorAt)}: ${job.lastError}` : job.lastError;
    return el('span', { className: 'badge rounded-pill bg-danger', title },
      icon('exclamation-triangle-fill'), ' Failed');
  }
  return el('span', { className: `badge rounded-pill bg-${job.enabled ? 'success' : 'secondary'}` },
    job.enabled ? 'Active' : 'Paused');
}

function actionButton(className, title, iconName, onClick) {
  const btn = el('button', { type: 'button', className: `btn btn-sm ${className} ms-1`, title }, icon(iconName));
  btn.addEventListener('click', onClick);
  return btn;
}

async function renderJobs(cronJobs) {
  const tbody = $('cron-tbody');
  const jobs = Object.values(cronJobs);
  // Fetch alarms up front so the DOM update below is synchronous (no interleaving
  // between overlapping renders triggered by storage.onChanged).
  const alarms = new Map((await chrome.alarms.getAll()).map((a) => [a.name, a]));

  [...tbody.querySelectorAll('tr[data-job-id]')].forEach((r) => r.remove());
  $('cron-empty').style.display = jobs.length ? 'none' : '';

  for (const job of jobs) {
    const alarm = job.enabled ? alarms.get(alarmName(job.id)) : null;

    const runBtn = actionButton('btn-outline-primary', 'Run now', 'lightning-fill', async () => {
      runBtn.disabled = true;
      runBtn.replaceChildren(el('span', { className: 'spinner-border spinner-border-sm' }));
      try {
        await chrome.runtime.sendMessage({ type: 'runCronJob', jobId: job.id });
      } catch (err) {
        // Worker restarted mid-run ("message port closed"); data written so far is kept.
        console.warn('Run now:', err.message);
      }
      renderJobs(await loadJobs()); // result (incl. errors) shows in the Status column
    });

    const tr = el('tr', {},
      el('td', { className: 'text-truncate', style: 'max-width:220px', title: job.property },
        el('code', { className: 'small', textContent: job.property })),
      el('td', { className: 'text-nowrap', textContent: scheduleLabel(job) }),
      el('td', { className: 'text-nowrap', textContent: job.lastRun ? formatDateTime(job.lastRun) : '—' }),
      el('td', { className: 'text-nowrap', textContent: alarm ? formatDateTime(alarm.scheduledTime) : '—' }),
      el('td', {}, statusBadge(job)),
      el('td', { className: 'text-end text-nowrap' },
        runBtn,
        actionButton('btn-outline-secondary', job.enabled ? 'Pause' : 'Enable',
          job.enabled ? 'pause-fill' : 'play-fill',
          async () => renderJobs(await toggleJob(job.id))),
        actionButton('btn-outline-danger', 'Delete', 'trash', async () => {
          if (confirm(`Delete scheduled job for "${job.property}"?`)) {
            renderJobs(await deleteJob(job.id));
          }
        }),
      ),
    );
    tr.dataset.jobId = job.id;
    tbody.appendChild(tr);
  }
}

// ── Stored Properties ────────────────────────────────────────

async function renderProperties() {
  const data = await chrome.storage.local.get(null);
  const tbody = $('properties-tbody');
  const keys = Object.keys(data).filter(isPropertyKey);

  [...tbody.querySelectorAll('tr[data-property]')].forEach((r) => r.remove());
  $('properties-empty').style.display = keys.length ? 'none' : '';

  for (const key of keys) {
    const dates = Object.keys(data[key] || {}).sort();
    const range = dates.length
      ? (dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} – ${dates[dates.length - 1]}`)
      : '—';
    const entryCount = dates.reduce((n, d) => n + Object.keys(data[key][d] || {}).length, 0);

    const viewLink = el('a', {
      className: 'btn btn-sm btn-outline-primary ms-1',
      href: chrome.runtime.getURL('crawl-stats.html') + '?property=' + encodeURIComponent(key),
      target: '_blank',
      title: 'View',
    }, icon('graph-up'));

    const tr = el('tr', {},
      el('td', { className: 'text-truncate', style: 'max-width:260px', title: key },
        el('code', { className: 'small', textContent: key })),
      el('td', { className: 'text-nowrap small', textContent: range }),
      el('td', { className: 'text-nowrap small', textContent: entryCount.toLocaleString() }),
      el('td', { className: 'text-end text-nowrap' },
        viewLink,
        actionButton('btn-outline-danger', 'Delete', 'trash', async () => {
          if (!confirm(`Delete all stored data for "${key}"?`)) return;
          await chrome.storage.local.remove(key);
          await populatePropertyList();
          renderProperties();
        }),
      ),
    );
    tr.dataset.property = key;
    tbody.appendChild(tr);
  }
}

// Populate property datalist from existing storage keys
async function populatePropertyList() {
  const data = await chrome.storage.local.get(null);
  const datalist = $('cron-property-list');
  datalist.replaceChildren(
    ...Object.keys(data).filter(isPropertyKey).map((key) => el('option', { value: key }))
  );
}

// Show/hide day selector for weekly
$('cron-schedule').addEventListener('change', function () {
  $('cron-day-col').style.display = this.value === '10080' ? '' : 'none';
});

// Form submission
$('cron-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const property = $('cron-property').value.trim();
  const periodInMinutes = Number($('cron-schedule').value);
  const time = $('cron-time').value || '03:00';
  const dayOfWeek = Number($('cron-day').value);
  if (!property) return;
  renderJobs(await addJob(property, periodInMinutes, time, dayOfWeek));
  $('cron-property').value = '';
});

// Refresh when a background run finishes (lastRun / lastError / new data).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.cronJobs) loadJobs().then(renderJobs);
});

// Init
(async () => {
  await populatePropertyList();
  await renderProperties();
  await renderJobs(await loadJobs());
})();
