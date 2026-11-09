import {
  buildExportUrls,
  delay,
  fetchWIZtokens,
  fetchZip,
  mergeGscData,
  parseDrilldownZip,
  parseSummaryZip,
} from './lib/gsc.js';
import { ALARM_PREFIX, alarmName, normalizeJob, scheduleJobAlarm } from './lib/schedule.js';

// ── Extension lifecycle ──────────────────────────────────────

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('crawl-stats.html') });
});

// Alarms can be lost on update/reinstall and on browser restart; also migrates
// legacy (sub-daily, periodic) jobs from ≤ v2.1 to daily one-shot alarms.
chrome.runtime.onInstalled.addListener(() => { restoreAlarms(); });
chrome.runtime.onStartup.addListener(() => { restoreAlarms(); });

async function restoreAlarms() {
  const { cronJobs = {} } = await chrome.storage.local.get('cronJobs');
  let dirty = false;
  for (const [id, job] of Object.entries(cronJobs)) {
    const { job: normalized, changed } = normalizeJob(job);
    if (changed) { cronJobs[id] = normalized; dirty = true; }
  }
  if (dirty) await chrome.storage.local.set({ cronJobs });

  // Drop alarms whose job no longer exists, then (re)schedule every job.
  for (const alarm of await chrome.alarms.getAll()) {
    if (alarm.name.startsWith(ALARM_PREFIX) && !cronJobs[alarm.name.slice(ALARM_PREFIX.length)]) {
      await chrome.alarms.clear(alarm.name);
    }
  }
  for (const job of Object.values(cronJobs)) await scheduleJobAlarm(job);
}

// ── Messages from the options page ───────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  if (request.type === 'runCronJob') {
    runJobAndRecord(request.jobId).then(sendResponse);
    return true; // keep channel open for async sendResponse
  }
  if (request.type === 'rescheduleAlarms') {
    restoreAlarms().then(() => sendResponse({ success: true }), (err) => sendResponse({ error: err.message }));
    return true;
  }
  return false;
});

// ── Alarm handler ────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const jobId = alarm.name.slice(ALARM_PREFIX.length);
  // Arm the next one-shot alarm *before* running: if the worker is killed
  // mid-run, the schedule must not be lost.
  const { cronJobs = {} } = await chrome.storage.local.get('cronJobs');
  if (cronJobs[jobId]) await scheduleJobAlarm(cronJobs[jobId]);
  await runJobAndRecord(jobId);
});

/**
 * Run a job, record lastRun / lastError on it, and schedule its next run.
 * Re-reads cronJobs after the (long) run so concurrent edits on the options
 * page aren't overwritten.
 */
async function runJobAndRecord(jobId) {
  const { cronJobs = {} } = await chrome.storage.local.get('cronJobs');
  const job = cronJobs[jobId];
  if (!job) {
    await chrome.alarms.clear(alarmName(jobId));
    return { error: 'Job not found' };
  }

  let error = null;
  try {
    await runCronJob(job);
  } catch (err) {
    error = err.message || String(err);
    console.error('[cron] Job failed for', job.property, err);
  }

  const { cronJobs: latest = {} } = await chrome.storage.local.get('cronJobs');
  const current = latest[jobId];
  if (!current) return error ? { error } : { success: true };

  if (error) {
    current.lastError = error;
    current.lastErrorAt = new Date().toISOString();
  } else {
    current.lastRun = new Date().toISOString();
    current.lastError = null;
    current.lastErrorAt = null;
  }
  await chrome.storage.local.set({ cronJobs: latest });
  await scheduleJobAlarm(current);
  return error ? { error } : { success: true };
}

// ── Download ─────────────────────────────────────────────────

/** Merge a fragment into the stored property data and persist it immediately. */
async function persistFragment(property, fragment) {
  if (Object.keys(fragment).length === 0) return;
  const stored = await chrome.storage.local.get(property);
  await chrome.storage.local.set({ [property]: mergeGscData(stored[property], fragment) });
}

/**
 * Downloads the summary and every drilldown, writing each one to storage as it
 * arrives. The per-row storage calls keep the MV3 service worker alive and mean
 * an interrupted run still leaves valid partial data.
 */
async function runCronJob(job) {
  const { QrtxK, SNlM0e } = await fetchWIZtokens();
  const settings = { resource_id: job.property };
  const { summaryUrl, drilldowns } = buildExportUrls(settings, QrtxK, SNlM0e);

  let failed = 0;
  try {
    const { zip } = await fetchZip(summaryUrl);
    await persistFragment(job.property, await parseSummaryZip(zip, settings));
  } catch (err) {
    failed++;
    console.warn('[cron] Summary failed:', err.message);
  }

  for (const row of drilldowns) {
    try {
      const { zip } = await fetchZip(row.url);
      await persistFragment(job.property, await parseDrilldownZip(zip, row, settings));
    } catch (err) {
      failed++;
      console.warn('[cron] Skipping', row.category, row.id, err.message);
    }
    await delay(200);
  }

  const total = drilldowns.length + 1;
  if (failed === total) throw new Error(`All ${total} exports failed — check GSC access for ${job.property}`);
}
