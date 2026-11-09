// Shared GSC crawl-stats download pipeline.
// Used by the service worker (scheduled jobs) and the crawl-stats page.
// String-based only — no DOMParser, so it runs in a service worker.

import JSZip from 'jszip';
import Papa from 'papaparse';

const GSC_HOME = 'https://search.google.com/search-console';
const WIZ_MARKER = 'window.WIZ_global_data = ';

export const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── WIZ token extraction ─────────────────────────────────────

/**
 * Extract the WIZ_global_data JSON object from the GSC HTML page.
 * Throws an error with code 'NOT_LOGGED_IN' when the marker is absent
 * (signed-out pages don't carry it), or 'WIZ_PARSE' when it can't be parsed.
 */
export function extractWIZfromHTML(html) {
  const markerIdx = html.indexOf(WIZ_MARKER);
  if (markerIdx === -1) {
    const err = new Error('Not signed in to Google Search Console');
    err.code = 'NOT_LOGGED_IN';
    throw err;
  }

  const jsonStart = markerIdx + WIZ_MARKER.length;
  let depth = 0;
  let inString = false;
  let endIdx = -1;
  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];
    if (ch === '"') {
      // Toggle only on an unescaped quote: an even number of preceding backslashes.
      let backslashes = 0;
      for (let j = i - 1; j >= jsonStart && html[j] === '\\'; j--) backslashes++;
      if (backslashes % 2 === 0) inString = !inString;
    } else if (!inString) {
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { endIdx = i; break; }
    }
  }

  try {
    if (endIdx === -1) throw new Error('unterminated object');
    return JSON.parse(html.slice(jsonStart, endIdx + 1));
  } catch (cause) {
    const err = new Error('Could not parse GSC page data (page format may have changed)');
    err.code = 'WIZ_PARSE';
    err.cause = cause;
    throw err;
  }
}

/**
 * Fetch the GSC home page with the user's session and return the tokens
 * needed for export URLs, the signed-in email, and the raw HTML
 * (the crawl-stats page parses the property list out of it).
 */
export async function fetchWIZtokens() {
  const resp = await fetch(GSC_HOME, { mode: 'cors', credentials: 'include' });
  if (!resp.ok) throw new Error(`GSC fetch failed: HTTP ${resp.status}`);
  const html = await resp.text();
  const data = extractWIZfromHTML(html);
  // QrtxK is the /u/N/ account index and may legitimately be 0.
  if (data.QrtxK == null || !data.SNlM0e) {
    const err = new Error('Not signed in to Google Search Console');
    err.code = 'NOT_LOGGED_IN';
    throw err;
  }
  return { QrtxK: data.QrtxK, SNlM0e: data.SNlM0e, email: data.oPEP7c || null, html };
}

// ── Export URLs ──────────────────────────────────────────────

const DRILLDOWNS = {
  response: [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20],
  file_type: [1, 11, 4, 5, 2, 12, 10, 6, 7, 3, 9, 13, 14],
  purpose: [1, 2],
  googlebot_type: [1, 2, 3, 4, 5, 6, 7, 8, 9],
};

/**
 * @param {{resource_id: string, hostname?: string}} settings
 * @returns {{summaryUrl: string, drilldowns: {url: string, category: string, id: number}[]}}
 */
export function buildExportUrls(settings, QrtxK, SNlM0e) {
  const common = {
    hl: 'en',
    resource_id: settings.resource_id,
    request_type: '3',
    at: SNlM0e,
    ...(settings.hostname ? { hostname: settings.hostname } : {}),
  };
  const base = `https://search.google.com/u/${QrtxK}/search-console/export/crawl-stats`;

  function makeURL(path, extra = {}) {
    const url = new URL(base + path);
    Object.entries({ ...common, ...extra }).forEach(([k, v]) => url.searchParams.set(k, v));
    return url.href;
  }

  const drilldowns = [];
  for (const [category, ids] of Object.entries(DRILLDOWNS)) {
    for (const id of ids) {
      drilldowns.push({ url: makeURL('/drilldown', { [category]: id }), category, id });
    }
  }
  return { summaryUrl: makeURL(''), drilldowns };
}

// ── ZIP parsing ──────────────────────────────────────────────

export async function fetchZip(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  return { blob, resp, zip: await JSZip.loadAsync(blob) };
}

async function readCsv(zip, name) {
  const file = zip.file(name);
  if (!file) throw new Error(`${name} missing from export`);
  return Papa.parse(await file.async('string'), { dynamicTyping: true, header: true }).data;
}

function baseRow(settings) {
  return {
    resource_id: settings.resource_id,
    hostname: settings.hostname || settings.resource_id,
  };
}

/** @returns {Object<string, Object<string, object>>} fragment keyed by date → type */
export async function parseSummaryZip(zip, settings) {
  const fragment = {};
  for (const item of await readCsv(zip, 'Summary crawl stats chart.csv')) {
    if (!item['Date']) continue;
    fragment[item['Date']] = {
      summary: {
        category: 'summary',
        type: 'total',
        ...baseRow(settings),
        'Average response time (ms)': item['Average response time (ms)'],
        'Total crawl requests': item['Total crawl requests'],
        'Total download size (Bytes)': item['Total download size (Bytes)'],
      },
    };
  }
  return fragment;
}

/** @returns {Object<string, Object<string, object>>} fragment keyed by date → type (empty if no data type) */
export async function parseDrilldownZip(zip, row, settings) {
  const fragment = {};
  const dataType = (await readCsv(zip, 'Metadata.csv'))[0]?.['Value'];
  if (!dataType) return fragment;

  for (const item of await readCsv(zip, 'Chart.csv')) {
    if (!item['Date']) continue;
    fragment[item['Date']] = {
      [dataType]: {
        category: row.category,
        type: dataType,
        ...baseRow(settings),
        'Average response time (ms)': item['Average response time (ms)'],
        'Total crawl requests': item['Total crawl requests'],
        'Total download size (Bytes)': item['Total download size (Bytes)'],
        'Affected pages': item['Affected pages'],
      },
    };
  }
  return fragment;
}

// ── Merging ──────────────────────────────────────────────────

/**
 * Date-level merge: union of dates; for a shared date, types from `fragment`
 * overwrite types in `existing`. Never removes data. Returns a new object.
 */
export function mergeGscData(existing = {}, fragment = {}) {
  const merged = { ...existing };
  for (const [date, types] of Object.entries(fragment)) {
    merged[date] = { ...(merged[date] || {}), ...types };
  }
  return merged;
}

/** Storage keys that are not property datasets. */
export const RESERVED_KEYS = new Set(['cronJobs']);
export const isPropertyKey = (k) => !RESERVED_KEYS.has(k);
