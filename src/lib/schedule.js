// Shared scheduling helpers for cron jobs (service worker + options page).

export const ALARM_PREFIX = 'gsc-cron-';
export const alarmName = (id) => ALARM_PREFIX + id;

const DAILY = 1440;
const WEEKLY = 10080;

// GSC crawl stats update at most once a day, so nothing faster than daily is offered.
export const SCHEDULES = {
  [DAILY]: 'Daily',
  [WEEKLY]: 'Weekly',
};

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Next occurrence of `timeStr` (HH:MM, local time) — and of `dayOfWeek` for
 * weekly jobs — strictly after now. Computed in wall-clock time, so it stays
 * correct across DST changes.
 */
export function nextFiringTime(periodInMinutes, timeStr = '03:00', dayOfWeek = 1) {
  const [h, m] = (timeStr || '03:00').split(':').map(Number);
  const now = new Date();
  const candidate = new Date(now);
  candidate.setHours(h, m, 0, 0);

  if (periodInMinutes === WEEKLY) {
    const diff = ((dayOfWeek ?? 1) - candidate.getDay() + 7) % 7;
    candidate.setDate(candidate.getDate() + diff);
    if (candidate <= now) candidate.setDate(candidate.getDate() + 7);
  } else if (candidate <= now) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate.getTime();
}

/**
 * Clamp legacy intervals (hourly / 6h / 12h from ≤ v2.1) to daily and fill defaults.
 * Returns a new object; `changed` tells the caller whether to persist it.
 */
export function normalizeJob(job) {
  const periodInMinutes = job.periodInMinutes >= WEEKLY ? WEEKLY : DAILY;
  const normalized = {
    ...job,
    periodInMinutes,
    time: job.time || '03:00',
    dayOfWeek: job.dayOfWeek ?? 1,
  };
  const changed =
    normalized.periodInMinutes !== job.periodInMinutes ||
    normalized.time !== job.time ||
    normalized.dayOfWeek !== job.dayOfWeek;
  return { job: normalized, changed };
}

/**
 * (Re)create the job's alarm as a one-shot at its next wall-clock time.
 * The service worker reschedules after every run; a periodic alarm would
 * drift by an hour across DST.
 */
export async function scheduleJobAlarm(job) {
  await chrome.alarms.clear(alarmName(job.id));
  if (!job.enabled) return;
  await chrome.alarms.create(alarmName(job.id), {
    when: nextFiringTime(job.periodInMinutes, job.time, job.dayOfWeek),
  });
}
