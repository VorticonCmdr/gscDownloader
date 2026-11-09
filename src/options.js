import 'bootstrap/dist/css/bootstrap.min.css';
import JSZip from 'jszip';
import { isPropertyKey, mergeGscData } from './lib/gsc.js';
import { hydrateIcons, iconSvg } from './lib/icons.js';
import { DAYS, SCHEDULES, alarmName, normalizeJob, scheduleJobAlarm } from './lib/schedule.js';
import { applySystemTheme, confirmButton, friendlyError, isValidProperty, jobErrorText, relativeDays } from './lib/ui.js';

applySystemTheme();
hydrateIcons();

const $ = (id) => document.getElementById(id);

/** "Nov 9, 4:00 AM"; the year only when it isn't the current one. */
function formatDateTime(value) {
  const d = new Date(value);
  const opts = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleString(undefined, opts);
}

/** Build an element: el('td', { className: 'x', title: 'y' }, child1, 'text', ...). */
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) {
    if (child != null) node.append(child);
  }
  return node;
}

const icon = iconSvg;

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
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' }), `gsc-crawl-stats-backup-${stamp}.zip`);
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
      `${file.name}: ${count} propert${count === 1 ? 'y' : 'ies'}, ${jobs} scheduled download${jobs === 1 ? '' : 's'}`;
  } catch (e) {
    $('restoreInfo').textContent = 'That file isn’t a backup from this extension.';
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

$('restoreToggle').addEventListener('click', (e) => {
  const panel = $('restorePanel');
  panel.hidden = !panel.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) $('fileInput').focus();
});

$('restoreBtn').addEventListener('click', async () => {
  if (!pendingRestore) return;
  $('restoreBtn').disabled = true;
  try {
    const { properties, jobs } = await restoreBackup(pendingRestore);
    $('restoreInfo').textContent =
      `Restored: ${properties} propert${properties === 1 ? 'y' : 'ies'} merged, ${jobs} scheduled download${jobs === 1 ? '' : 's'}.`;
  } catch (e) {
    $('restoreInfo').textContent = `Restore failed: ${e.message}`;
    console.error(e);
  }
  pendingRestore = null;
  $('fileInput').value = '';
  await populatePropertyList();
  await renderProperties();
  await renderJobs(await loadJobs());
});

const dropArea = $('drop-area');
dropArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  dropArea.classList.add('border-primary');
});
dropArea.addEventListener('dragleave', () => dropArea.classList.remove('border-primary'));
dropArea.addEventListener('drop', (e) => {
  e.preventDefault();
  dropArea.classList.remove('border-primary');
  readFile(e.dataTransfer.files[0]);
});
$('fileInput').addEventListener('change', (e) => readFile(e.target.files[0]));

// ── Scheduled downloads ──────────────────────────────────────

function scheduleLabel(job) {
  const base = SCHEDULES[job.periodInMinutes] || `Every ${job.periodInMinutes} min.`;
  const dayPart = job.periodInMinutes === 10080 ? ` on ${DAYS[job.dayOfWeek]}` : '';
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

function statusCell(job) {
  if (job.lastError) {
    return el('td', {},
      el('span', { className: 'badge rounded-pill text-bg-danger', title: jobErrorText(job) }, icon('exclamation-triangle-fill'), ' Failed'));
  }
  return el('td', {},
    el('span', {
      className: `badge rounded-pill ${job.enabled ? 'text-bg-success' : 'text-bg-secondary'}`,
      textContent: job.enabled ? 'Active' : 'Paused',
    }));
}

function actionButton(className, label, iconName, onClick) {
  const btn = el('button', { type: 'button', className: `btn btn-sm ${className} ms-1`, title: label }, icon(iconName));
  btn.setAttribute('aria-label', label);
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

async function renderJobs(cronJobs) {
  const tbody = $('cron-tbody');
  const jobs = Object.values(cronJobs);
  // Fetch alarms up front so the DOM update below is synchronous (no interleaving
  // between overlapping renders triggered by storage.onChanged).
  const alarms = new Map((await chrome.alarms.getAll()).map((a) => [a.name, a]));

  [...tbody.querySelectorAll('tr[data-job-id]')].forEach((r) => r.remove());
  $('cron-empty').hidden = jobs.length > 0;

  for (const job of jobs) {
    const alarm = job.enabled ? alarms.get(alarmName(job.id)) : null;

    const runBtn = actionButton('btn-outline-primary', `Run now: ${job.property}`, 'lightning-fill', async () => {
      runBtn.disabled = true;
      runBtn.replaceChildren(el('span', { className: 'spinner-border spinner-border-sm', role: 'status' }));
      try {
        await chrome.runtime.sendMessage({ type: 'runCronJob', jobId: job.id });
      } catch (err) {
        // Worker restarted mid-run ("message port closed"); data written so far is kept.
        console.warn('Run now:', friendlyError(err));
      }
      renderJobs(await loadJobs()); // result (incl. errors) shows in the Status column
    });

    const deleteBtn = actionButton('btn-outline-danger', `Delete schedule: ${job.property}`, 'trash');
    confirmButton(deleteBtn, async () => renderJobs(await deleteJob(job.id)), { label: 'Delete?' });

    const tr = el('tr', {},
      el('td', { className: 'text-truncate', style: 'max-width:220px', title: job.property },
        el('code', { className: 'prop', textContent: job.property })),
      el('td', { className: 'text-nowrap', textContent: scheduleLabel(job) }),
      el('td', { className: 'text-nowrap', textContent: job.lastRun ? formatDateTime(job.lastRun) : 'Never' }),
      el('td', { className: 'text-nowrap', textContent: alarm ? formatDateTime(alarm.scheduledTime) : '—' }),
      statusCell(job),
      el('td', { className: 'text-end text-nowrap' },
        runBtn,
        actionButton('btn-outline-secondary', `${job.enabled ? 'Pause' : 'Resume'}: ${job.property}`,
          job.enabled ? 'pause-fill' : 'play-fill',
          async () => renderJobs(await toggleJob(job.id))),
        deleteBtn,
      ),
    );
    tr.dataset.jobId = job.id;
    tbody.appendChild(tr);

    // Error details get their own full-width line under the job, so the table stays narrow.
    if (job.lastError) {
      [...tr.children].forEach((td) => td.classList.add('border-bottom-0'));
      const when = job.lastErrorAt ? `Last attempt ${formatDateTime(job.lastErrorAt)}: ` : '';
      const errCell = el('td', { colSpan: 6, className: 'pt-0 small text-danger-emphasis' },
        icon('exclamation-triangle-fill'), ` ${when}${jobErrorText(job)}`);
      errCell.title = job.lastError; // raw message for bug reports
      const errRow = el('tr', {}, errCell);
      errRow.dataset.jobId = job.id;
      tbody.appendChild(errRow);
    }
  }
}

// ── Stored data ──────────────────────────────────────────────

async function renderProperties() {
  const data = await chrome.storage.local.get(null);
  const tbody = $('properties-tbody');
  const keys = Object.keys(data).filter(isPropertyKey);

  [...tbody.querySelectorAll('tr[data-property]')].forEach((r) => r.remove());
  $('properties-empty').hidden = keys.length > 0;

  for (const key of keys) {
    const dates = Object.keys(data[key] || {})
      .filter((d) => Object.keys(data[key][d] || {}).length > 0)
      .sort();
    const first = dates[0];
    const last = dates[dates.length - 1];
    const coverage = dates.length
      ? `${dates.length.toLocaleString()} day${dates.length === 1 ? '' : 's'} · since ${first}`
      : 'No data';
    const latest = last ? `${last} (${relativeDays(last)})` : '—';

    const viewLink = el('a', {
      className: 'btn btn-sm btn-outline-primary ms-1',
      href: chrome.runtime.getURL('crawl-stats.html') + '?property=' + encodeURIComponent(key),
      target: '_blank',
      title: 'Open in crawl stats',
    }, icon('graph-up'));
    viewLink.setAttribute('aria-label', `Open ${key} in crawl stats`);

    const deleteBtn = actionButton('btn-outline-danger', `Delete stored data: ${key}`, 'trash');
    confirmButton(deleteBtn, async () => {
      await chrome.storage.local.remove(key);
      await populatePropertyList();
      renderProperties();
    }, { label: 'Delete?' });

    const tr = el('tr', {},
      el('td', { className: 'text-truncate', style: 'max-width:260px', title: key },
        el('code', { className: 'prop', textContent: key })),
      el('td', { className: 'text-nowrap small', textContent: coverage }),
      el('td', { className: 'text-nowrap small', textContent: latest }),
      el('td', { className: 'text-end text-nowrap' }, viewLink, deleteBtn),
    );
    tr.dataset.property = key;
    tbody.appendChild(tr);
  }
}

/** Datalist: properties from the user's GSC account (cached by the crawl-stats page) + stored ones. */
async function populatePropertyList() {
  const data = await chrome.storage.local.get(null);
  const entries = new Map();
  for (const { url, label } of Array.isArray(data.gscProperties) ? data.gscProperties : []) {
    if (typeof url === 'string') entries.set(url, label && label !== url ? label : '');
  }
  for (const key of Object.keys(data).filter(isPropertyKey)) {
    if (!entries.has(key)) entries.set(key, 'data stored');
  }
  $('cron-property-list').replaceChildren(
    ...[...entries].map(([value, label]) => el('option', { value, ...(label ? { label } : {}) }))
  );
}

// Show/hide day selector for weekly
$('cron-schedule').addEventListener('change', function () {
  $('cron-day-col').hidden = this.value !== '10080';
});

function setPropertyError(message) {
  const input = $('cron-property');
  input.classList.toggle('is-invalid', Boolean(message));
  $('cron-property-feedback').textContent = message || '';
  if (message) input.focus();
}

$('cron-property').addEventListener('input', () => setPropertyError(''));

// Form submission
$('cron-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const property = $('cron-property').value.trim();
  const periodInMinutes = Number($('cron-schedule').value);
  const time = $('cron-time').value || '03:00';
  const dayOfWeek = Number($('cron-day').value);

  if (!property) return setPropertyError('Enter a Search Console property.');
  if (!isValidProperty(property)) {
    return setPropertyError('Use the property exactly as in Search Console: https://example.com/ (with the trailing slash) or sc-domain:example.com');
  }
  const existing = Object.values(await loadJobs()).find((j) =>
    j.property === property && j.periodInMinutes === periodInMinutes && j.time === time &&
    (periodInMinutes !== 10080 || j.dayOfWeek === dayOfWeek));
  if (existing) return setPropertyError('This schedule already exists.');

  setPropertyError('');
  renderJobs(await addJob(property, periodInMinutes, time, dayOfWeek));
  $('cron-property').value = '';
});

// Refresh when a background run finishes (lastRun / lastError / new data).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.cronJobs) loadJobs().then(renderJobs);
  if (Object.keys(changes).some(isPropertyKey)) renderProperties();
  if (changes.gscProperties) populatePropertyList();
});

// Init
(async () => {
  await populatePropertyList();
  await renderProperties();
  await renderJobs(await loadJobs());
})();
