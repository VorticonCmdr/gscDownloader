import bb, { line } from 'billboard.js';
import 'billboard.js/dist/billboard.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Dropdown } from 'bootstrap';
import 'bootstrap-icons/font/bootstrap-icons.css';
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

let chromeDownload = false;
let downloading = false;
let chart;

const colors = {
  'AdsBot': '',
  'CSS': '',
  'Desktop': '',
  'Discovery': '',
  'HTML': '',
  'Image': '',
  'JSON': '',
  'JavaScript': '',
  'Moved (other)': '#1f77b4',
  'Moved permanently (301)': '#68a7d2',
  'Moved temporarily (302)': '#9268d2',
  'Not found (404)': '#ff7f0e',
  'Not modified (304)': '#2ca02c',
  'OK (200)': '#0ff90f',
  'Other XML': '',
  'Other agent type': '',
  'Other client error (4XX)': '#ff650e',
  'Other file type': '',
  'PDF': '',
  'Page could not be reached': '#d62764',
  'Page resource load': '',
  'Redirect error': '#ff6161',
  'Refresh': '',
  'Server error (5XX)': '#ff3333',
  'Smartphone': '',
  'Syndication': '',
  'Unauthorized (401/407)': '#fb4d0a',
  'Video': '',
  'robots.txt not available': '#d62728',
  'summary': '#000000',
};

let chartConfig = { metric: 'Total crawl requests' };

function shortLabel(url) {
  try { return new URL(url).hostname || url; } catch { return url; }
}

function numberToLocaleString(cell) {
  const value = cell.getValue();
  if (typeof value === 'number') return value.toLocaleString();
  return '-';
}

function headerFilterGte(headerValue, rowValue) {
  return headerValue === '' || headerValue === null || rowValue >= Number(headerValue);
}

const columns = [
  { title: 'Date', field: 'Date', sorter: 'string', headerFilter: 'input' },
  { title: 'resource_id', field: 'resource_id', sorter: 'string', visible: false },
  { title: 'hostname', field: 'hostname', sorter: 'string', headerFilter: 'input' },
  { title: 'category', field: 'category', sorter: 'string', visible: false },
  { title: 'type', field: 'type', sorter: 'string', headerFilter: 'input' },
  { title: 'Total crawl requests', field: 'Total crawl requests', sorter: 'number', formatter: numberToLocaleString, hozAlign: 'right', headerFilter: 'input', headerFilterPlaceholder: '≥', headerFilterFunc: headerFilterGte },
  { title: 'Total download size (Bytes)', field: 'Total download size (Bytes)', sorter: 'number', formatter: numberToLocaleString, hozAlign: 'right', headerFilter: 'input', headerFilterPlaceholder: '≥', headerFilterFunc: headerFilterGte },
  { title: 'Average response time (ms)', field: 'Average response time (ms)', sorter: 'number', formatter: numberToLocaleString, hozAlign: 'right', headerFilter: 'input', headerFilterPlaceholder: '≥', headerFilterFunc: headerFilterGte },
  { title: 'Affected pages', field: 'Affected pages', sorter: 'number', formatter: numberToLocaleString, hozAlign: 'right', visible: false },
];

// Cache DOM references
const elMetric = document.getElementById('metric');
const elCategory = document.getElementById('category');
const elHostname = document.getElementById('hostname');
const elHostnameList = document.getElementById('hostname-list');
const elDownloadBtn = document.getElementById('downloadBtn');
const elDownloadBtnSave = document.getElementById('downloadBtnSave');
const elDownloadBtnTxt = document.getElementById('downloadBtnTxt');
const elErrorMsg = document.getElementById('errorMsg');
const elErrorMsgText = document.getElementById('errorMsgText');
const elNotLoggedInMsg = document.getElementById('notLoggedInMsg');
const elUserEmailText = document.getElementById('userEmailText');
const elFetchBar = document.getElementById('fetchBar');
const elFetchProgress = document.getElementById('fetchProgress');
const elFetchProgressLabel = document.getElementById('fetchProgressLabel');
const elExportBtn = document.getElementById('exportBtn');
const elDownloadToggleBtn = document.getElementById('downloadToggleBtn');
const elDataFreshness = document.getElementById('dataFreshness');
const elInvertSelectionBtn = document.getElementById('invertSelectionBtn');

// Initialize Bootstrap dropdowns
document.querySelectorAll('[data-bs-toggle="dropdown"]').forEach((el) => new Dropdown(el));

const table = new Tabulator('#table', {
  data: [],
  layout: 'fitDataFill',
  pagination: true,
  paginationMode: 'local',
  paginationSize: 100,
  paginationSizeSelector: [10, 100, 1000],
  initialSort: [{ column: 'Date', dir: 'asc' }],
  columns,
});

// --- State ---
const session = { QrtxK: null, SNlM0e: null }; // GSC tokens
let target = { resource_id: null, hostname: null }; // property to download
let filters = { category: 'response', hostname: null };
let totalData = {};
let gscData = {};

// --- UI messages ---
function showError(message) {
  elErrorMsgText.textContent = message;
  elErrorMsg.style.display = 'block';
}

function hideError() {
  elErrorMsg.style.display = 'none';
}

// --- Event listeners ---
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

elExportBtn.addEventListener('click', () => {
  const slug = (filters.hostname || 'export').replace(/[^a-zA-Z0-9._-]/g, '_');
  table.download('csv', `crawl-stats_${slug}.csv`, {}, 'all');
});

elDownloadBtn.addEventListener('click', (e) => {
  e.preventDefault();
  downloadZIPs();
});
elDownloadBtnSave.addEventListener('click', (e) => {
  e.preventDefault();
  chromeDownload = true;
  downloadZIPs();
});

elHostname.addEventListener('change', function () {
  const hostname = this.value.trim();
  if (!hostname) return;
  target = { resource_id: hostname, hostname: null };
  elDownloadBtnTxt.textContent = shortLabel(hostname);
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

async function fetchSession() {
  const { QrtxK, SNlM0e, email, html } = await fetchWIZtokens();
  session.QrtxK = QrtxK;
  session.SNlM0e = SNlM0e;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return { properties: extractProperties(doc), email };
}

/** The GSC tab the user is looking at, else any open GSC tab. */
async function findGscTab() {
  const url = 'https://search.google.com/*';
  const [active] = await chrome.tabs.query({ url, active: true, lastFocusedWindow: true });
  if (active?.url) return active;
  const tabs = await chrome.tabs.query({ url });
  return tabs.find((t) => t.url) || null;
}

function addDatalistOption(value, label) {
  if ([...elHostnameList.options].some((o) => o.value === value)) return;
  const opt = document.createElement('option');
  opt.value = value;
  if (label) opt.label = label;
  elHostnameList.appendChild(opt);
}

// --- Initialization ---
async function init() {
  // URL param from options page "View" link takes priority
  const urlParam = new URLSearchParams(location.search).get('property');
  if (urlParam) {
    target = { resource_id: urlParam, hostname: null };
  } else {
    const tab = await findGscTab();
    if (tab) {
      const tabURL = new URL(tab.url);
      target = {
        resource_id: tabURL.searchParams.get('resource_id'),
        hostname: tabURL.searchParams.get('hostname'),
      };
    }
  }

  // Fetch WIZ tokens + property list from GSC HTML
  let properties = [];
  try {
    const result = await fetchSession();
    properties = result.properties;
    if (result.email) elUserEmailText.textContent = result.email;
  } catch (err) {
    console.error('Failed to fetch GSC session:', err);
    if (err.code === 'NOT_LOGGED_IN') {
      elNotLoggedInMsg.style.display = 'block';
    } else {
      showError(`Could not read Google Search Console (${err.message}).`);
    }
  }

  const property = target.hostname || target.resource_id;
  elDownloadBtnTxt.textContent = shortLabel(property || '');

  // Populate datalist with all accessible GSC properties
  properties.forEach(({ url, label }) => addDatalistOption(url, label));

  // Load persisted data from storage
  totalData = await chrome.storage.local.get(null);
  const storedProperties = Object.keys(totalData).filter(isPropertyKey);
  storedProperties.forEach((key) => addDatalistOption(key));

  // Pre-select: active GSC property, else first stored key
  const initialHostname = property || storedProperties[0] || '';
  if (!property && initialHostname) target = { resource_id: initialHostname, hostname: null };
  showProperty(initialHostname, totalData[initialHostname] || {});

  if (property && !totalData[property] && session.QrtxK != null) {
    downloadZIPs();
  }
}

init();

// --- Rendering ---
function showProperty(hostname, data) {
  filters.hostname = hostname;
  elHostname.value = hostname;
  gscData = data;
  table.replaceData(gscDataFlat()).then(() => {
    applyFilters();
    generateChart();
    updateFreshness();
  });
}

function updateFreshness() {
  const dates = Object.keys(gscData);
  if (dates.length === 0) {
    elDataFreshness.textContent = '';
    return;
  }
  const latest = dates.reduce((a, b) => (a > b ? a : b));
  const daysAgo = Math.floor((Date.now() - new Date(latest).getTime()) / 86400000);
  elDataFreshness.textContent = `Latest data: ${latest} (${daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`})`;
}

function applyFilters() {
  table.setFilter(
    Object.entries(filters).map(([field, value]) => ({ field, type: '=', value }))
  );
}

function generateChart() {
  if (!gscData || Object.keys(gscData).length === 0) {
    if (chart) { chart.destroy(); chart = null; }
    elInvertSelectionBtn.style.display = 'none';
    return;
  }

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
      type: line(),
    },
    transition: { duration: 0 },
    padding: { left: 50, right: 20 },
    axis: {
      x: {
        type: 'timeseries',
        tick: { format: '%Y-%m-%d' },
      },
    },
    tooltip: {
      format: {
        value: (value) => value.toLocaleString(),
      },
    },
  });
  elInvertSelectionBtn.style.display = '';
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
  if (!settings.resource_id) return;

  if (session.QrtxK == null) {
    showError('Not connected to Google Search Console. Sign in, then reload this page.');
    chromeDownload = false;
    return;
  }

  downloading = true;
  hideError();
  elDownloadToggleBtn.disabled = true;

  const { summaryUrl, drilldowns } = buildExportUrls(settings, session.QrtxK, session.SNlM0e);
  const total = drilldowns.length + 1;
  let completed = 0;
  let failed = 0;
  elFetchBar.style.display = 'block';

  function updateProgress() {
    completed++;
    const remaining = total - completed;
    document.title = `${remaining} to download`;
    elFetchProgressLabel.textContent = `${remaining} to download`;
    elFetchProgress.style.width = `${Math.floor((completed / total) * 100)}%`;
  }

  let dlGscData = {};

  try {
    const { zip, blob, resp } = await fetchZip(summaryUrl);
    if (chromeDownload) saveToDisk(blob, resp, 'summary.zip');
    dlGscData = mergeGscData(dlGscData, await parseSummaryZip(zip, settings));
  } catch (err) {
    failed++;
    console.error('Summary download failed:', err);
  }
  updateProgress();

  for (const row of drilldowns) {
    try {
      const { zip, blob, resp } = await fetchZip(row.url);
      if (chromeDownload) saveToDisk(blob, resp, `${row.category}-${row.id}.zip`);
      dlGscData = mergeGscData(dlGscData, await parseDrilldownZip(zip, row, settings));
    } catch (err) {
      failed++;
      console.warn('Skipping', row.category, row.id, err.message);
    }
    updateProgress();
    await delay(200);
  }

  // Finalise
  elFetchBar.style.display = 'none';
  document.title = 'GSC crawl stats downloader';
  chromeDownload = false;
  downloading = false;
  elDownloadToggleBtn.disabled = false;

  if (failed === total) {
    showError('Download failed — no exports could be fetched. Check that you have access to this property.');
    return;
  }
  if (failed > 0) showError(`${failed} of ${total} exports failed; the rest were saved.`);

  const hostname = settings.hostname || settings.resource_id;
  const latest = await chrome.storage.local.get(hostname);
  const merged = mergeGscData(latest[hostname], dlGscData);
  await chrome.storage.local.set({ [hostname]: merged });
  totalData[hostname] = merged;

  elDownloadBtnTxt.textContent = shortLabel(hostname);
  addDatalistOption(hostname);
  showProperty(hostname, merged);
}
