import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import JSZip from 'jszip';

// ── Backup & Restore ─────────────────────────────────────────

function downloadBlob(content, filename, contentType) {
  const url = URL.createObjectURL(new Blob([content], { type: contentType }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
}

function backupData() {
  chrome.storage.local.get(null, (data) => {
    const zip = new JSZip();
    zip.file('backup.json', JSON.stringify(data));
    zip.generateAsync({ type: 'blob' }).then((blob) => {
      downloadBlob(blob, `${Date.now()}-backup.zip`, '');
    });
  });
}

let pendingRestore = null;

function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    new JSZip().loadAsync(reader.result).then((zip) => {
      zip.file('backup.json').async('string').then((fileData) => {
        try {
          pendingRestore = JSON.parse(fileData);
          const count = Object.keys(pendingRestore).filter(k => k !== 'cronJobs').length;
          document.getElementById('restoreBtn').disabled = false;
          document.getElementById('restoreInfo').textContent = `${count} propert${count === 1 ? 'y' : 'ies'} found in backup`;
        } catch (e) {
          document.getElementById('restoreInfo').textContent = 'Invalid backup file';
          console.error(e);
        }
      });
    });
  };
  reader.readAsBinaryString(file);
}

document.getElementById('backup').addEventListener('click', backupData);

document.getElementById('restoreBtn').addEventListener('click', () => {
  if (!pendingRestore) return;
  chrome.storage.local.set(pendingRestore, () => {
    pendingRestore = null;
    document.getElementById('restoreBtn').disabled = true;
    document.getElementById('restoreInfo').textContent = 'Restore complete';
    renderProperties();
  });
});

const dropArea = document.getElementById('drop-area');
dropArea.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
dropArea.addEventListener('drop', (e) => { e.preventDefault(); readFile(e.dataTransfer.files[0]); });
document.getElementById('fileInput').addEventListener('change', (e) => readFile(e.target.files[0]));

// ── Cron jobs ────────────────────────────────────────────────

const SCHEDULES = {
  '60':    'Hourly',
  '360':   'Every 6 hours',
  '720':   'Every 12 hours',
  '1440':  'Daily',
  '10080': 'Weekly',
};

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function nextFiringTime(periodInMinutes, timeStr, dayOfWeek) {
  const [h, m] = timeStr.split(':').map(Number);
  const now = new Date();
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setHours(h, m);

  if (periodInMinutes === 10080) {
    const diff = (dayOfWeek - candidate.getDay() + 7) % 7;
    candidate.setDate(candidate.getDate() + diff);
    if (candidate <= now) candidate.setDate(candidate.getDate() + 7);
  } else {
    if (candidate <= now) {
      const periodsNeeded = Math.ceil((now - candidate) / (periodInMinutes * 60000));
      candidate.setTime(candidate.getTime() + periodsNeeded * periodInMinutes * 60000);
    }
  }
  return candidate.getTime();
}

function scheduleLabel(job) {
  const base = SCHEDULES[String(job.periodInMinutes)] || `Every ${job.periodInMinutes} min.`;
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
  cronJobs[id] = {
    id,
    property,
    periodInMinutes,
    time,
    dayOfWeek,
    enabled: true,
    lastRun: null,
    createdAt: new Date().toISOString(),
  };
  await saveJobs(cronJobs);
  chrome.alarms.create('gsc-cron-' + id, {
    when: nextFiringTime(periodInMinutes, time, dayOfWeek),
    periodInMinutes,
  });
  return cronJobs;
}

async function deleteJob(id) {
  const cronJobs = await loadJobs();
  delete cronJobs[id];
  await saveJobs(cronJobs);
  chrome.alarms.clear('gsc-cron-' + id);
  return cronJobs;
}

async function toggleJob(id) {
  const cronJobs = await loadJobs();
  const job = cronJobs[id];
  job.enabled = !job.enabled;
  await saveJobs(cronJobs);
  if (job.enabled) {
    chrome.alarms.create('gsc-cron-' + id, {
      when: nextFiringTime(job.periodInMinutes, job.time || '03:00', job.dayOfWeek ?? 1),
      periodInMinutes: job.periodInMinutes,
    });
  } else {
    chrome.alarms.clear('gsc-cron-' + id);
  }
  return cronJobs;
}

async function renderJobs(cronJobs) {
  const tbody = document.getElementById('cron-tbody');
  const emptyRow = document.getElementById('cron-empty');
  const jobs = Object.values(cronJobs);

  [...tbody.querySelectorAll('tr[data-job-id]')].forEach((r) => r.remove());
  emptyRow.style.display = jobs.length ? 'none' : '';

  for (const job of jobs) {
    const lastRun = job.lastRun
      ? new Date(job.lastRun).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
      : '—';

    const alarm = await chrome.alarms.get('gsc-cron-' + job.id);
    const nextRun = alarm
      ? new Date(alarm.scheduledTime).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
      : job.enabled ? '—' : '—';

    const tr = document.createElement('tr');
    tr.dataset.jobId = job.id;
    tr.innerHTML = `
      <td class="text-truncate" style="max-width:220px" title="${job.property}">
        <code class="small">${job.property}</code>
      </td>
      <td class="text-nowrap">${scheduleLabel(job)}</td>
      <td class="text-nowrap">${lastRun}</td>
      <td class="text-nowrap">${nextRun}</td>
      <td>
        <span class="badge rounded-pill bg-${job.enabled ? 'success' : 'secondary'}">
          ${job.enabled ? 'Active' : 'Paused'}
        </span>
      </td>
      <td class="text-end text-nowrap">
        <button class="btn btn-sm btn-outline-primary run-btn ms-1" title="Run now">
          <i class="bi bi-lightning-fill"></i>
        </button>
        <button class="btn btn-sm btn-outline-secondary toggle-btn ms-1" title="${job.enabled ? 'Pause' : 'Enable'}">
          <i class="bi bi-${job.enabled ? 'pause-fill' : 'play-fill'}"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger delete-btn ms-1" title="Delete">
          <i class="bi bi-trash"></i>
        </button>
      </td>
    `;

    tr.querySelector('.run-btn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
      chrome.runtime.sendMessage({ type: 'runCronJob', jobId: job.id }, async (resp) => {
        if (resp?.error) {
          alert(`Error: ${resp.error}`);
        }
        renderJobs(await loadJobs());
      });
    });

    tr.querySelector('.toggle-btn').addEventListener('click', async () => {
      renderJobs(await toggleJob(job.id));
    });
    tr.querySelector('.delete-btn').addEventListener('click', async () => {
      if (confirm(`Delete scheduled job for "${job.property}"?`)) {
        renderJobs(await deleteJob(job.id));
      }
    });

    tbody.appendChild(tr);
  }
}

// ── Stored Properties ────────────────────────────────────────

async function renderProperties() {
  const data = await chrome.storage.local.get(null);
  const tbody = document.getElementById('properties-tbody');
  const emptyRow = document.getElementById('properties-empty');
  const keys = Object.keys(data).filter(k => k !== 'cronJobs');

  [...tbody.querySelectorAll('tr[data-property]')].forEach(r => r.remove());
  emptyRow.style.display = keys.length ? 'none' : '';

  for (const key of keys) {
    const dates = Object.keys(data[key] || {}).sort();
    const range = dates.length
      ? (dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} – ${dates[dates.length - 1]}`)
      : '—';
    const entryCount = dates.reduce((n, d) => n + Object.keys(data[key][d]).length, 0);
    const viewUrl = chrome.runtime.getURL('crawl-stats.html') + '?property=' + encodeURIComponent(key);

    const tr = document.createElement('tr');
    tr.dataset.property = key;
    tr.innerHTML = `
      <td class="text-truncate" style="max-width:260px" title="${key}">
        <code class="small">${key}</code>
      </td>
      <td class="text-nowrap small">${range}</td>
      <td class="text-nowrap small">${entryCount.toLocaleString()}</td>
      <td class="text-end text-nowrap">
        <a class="btn btn-sm btn-outline-primary ms-1" href="${viewUrl}" target="_blank" title="View">
          <i class="bi bi-graph-up"></i>
        </a>
        <button class="btn btn-sm btn-outline-danger delete-prop-btn ms-1" title="Delete">
          <i class="bi bi-trash"></i>
        </button>
      </td>
    `;

    tr.querySelector('.delete-prop-btn').addEventListener('click', async () => {
      if (!confirm(`Delete all stored data for "${key}"?`)) return;
      await chrome.storage.local.remove(key);
      renderProperties();
    });

    tbody.appendChild(tr);
  }
}

// Populate property datalist from existing storage keys
async function populatePropertyList() {
  const data = await chrome.storage.local.get(null);
  const datalist = document.getElementById('cron-property-list');
  Object.keys(data)
    .filter((k) => k !== 'cronJobs')
    .forEach((key) => {
      const opt = document.createElement('option');
      opt.value = key;
      datalist.appendChild(opt);
    });
}

// Show/hide day selector for weekly
document.getElementById('cron-schedule').addEventListener('change', function () {
  document.getElementById('cron-day-col').style.display = this.value === '10080' ? '' : 'none';
});

// Form submission
document.getElementById('cron-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const property = document.getElementById('cron-property').value.trim();
  const periodInMinutes = Number(document.getElementById('cron-schedule').value);
  const time = document.getElementById('cron-time').value || '03:00';
  const dayOfWeek = Number(document.getElementById('cron-day').value);
  if (!property) return;
  renderJobs(await addJob(property, periodInMinutes, time, dayOfWeek));
  document.getElementById('cron-property').value = '';
});

// Init
(async () => {
  await populatePropertyList();
  await renderProperties();
  renderJobs(await loadJobs());
})();
