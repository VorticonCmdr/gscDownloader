import JSZip from 'jszip';
import Papa from 'papaparse';

// ── Extension lifecycle ──────────────────────────────────────

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('crawl-stats.html') });
});

// Re-create alarms that may have been lost after extension update/reinstall
chrome.runtime.onInstalled.addListener(restoreAlarms);

function nextFiringTime(periodInMinutes, timeStr, dayOfWeek) {
  const [h, m] = (timeStr || '03:00').split(':').map(Number);
  const now = new Date();
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setHours(h, m);
  if (periodInMinutes === 10080) {
    const diff = ((dayOfWeek ?? 1) - candidate.getDay() + 7) % 7;
    candidate.setDate(candidate.getDate() + diff);
    if (candidate <= now) candidate.setDate(candidate.getDate() + 7);
  } else {
    if (candidate <= now) {
      const n = Math.ceil((now - candidate) / (periodInMinutes * 60000));
      candidate.setTime(candidate.getTime() + n * periodInMinutes * 60000);
    }
  }
  return candidate.getTime();
}

async function restoreAlarms() {
  const { cronJobs = {} } = await chrome.storage.local.get('cronJobs');
  for (const job of Object.values(cronJobs)) {
    if (!job.enabled) continue;
    const existing = await chrome.alarms.get('gsc-cron-' + job.id);
    if (!existing) {
      chrome.alarms.create('gsc-cron-' + job.id, {
        when: nextFiringTime(job.periodInMinutes, job.time, job.dayOfWeek),
        periodInMinutes: job.periodInMinutes,
      });
    }
  }
}

// ── Message handler (e.g. "run now" from options page) ───────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type !== 'runCronJob') return false;

  (async () => {
    const { cronJobs = {} } = await chrome.storage.local.get('cronJobs');
    const job = cronJobs[request.jobId];
    if (!job) { sendResponse({ error: 'Job not found' }); return; }

    try {
      await runCronJob(job);
      const { cronJobs: updated = {} } = await chrome.storage.local.get('cronJobs');
      if (updated[request.jobId]) {
        updated[request.jobId].lastRun = new Date().toISOString();
        await chrome.storage.local.set({ cronJobs: updated });
      }
      sendResponse({ success: true });
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();

  return true; // keep channel open for async sendResponse
});

// ── Alarm handler ────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('gsc-cron-')) return;
  const jobId = alarm.name.slice('gsc-cron-'.length);
  const { cronJobs = {} } = await chrome.storage.local.get('cronJobs');
  const job = cronJobs[jobId];
  if (!job || !job.enabled) return;

  try {
    await runCronJob(job);
    cronJobs[jobId].lastRun = new Date().toISOString();
    await chrome.storage.local.set({ cronJobs });
  } catch (err) {
    console.error('[cron] Job failed for', job.property, err);
  }
});

// ── WIZ token extraction (no DOMParser in service workers) ───

function extractWIZfromHTML(html) {
  const marker = 'window.WIZ_global_data = ';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) throw new Error('WIZ_global_data not found in HTML');

  const jsonStart = markerIdx + marker.length;
  let depth = 0, inString = false, endIdx = -1;
  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];
    if (ch === '"' && html[i - 1] !== '\\') inString = !inString;
    if (!inString) {
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { endIdx = i; break; }
    }
  }
  if (endIdx === -1) throw new Error('Could not parse WIZ_global_data boundaries');
  return JSON.parse(html.slice(jsonStart, endIdx + 1));
}

async function fetchWIZtokens() {
  const resp = await fetch('https://search.google.com/search-console', {
    mode: 'cors',
    credentials: 'include',
  });
  if (!resp.ok) throw new Error(`GSC fetch failed: HTTP ${resp.status}`);
  const html = await resp.text();
  const data = extractWIZfromHTML(html);
  return { QrtxK: data.QrtxK, SNlM0e: data.SNlM0e };
}

// ── Download helpers ─────────────────────────────────────────

function generateUrls(dlSettings, QrtxK, SNlM0e) {
  const base = `https://search.google.com/u/${QrtxK}/search-console/export/crawl-stats/drilldown`;
  const common = {
    hl: 'en',
    resource_id: dlSettings.resource_id,
    request_type: '3',
    at: SNlM0e,
    ...(dlSettings.hostname ? { hostname: dlSettings.hostname } : {}),
  };

  function makeURL(override) {
    const url = new URL(base);
    Object.entries({ ...common, ...override }).forEach(([k, v]) => url.searchParams.set(k, v));
    return url.href;
  }

  const urls = [];
  [1,2,3,4,5,6,7,9,10,11,12,13,15,16,17,18,19,20].forEach(t =>
    urls.push({ url: makeURL({ response: t }), category: 'response' }));
  [1,11,4,5,2,12,10,6,7,3,9,13,14].forEach(t =>
    urls.push({ url: makeURL({ file_type: t }), category: 'file_type' }));
  [1,2].forEach(t =>
    urls.push({ url: makeURL({ purpose: t }), category: 'purpose' }));
  [1,2,3,4,5,6,7,8,9].forEach(t =>
    urls.push({ url: makeURL({ googlebot_type: t }), category: 'googlebot_type' }));
  return urls;
}

async function fetchZip(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return JSZip.loadAsync(await resp.blob());
}

async function downloadSummary(dlSettings, QrtxK, SNlM0e, dlGscData) {
  const url = new URL(`https://search.google.com/u/${QrtxK}/search-console/export/crawl-stats`);
  Object.entries({
    hl: 'en',
    resource_id: dlSettings.resource_id,
    request_type: '3',
    at: SNlM0e,
    ...(dlSettings.hostname ? { hostname: dlSettings.hostname } : {}),
  }).forEach(([k, v]) => url.searchParams.set(k, v));

  const zip = await fetchZip(url.href);
  const csv = await zip.files['Summary crawl stats chart.csv'].async('string');
  Papa.parse(csv, { dynamicTyping: true, header: true }).data.forEach((item) => {
    if (!item['Date']) return;
    if (!dlGscData[item['Date']]) dlGscData[item['Date']] = {};
    dlGscData[item['Date']]['summary'] = {
      category: 'summary',
      type: 'total',
      resource_id: dlSettings.resource_id,
      hostname: dlSettings.hostname || dlSettings.resource_id,
      'Average response time (ms)': item['Average response time (ms)'],
      'Total crawl requests': item['Total crawl requests'],
      'Total download size (Bytes)': item['Total download size (Bytes)'],
    };
  });
}

async function downloadStatsFile(row, dlSettings, dlGscData) {
  const zip = await fetchZip(row.url);
  const metaCsv = await zip.files['Metadata.csv'].async('string');
  const dataType = Papa.parse(metaCsv, { dynamicTyping: true, header: true }).data[0]?.['Value'];
  if (!dataType) return;

  const chartCsv = await zip.files['Chart.csv'].async('string');
  Papa.parse(chartCsv, { dynamicTyping: true, header: true }).data.forEach((item) => {
    if (!item['Date']) return;
    if (!dlGscData[item['Date']]) dlGscData[item['Date']] = {};
    dlGscData[item['Date']][dataType] = {
      category: row.category,
      type: dataType,
      resource_id: dlSettings.resource_id,
      hostname: dlSettings.hostname || dlSettings.resource_id,
      'Average response time (ms)': item['Average response time (ms)'],
      'Total crawl requests': item['Total crawl requests'],
      'Total download size (Bytes)': item['Total download size (Bytes)'],
    };
  });
}

async function runCronJob(job) {
  const { QrtxK, SNlM0e } = await fetchWIZtokens();
  const dlSettings = { resource_id: job.property };
  const dlGscData = {};

  await downloadSummary(dlSettings, QrtxK, SNlM0e, dlGscData);

  for (const row of generateUrls(dlSettings, QrtxK, SNlM0e)) {
    try {
      await downloadStatsFile(row, dlSettings, dlGscData);
    } catch (err) {
      console.warn('[cron] Skipping', row.url, err.message);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Merge with existing storage data
  const stored = await chrome.storage.local.get(job.property);
  const existing = stored[job.property] || {};
  const merged = { ...existing };
  Object.entries(dlGscData).forEach(([date, types]) => {
    merged[date] = { ...(merged[date] || {}), ...types };
  });
  await chrome.storage.local.set({ [job.property]: merged });
}
