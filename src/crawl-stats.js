import bb, { line } from 'billboard.js';
import 'billboard.js/dist/billboard.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Dropdown } from 'bootstrap';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import 'tabulator-tables/dist/css/tabulator_bootstrap5.min.css';
import {
  buildExportUrls,
  delay,
  fetchWIZtokens,
  fetchZip,
  isPropertyKey,
  mergeGscData,
  parseDrilldownZip,
  parseSummaryZip,
} from './lib/gsc.js';
import { hydrateIcons } from './lib/icons.js';
import { applySystemTheme, daysSince, formatBytes, friendlyError, jobErrorText, relativeDays } from './lib/ui.js';

applySystemTheme();
hydrateIcons();

const APP_TITLE = 'GSC Crawl Stats';

let chromeDownload = false;
let downloading = false;
let chart;

// Semantic palette for response codes: 2xx green, 3xx blue, 4xx orange, 5xx red,
// unreachable/robots/redirect errors purple. Other breakdowns use Billboard defaults.
const colors = {
  'OK (200)': '#2e9e44',
  'Not modified (304)': '#7cc68a',
  'Moved permanently (301)': '#1f77b4',
  'Moved temporarily (302)': '#5fa2dd',
  'Moved (other)': '#9cc5ea',
  'Not found (404)': '#f28e2b',
  'Unauthorized (401/407)': '#e15759',
  'Other client error (4XX)': '#ffbe7d',
  'Server error (5XX)': '#c0392b',
  'Page could not be reached': '#8e44ad',
  'robots.txt not available': '#b07cc6',
  'Redirect error': '#5b2c6f',
  'summary': '#555555',
};

const METRICS = {
  'Total crawl requests': { axis: 'Crawl requests', format: (n) => n.toLocaleString(), unit: (n) => `${n.toLocaleString()} requests` },
  'Total download size (Bytes)': { axis: 'Download size', format: formatBytes, unit: formatBytes },
  'Average response time (ms)': { axis: 'Avg. response time (ms)', format: (n) => n.toLocaleString(), unit: (n) => `${n.toLocaleString()} ms` },
};

const CATEGORY_LABELS = {
  summary: 'summary',
  response: 'response codes',
  file_type: 'file types',
  purpose: 'crawl purpose',
  googlebot_type: 'Googlebot types',
};

let chartConfig = { metric: 'Total crawl requests' };

function shortLabel(url) {
  try { return new URL(url).hostname || url; } catch { return url; }
}

function numberToLocaleString(cell) {
  const value = cell.getValue();
  return typeof value === 'number' ? value.toLocaleString() : '-';
}

function bytesFormatter(cell) {
  return formatBytes(cell.getValue());
}

function headerFilterGte(headerValue, rowValue) {
  return headerValue === '' || headerValue === null || rowValue >= Number(headerValue);
}

// CSV headers keep the original field names (titleDownload) so exports stay
// compatible with v2.2 and earlier, whatever the on-screen column titles are.
const numberCol = (title, field, formatter = numberToLocaleString) => ({
  title, field, titleDownload: field, sorter: 'number', formatter, hozAlign: 'right',
  headerFilter: 'input', headerFilterPlaceholder: '≥ min', headerFilterFunc: headerFilterGte,
});

const columns = [
  { title: 'Date', field: 'Date', sorter: 'string', minWidth: 120, headerFilter: 'input', headerFilterPlaceholder: 'YYYY-MM' },
  { title: 'resource_id', field: 'resource_id', visible: false, download: true },
  // Same value on every row (the property is in the box above); kept for CSV export.
  { title: 'hostname', field: 'hostname', visible: false, download: true },
  // Always a single value: the breakdown dropdown above filters by it; kept for CSV export.
  { title: 'category', field: 'category', visible: false, download: true },
  {
    title: 'Type', field: 'type', titleDownload: 'type', sorter: 'string',
    headerFilter: 'list',
    headerFilterParams: { valuesLookup: 'active', clearable: true, autocomplete: true, listOnEmpty: true },
    headerFilterPlaceholder: 'All types',
  },
  numberCol('Crawl requests', 'Total crawl requests'),
  numberCol('Download size', 'Total download size (Bytes)', bytesFormatter),
  numberCol('Avg. response time (ms)', 'Average response time (ms)'),
  { title: 'Affected pages', field: 'Affected pages', sorter: 'number', formatter: numberToLocaleString, hozAlign: 'right', visible: false, download: true },
];

// Cache DOM references
const $ = (id) => document.getElementById(id);
const elMetric = $('metric');
const elCategory = $('category');
const elHostname = $('hostname');
const elHostnameList = $('hostname-list');
const elDownloadBtnTxt = $('downloadBtnTxt');
const elDownloadToggleBtn = $('downloadToggleBtn');
const elErrorMsg = $('errorMsg');
const elErrorMsgText = $('errorMsgText');
const elNotLoggedInMsg = $('notLoggedInMsg');
const elUserEmail = $('userEmail');
const elUserEmailText = $('userEmailText');
const elFetchBar = $('fetchBar');
const elFetchProgress = $('fetchProgress');
const elFetchProgressLabel = $('fetchProgressLabel');
const elExportFilteredBtn = $('exportFilteredBtn');
const elDataFreshness = $('dataFreshness');
const elInvertSelectionBtn = $('invertSelectionBtn');
const elEmptyState = $('emptyState');
const elDataView = $('dataView');

document.querySelectorAll('[data-bs-toggle="dropdown"]').forEach((el) => new Dropdown(el));

const table = new Tabulator('#table', {
  data: [],
  layout: 'fitDataFill',
  pagination: true,
  paginationMode: 'local',
  paginationSize: 100,
  paginationSizeSelector: [10, 100, 1000],
  initialSort: [{ column: 'Date', dir: 'asc' }],
  placeholder: 'No rows match the current filters',
  columns,
});
// Tabulator builds asynchronously; never replace data before it's ready.
const tableReady = new Promise((resolve) => table.on('tableBuilt', resolve));

table.on('dataFiltered', (_filters, rows) => {
  elExportFilteredBtn.textContent = `Filtered rows (${rows.length.toLocaleString()})`;
});

// --- State ---
const session = { QrtxK: null, SNlM0e: null, email: null }; // GSC tokens
let gscProperties = []; // [{url,label}] accessible in GSC
let target = { resource_id: null, hostname: null }; // property to download
let filters = { category: 'response', hostname: null };
let totalData = {};
let gscData = {};

const targetProperty = () => target.hostname || target.resource_id || '';

// --- UI messages ---
function showError(message) {
  elErrorMsgText.textContent = message;
  elErrorMsg.hidden = false;
}

function hideAlerts() {
  elErrorMsg.hidden = true;
  elNotLoggedInMsg.hidden = true;
}

function setTarget(next) {
  target = next;
  const property = targetProperty();
  const label = property ? `Download · ${shortLabel(property)}` : 'Download';
  elDownloadBtnTxt.textContent = label;
  elDownloadToggleBtn.title = property ? `Download crawl stats for ${property}` : 'Choose a property first';
  elDownloadToggleBtn.setAttribute('aria-label', label);
  updateEmptyState();
}

function updateEmptyState() {
  const signedIn = session.QrtxK != null;
  const property = targetProperty();
  $('stepSignIn').classList.toggle('done', signedIn);
  $('stepSignIn').querySelector('.step-action').hidden = signedIn;
  $('stepProperty').classList.toggle('done', Boolean(property));
  $('stepPropertyBtn').textContent = property ? shortLabel(property) : 'Choose';
  $('stepDownloadBtn').disabled = !(signedIn && property) || downloading;
}

function openSettings(e) {
  e?.preventDefault();
  chrome.runtime.openOptionsPage();
}

// --- Event listeners ---
$('settingsBtn').addEventListener('click', openSettings);
$('cronFailLink').addEventListener('click', openSettings);
document.querySelectorAll('.retry-btn').forEach((btn) => btn.addEventListener('click', () => refreshSession()));
document.addEventListener('visibilitychange', () => {
  // Coming back from the sign-in tab: recover without a reload.
  if (document.visibilityState === 'visible' && (!elNotLoggedInMsg.hidden || !elErrorMsg.hidden) && !downloading) {
    refreshSession();
  }
});

$('stepPropertyBtn').addEventListener('click', () => elHostname.focus());
$('stepDownloadBtn').addEventListener('click', () => downloadZIPs());
elDataFreshness.addEventListener('click', () => downloadZIPs());

elMetric.addEventListener('change', function () {
  chartConfig.metric = this.value;
  generateChart();
});

elCategory.addEventListener('change', function () {
  filters.category = this.value;
  applyFilters();
  generateChart();
});

elInvertSelectionBtn.addEventListener('click', () => {
  if (!chart) return;
  const all = chart.data().map((d) => d.id);
  const shown = chart.data.shown().map((d) => d.id);
  const hidden = all.filter((id) => !shown.includes(id));
  chart.hide(shown);
  chart.show(hidden);
});

function exportCsv(range) {
  const slug = (filters.hostname || 'export').replace(/[^a-zA-Z0-9._-]/g, '_');
  table.download('csv', `crawl-stats_${slug}${range === 'active' ? `_${filters.category}` : ''}.csv`, {}, range);
}
elExportFilteredBtn.addEventListener('click', (e) => { e.preventDefault(); exportCsv('active'); });
$('exportAllBtn').addEventListener('click', (e) => { e.preventDefault(); exportCsv('all'); });

$('downloadBtn').addEventListener('click', (e) => {
  e.preventDefault();
  downloadZIPs();
});
$('downloadBtnSave').addEventListener('click', (e) => {
  e.preventDefault();
  chromeDownload = true;
  downloadZIPs();
});

elHostname.addEventListener('change', function () {
  const hostname = this.value.trim();
  if (!hostname) return;
  setTarget({ resource_id: hostname, hostname: null });
  chrome.storage.local.get(hostname).then((result) => {
    if (result[hostname]) totalData[hostname] = result[hostname];
    showProperty(hostname, result[hostname] || {});
  });
});

// --- GSC page data ---
function extractProperties(doc) {
  let dsScript = null;
  for (const script of doc.querySelectorAll('script')) {
    if (script.className === 'ds:7') { dsScript = script; break; }
  }
  if (!dsScript) return [];

  const text = dsScript.textContent;
  const dataIdx = text.indexOf('data:');
  if (dataIdx === -1) return [];
  const startIdx = text.indexOf('[', dataIdx);
  if (startIdx === -1) return [];

  // Walk brackets to find the full data array
  let depth = 0, endIdx = -1;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']' && --depth === 0) { endIdx = i; break; }
  }
  if (endIdx === -1) return [];

  try {
    const data = JSON.parse(text.slice(startIdx, endIdx + 1));
    return (data[0] || []).map((entry) => ({ url: entry[0], label: entry[5] || entry[0] }));
  } catch (e) {
    console.error('Failed to parse properties:', e);
    return [];
  }
}

/** Fetch tokens + property list; update alerts, header and empty state. Returns success. */
async function refreshSession() {
  try {
    const { QrtxK, SNlM0e, email, html } = await fetchWIZtokens();
    Object.assign(session, { QrtxK, SNlM0e, email });
    gscProperties = extractProperties(new DOMParser().parseFromString(html, 'text/html'));
    if (gscProperties.length) chrome.storage.local.set({ gscProperties }); // for the options page
    hideAlerts();
    elUserEmail.hidden = !email;
    elUserEmailText.textContent = email || '';
    renderDatalist();
    updateEmptyState();
    return true;
  } catch (err) {
    console.error('Failed to fetch GSC session:', err);
    Object.assign(session, { QrtxK: null, SNlM0e: null, email: null });
    elUserEmail.hidden = true;
    if (err.code === 'NOT_LOGGED_IN') {
      elErrorMsg.hidden = true;
      elNotLoggedInMsg.hidden = false;
    } else {
      elNotLoggedInMsg.hidden = true;
      showError(friendlyError(err));
    }
    updateEmptyState();
    return false;
  }
}

/** Datalist = GSC properties ∪ stored properties; stored ones are marked. */
function renderDatalist() {
  const stored = new Set(Object.keys(totalData).filter(isPropertyKey));
  const entries = new Map(gscProperties.map(({ url, label }) => [url, label]));
  stored.forEach((key) => { if (!entries.has(key)) entries.set(key, ''); });

  elHostnameList.replaceChildren(...[...entries].map(([url, label]) => {
    const opt = document.createElement('option');
    opt.value = url;
    const parts = [label && label !== url ? label : '', stored.has(url) ? 'data stored' : ''].filter(Boolean);
    if (parts.length) opt.label = parts.join(' · ');
    return opt;
  }));
}

/** The GSC tab the user is looking at, else any open GSC tab. */
async function findGscTab() {
  const url = 'https://search.google.com/*';
  const [active] = await chrome.tabs.query({ url, active: true, lastFocusedWindow: true });
  if (active?.url) return active;
  const tabs = await chrome.tabs.query({ url });
  return tabs.find((t) => t.url) || null;
}

function showCronFailures(cronJobs = {}) {
  const failed = Object.values(cronJobs).filter((j) => j.lastError);
  $('cronFailMsg').hidden = failed.length === 0;
  if (!failed.length) return;
  const [first] = failed;
  const more = failed.length > 1 ? ` (+${failed.length - 1} more)` : '';
  $('cronFailText').textContent = `Scheduled download for ${first.property} failed. ${jobErrorText(first)}${more}`;
  $('cronFailText').title = first.lastError; // raw message for bug reports
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.cronJobs) showCronFailures(changes.cronJobs.newValue);
});

// --- Initialization ---
async function init() {
  // URL param from options page "View" link takes priority
  const urlParam = new URLSearchParams(location.search).get('property');
  let initial = { resource_id: null, hostname: null };
  if (urlParam) {
    initial = { resource_id: urlParam, hostname: null };
  } else {
    const tab = await findGscTab();
    if (tab) {
      const tabURL = new URL(tab.url);
      initial = {
        resource_id: tabURL.searchParams.get('resource_id'),
        hostname: tabURL.searchParams.get('hostname'),
      };
    }
  }

  const [, stored] = await Promise.all([refreshSession(), chrome.storage.local.get(null)]);
  totalData = stored;
  if (!gscProperties.length && Array.isArray(stored.gscProperties)) gscProperties = stored.gscProperties;
  showCronFailures(stored.cronJobs);
  renderDatalist();

  // Pre-select: active GSC property, else first stored key
  const storedProperties = Object.keys(totalData).filter(isPropertyKey);
  const fromTab = initial.hostname || initial.resource_id;
  const initialHostname = fromTab || storedProperties[0] || '';
  setTarget(fromTab ? initial : { resource_id: initialHostname || null, hostname: null });
  await showProperty(initialHostname, totalData[initialHostname] || {});

  if (fromTab && !totalData[fromTab] && session.QrtxK != null) {
    downloadZIPs();
  }
}

init();

// --- Rendering ---
async function showProperty(hostname, data) {
  await tableReady;
  filters.hostname = hostname;
  elHostname.value = hostname;
  gscData = data;

  const hasData = Object.keys(gscData).length > 0;
  const becameVisible = hasData && elDataView.hidden;
  elEmptyState.hidden = hasData;
  elDataView.hidden = !hasData; // unhide before charting so Billboard can measure
  updateEmptyState();

  await table.replaceData(gscDataFlat());
  // Tabulator measured its header while the view was display:none (all heights 0).
  if (becameVisible) table.redraw(true);
  applyFilters();
  generateChart();
  updateFreshness();
}

function updateFreshness() {
  const dates = Object.keys(gscData);
  elDataFreshness.hidden = dates.length === 0;
  if (dates.length === 0) return;
  const latest = dates.reduce((a, b) => (a > b ? a : b));
  const age = daysSince(latest);
  elDataFreshness.textContent = `Latest data: ${latest} (${relativeDays(latest)}) · Update`;
  elDataFreshness.classList.toggle('stale-warn', age > 7 && age <= 14);
  elDataFreshness.classList.toggle('stale-bad', age > 14);
}

function applyFilters() {
  table.setFilter(
    Object.entries(filters).map(([field, value]) => ({ field, type: '=', value }))
  );
}

function generateChart() {
  if (!gscData || Object.keys(gscData).length === 0) {
    if (chart) { chart.destroy(); chart = null; }
    elInvertSelectionBtn.hidden = true;
    return;
  }

  const metric = METRICS[chartConfig.metric];
  const chartColumns = [];
  const xColumn = ['x'];
  const xTemp = {};
  const temp = {};

  Object.keys(gscData).sort().forEach((date) => {
    Object.keys(gscData[date])
      .filter((key) => Object.keys(filters).every((k) => gscData[date][key][k] == filters[k]))
      .forEach((key) => {
        xTemp[date] = date;
        if (temp[key]) {
          temp[key].push(gscData[date][key][chartConfig.metric]);
        } else {
          temp[key] = [key, gscData[date][key][chartConfig.metric]];
        }
      });
  });

  Object.keys(xTemp).forEach((date) => xColumn.push(date));
  chartColumns.push(xColumn);
  Object.values(temp).forEach((col) => chartColumns.push(col));

  if (chart) chart.destroy();
  chart = bb.generate({
    bindto: '#chart',
    data: {
      x: 'x',
      columns: chartColumns,
      colors,
      names: { summary: 'Total' },
      type: line(),
    },
    transition: { duration: 0 },
    padding: { left: 70, right: 20 },
    axis: {
      x: {
        type: 'timeseries',
        tick: { format: '%Y-%m-%d' },
      },
      y: {
        // Counts, sizes and times are never negative; don't let auto-padding dip below 0.
        min: 0,
        padding: { bottom: 0 },
        label: { text: metric.axis, position: 'outer-middle' },
        tick: { format: (v) => metric.format(v) },
      },
    },
    tooltip: {
      format: {
        value: (value) => (typeof value === 'number' ? metric.unit(value) : value),
      },
    },
  });
  elInvertSelectionBtn.hidden = false;
}

function gscDataFlat() {
  const rows = [];
  Object.keys(gscData).forEach((date) => {
    Object.values(gscData[date]).forEach((row) => {
      rows.push({ ...row, Date: date });
    });
  });
  return rows;
}

// --- Download ---

/** Filename from Content-Disposition, or a stable fallback if absent/unparseable. */
function exportFilename(resp, fallback) {
  try {
    const header = resp.headers.get('Content-Disposition') || '';
    const match = header.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    if (match) return decodeURIComponent(match[1]).replace(/[\\/:*?"<>|]/g, '_');
  } catch { /* fall through */ }
  return fallback;
}

// Object URLs must outlive the download itself, so revoke on completion, not on start.
const pendingObjectUrls = new Map(); // downloadId → object URL
chrome.downloads.onChanged.addListener(({ id, state }) => {
  if (!state || state.current === 'in_progress' || !pendingObjectUrls.has(id)) return;
  URL.revokeObjectURL(pendingObjectUrls.get(id));
  pendingObjectUrls.delete(id);
});

function saveToDisk(blob, resp, fallbackName) {
  const objectUrl = URL.createObjectURL(blob);
  chrome.downloads.download({
    saveAs: false,
    conflictAction: 'uniquify',
    url: objectUrl,
    filename: 'gscData/' + exportFilename(resp, fallbackName),
  }, (downloadId) => {
    if (chrome.runtime.lastError || downloadId === undefined) {
      console.warn('Download error:', chrome.runtime.lastError?.message);
      URL.revokeObjectURL(objectUrl);
      return;
    }
    pendingObjectUrls.set(downloadId, objectUrl);
  });
}

async function downloadZIPs() {
  if (downloading) return;

  const settings = {
    resource_id: target.resource_id || elHostname.value.trim(),
    ...(target.hostname ? { hostname: target.hostname } : {}),
  };
  if (!settings.resource_id) {
    elHostname.focus();
    return;
  }

  if (session.QrtxK == null && !(await refreshSession())) {
    chromeDownload = false;
    return;
  }

  downloading = true;
  hideAlerts();
  elDownloadToggleBtn.disabled = true;
  updateEmptyState();

  const { summaryUrl, drilldowns } = buildExportUrls(settings, session.QrtxK, session.SNlM0e);
  const total = drilldowns.length + 1;
  let completed = 0;
  let failed = 0;
  elFetchBar.hidden = false;

  function updateProgress(category) {
    completed++;
    const next = completed < total ? (drilldowns[completed - 1]?.category ?? category) : category;
    elFetchProgressLabel.textContent = completed < total
      ? `Downloading ${CATEGORY_LABELS[next]}… ${completed} / ${total}`
      : `Finishing… ${completed} / ${total}`;
    document.title = `${completed}/${total} · ${APP_TITLE}`;
    elFetchProgress.style.width = `${Math.floor((completed / total) * 100)}%`;
  }
  elFetchProgressLabel.textContent = `Downloading ${CATEGORY_LABELS.summary}… 0 / ${total}`;

  let dlGscData = {};

  try {
    const { zip, blob, resp } = await fetchZip(summaryUrl);
    if (chromeDownload) saveToDisk(blob, resp, 'summary.zip');
    dlGscData = mergeGscData(dlGscData, await parseSummaryZip(zip, settings));
  } catch (err) {
    failed++;
    console.error('Summary download failed:', err);
  }
  updateProgress('summary');

  for (const row of drilldowns) {
    try {
      const { zip, blob, resp } = await fetchZip(row.url);
      if (chromeDownload) saveToDisk(blob, resp, `${row.category}-${row.id}.zip`);
      dlGscData = mergeGscData(dlGscData, await parseDrilldownZip(zip, row, settings));
    } catch (err) {
      failed++;
      console.warn('Skipping', row.category, row.id, err.message);
    }
    updateProgress(row.category);
    await delay(200);
  }

  // Finalise
  elFetchBar.hidden = true;
  document.title = APP_TITLE;
  chromeDownload = false;
  downloading = false;
  elDownloadToggleBtn.disabled = false;
  updateEmptyState();

  if (failed === total) {
    showError('Nothing could be downloaded. Check that this Google account has access to the property.');
    return;
  }
  if (failed > 0) showError(`${failed} of ${total} exports failed; the rest were saved.`);

  const hostname = settings.hostname || settings.resource_id;
  const latest = await chrome.storage.local.get(hostname);
  const merged = mergeGscData(latest[hostname], dlGscData);
  await chrome.storage.local.set({ [hostname]: merged });
  totalData[hostname] = merged;

  setTarget(target);
  renderDatalist();
  await showProperty(hostname, merged);
}
