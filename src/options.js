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

function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    new JSZip().loadAsync(reader.result).then((zip) => {
      zip.file('backup.json').async('string').then((fileData) => {
        try {
          chrome.storage.local.set(JSON.parse(fileData));
        } catch (e) {
          console.error(e);
        }
      });
    });
  };
  reader.readAsBinaryString(file);
}

document.getElementById('backup').addEventListener('click', backupData);

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

async function addJob(property, periodInMinutes) {
  const cronJobs = await loadJobs();
  const id = uid();
  cronJobs[id] = {
    id,
    property,
    periodInMinutes,
    scheduleLabel: SCHEDULES[String(periodInMinutes)] || `Every ${periodInMinutes} min.`,
    enabled: true,
    lastRun: null,
    createdAt: new Date().toISOString(),
  };
  await saveJobs(cronJobs);
  chrome.alarms.create('gsc-cron-' + id, { periodInMinutes });
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
    chrome.alarms.create('gsc-cron-' + id, { periodInMinutes: job.periodInMinutes });
  } else {
    chrome.alarms.clear('gsc-cron-' + id);
  }
  return cronJobs;
}

function renderJobs(cronJobs) {
  const tbody = document.getElementById('cron-tbody');
  const emptyRow = document.getElementById('cron-empty');
  const jobs = Object.values(cronJobs);

  // Remove all job rows (keep the empty-placeholder row)
  [...tbody.querySelectorAll('tr[data-job-id]')].forEach((r) => r.remove());
  emptyRow.style.display = jobs.length ? 'none' : '';

  jobs.forEach((job) => {
    const lastRun = job.lastRun
      ? new Date(job.lastRun).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
      : '—';

    const tr = document.createElement('tr');
    tr.dataset.jobId = job.id;
    tr.innerHTML = `
      <td class="text-truncate" style="max-width:260px" title="${job.property}">
        <code class="small">${job.property}</code>
      </td>
      <td class="text-nowrap">${job.scheduleLabel}</td>
      <td class="text-nowrap">${lastRun}</td>
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
  });
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

// Form submission
document.getElementById('cron-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const property = document.getElementById('cron-property').value.trim();
  const periodInMinutes = Number(document.getElementById('cron-schedule').value);
  if (!property) return;
  renderJobs(await addJob(property, periodInMinutes));
  document.getElementById('cron-property').value = '';
});

// Init
(async () => {
  await populatePropertyList();
  renderJobs(await loadJobs());
})();
