// Shared UI helpers for the crawl-stats and options pages.

import './theme.css';

/** 7833981 → "7.8 MB" (SI units, as GSC reports). Non-numbers → "-". */
export function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = Math.abs(n);
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  const s = i === 0 ? String(Math.round(v)) : v.toFixed(v < 10 ? 1 : 0);
  return `${n < 0 ? '-' : ''}${s} ${units[i]}`;
}

/** Whole days between a YYYY-MM-DD date (local) and today. */
export function daysSince(dateStr, now = new Date()) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - then) / 86400000);
}

export function relativeDays(dateStr, now = new Date()) {
  const n = daysSince(dateStr, now);
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  return `${n} days ago`;
}

/** Follow the OS light/dark setting (Bootstrap 5.3 colour modes). */
export function applySystemTheme() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => { document.documentElement.dataset.bsTheme = mq.matches ? 'dark' : 'light'; };
  apply();
  mq.addEventListener('change', apply);
}

/**
 * Map internal errors to something a user can act on. Accepts an Error, a
 * {code, message} pair (as stored on scheduled jobs) or a plain string; also
 * recognises messages stored by older versions, which had no code.
 */
export function friendlyError(err) {
  const code = err?.code ?? null;
  const msg = String((typeof err === 'string' ? err : err?.message) || '');

  if (code === 'NOT_LOGGED_IN' || /^Not signed in to Google Search Console/.test(msg)) {
    return 'You are not signed in to Google Search Console in this browser.';
  }
  if (code === 'WIZ_PARSE' || /page format may have changed/.test(msg)) {
    return 'Search Console changed its page format, so the extension can’t read it. Please report this on GitHub.';
  }
  if (code === 'ALL_FAILED' || /^All \d+ exports failed/.test(msg)) {
    return 'None of the exports could be downloaded. Check that this Google account still has access to the property.';
  }
  if (code === 'NETWORK' || /Failed to fetch|NetworkError|network/i.test(msg) ||
      (code == null && typeof navigator !== 'undefined' && navigator.onLine === false && !msg)) {
    return 'Couldn’t reach Google. Check your internet connection and try again.';
  }
  if (/HTTP (401|403)\b/.test(msg)) return 'Google refused the request. Check that this account has access to the property.';
  if (/HTTP 5\d\d\b/.test(msg)) return 'Google’s servers returned an error. Try again later.';
  if (/HTTP 429\b/.test(msg)) return 'Google is rate-limiting requests. Try again later.';
  return msg ? `Something went wrong: ${msg}` : 'Something went wrong.';
}

/** User-facing text for a scheduled job's last error (stored as raw message + code). */
export const jobErrorText = (job) => friendlyError({ code: job.lastErrorCode ?? null, message: job.lastError });

/** Accepts https://example.com/ (URL-prefix property, trailing slash) or sc-domain:example.com. */
export const PROPERTY_RE = /^(https?:\/\/[^\s/]+\/\S*|sc-domain:[^\s/]+)$/;
export const isValidProperty = (s) => PROPERTY_RE.test(s) && (!s.startsWith('http') || s.endsWith('/'));

/**
 * Two-step inline confirm for destructive buttons: the first click arms the
 * button ("Confirm"), a second click within `timeout` ms runs onConfirm.
 */
export function confirmButton(btn, onConfirm, { label = 'Confirm', timeout = 4000 } = {}) {
  let armed = null;
  const original = { className: btn.className, nodes: [...btn.childNodes], aria: btn.getAttribute('aria-label') };

  function disarm() {
    clearTimeout(armed);
    armed = null;
    btn.className = original.className;
    btn.replaceChildren(...original.nodes);
    if (original.aria) btn.setAttribute('aria-label', original.aria);
  }

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!armed) {
      btn.className = original.className.replace(/btn-outline-danger/, 'btn-danger');
      btn.textContent = label;
      btn.setAttribute('aria-label', `Click again to confirm: ${original.aria || 'delete'}`);
      armed = setTimeout(disarm, timeout);
      return;
    }
    disarm();
    btn.disabled = true;
    try { await onConfirm(); } finally { btn.disabled = false; }
  });
  btn.addEventListener('blur', () => { if (armed) setTimeout(() => armed && disarm(), 150); });
}
