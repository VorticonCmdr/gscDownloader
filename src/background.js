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

// Focus an already-open crawl-stats tab instead of piling up new ones.
chrome.action.onClicked.addListener(async () => {
  const pageUrl = chrome.runtime.getURL('crawl-stats.html');
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    const existing = contexts.find((c) => c.tabId >= 0 && c.documentUrl?.startsWith(pageUrl));
    if (existing) {
      await chrome.tabs.update(existing.tabId, { active: true });
      if (existing.windowId >= 0) await chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
  } catch (err) {
    console.warn('Could not look up open tabs:', err.message);
  }
  chrome.tabs.create({ url: pageUrl });
});

// Alarms can be lost on update/reinstall and on browser restart; also migrates
// legacy (sub-daily, periodic) jobs from ≤ v2.1 to daily one-shot alarms.
chrome.runtime.onInstalled.addListener(() => { restoreAlarms(); });
chrome.runtime.onStartup.addListener(() => { restoreAlarms(); });

// ── Toolbar badge: flag failed scheduled downloads ───────────

// Same tooltip as the manifest's action.default_title, so it doesn't change after a badge update.
const DEFAULT_TITLE = chrome.runtime.getManifest().action?.default_title || chrome.runtime.getManifest().name;

async function updateFailureBadge(cronJobs) {
  if (!cronJobs) ({ cronJobs = {} } = await chrome.storage.local.get('cronJobs'));
  const failed = Object.values(cronJobs).filter((j) => j.lastError);
  await chrome.action.setBadgeText({ text: failed.length ? '!' : '' });
  if (failed.length) {
    await chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
    await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
    await chrome.action.setTitle({
      title: `${DEFAULT_TITLE}: ${failed.length} scheduled download${failed.length > 1 ? 's' : ''} failed. Details in settings.`,
    });
  } else {
    await chrome.action.setTitle({ title: DEFAULT_TITLE });
  }
}

// Covers job runs, and deletes/toggles/restores from the options page.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.cronJobs) updateFailureBadge(changes.cronJobs.newValue || {});
});

/** @param {{force?: boolean}} opts force: reschedule every job (used after a backup restore). */
async function restoreAlarms({ force = false } = {}) {
  const { cronJobs = {} } = await chrome.storage.local.get('cronJobs');
  const changedIds = new Set();
  for (const [id, job] of Object.entries(cronJobs)) {
    const { job: normalized, changed } = normalizeJob(job);
    if (changed) { cronJobs[id] = normalized; changedIds.add(id); }
  }
  if (changedIds.size) await chrome.storage.local.set({ cronJobs });

  const alarms = new Map(
    (await chrome.alarms.getAll())
      .filter((a) => a.name.startsWith(ALARM_PREFIX))
      .map((a) => [a.name.slice(ALARM_PREFIX.length), a])
  );

  // Drop alarms whose job no longer exists.
  for (const [id, alarm] of alarms) {
    if (!cronJobs[id]) await chrome.alarms.clear(alarm.name);
  }

  // (Re)schedule only where needed. An existing one-shot alarm is left alone, even if
  // overdue: on browser start Chrome fires missed alarms, and replacing it here
  // would silently skip that run.
  for (const [id, job] of Object.entries(cronJobs)) {
    const alarm = alarms.get(id);
    const isLegacyPeriodic = alarm?.periodInMinutes != null;
    const needsAlarm = job.enabled && (force || !alarm || isLegacyPeriodic || changedIds.has(id));
    const strayAlarm = !job.enabled && alarm;
    if (needsAlarm || strayAlarm) await scheduleJobAlarm(job);
  }

  await updateFailureBadge(cronJobs);
}

// ── Messages from the options page ───────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  if (request.type === 'runCronJob') {
    runJobAndRecord(request.jobId).then(sendResponse);
    return true; // keep channel open for async sendResponse
  }
  if (request.type === 'rescheduleAlarms') {
    restoreAlarms({ force: true }).then(() => sendResponse({ success: true }), (err) => sendResponse({ error: err.message }));
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

  // Store the raw message plus a machine-readable code; the pages turn them into
  // user-facing text (friendlyError), so stored data stays accurate.
  let error = null;
  let errorCode = null;
  try {
    await runCronJob(job);
  } catch (err) {
    error = err.message || String(err);
    errorCode = err.code || (err instanceof TypeError ? 'NETWORK' : null);
    console.error('[cron] Job failed for', job.property, err);
  }

  const { cronJobs: latest = {} } = await chrome.storage.local.get('cronJobs');
  const current = latest[jobId];
  if (!current) return error ? { error } : { success: true };

  if (error) {
    current.lastError = error;
    current.lastErrorCode = errorCode;
    current.lastErrorAt = new Date().toISOString();
  } else {
    current.lastRun = new Date().toISOString();
    current.lastError = null;
    current.lastErrorCode = null;
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
  if (failed === total) {
    const err = new Error(`All ${total} exports failed for ${job.property}`);
    err.code = 'ALL_FAILED';
    throw err;
  }
}
