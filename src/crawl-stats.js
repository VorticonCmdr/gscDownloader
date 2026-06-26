import bb, { line } from 'billboard.js';
import 'billboard.js/dist/billboard.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Dropdown } from 'bootstrap';
import 'bootstrap-icons/font/bootstrap-icons.css';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import 'tabulator-tables/dist/css/tabulator_bootstrap5.min.css';
import JSZip from 'jszip';
import Papa from 'papaparse';

let chromeDownload = false;
let dlProgress = 0;
let downloading = false;
let chart;
let table;

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
const elDownloadBtn = document.getElementById('downloadBtn');
const elDownloadBtnSave = document.getElementById('downloadBtnSave');
const elDownloadBtnTxt = document.getElementById('downloadBtnTxt');
const elErrorMsg = document.getElementById('errorMsg');
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

let tableData = [];
table = new Tabulator('#table', {
  data: tableData,
  layout: 'fitDataFill',
  pagination: true,
  paginationMode: 'local',
  paginationSize: 100,
  paginationSizeSelector: [10, 100, 1000],
  initialSort: [{ column: 'Date', dir: 'asc' }],
  columns,
});

elMetric.addEventListener('change', function() {
  chartConfig.metric = this.value;
  generateChart();
});

elInvertSelectionBtn.addEventListener('click', () => {
  if (!chart) return;
  const all = chart.data().map(d => d.id);
  const shown = chart.data.shown().map(d => d.id);
  const hidden = all.filter(id => !shown.includes(id));
  chart.hide(shown);
  chart.show(hidden);
});

elExportBtn.addEventListener('click', () => {
  const slug = (filters.hostname || 'export').replace(/[^a-zA-Z0-9._-]/g, '_');
  table.download('csv', `crawl-stats_${slug}.csv`, {}, 'all');
});

elDownloadBtn.addEventListener('click', downloadZIPs);
elDownloadBtnSave.addEventListener('click', function() {
  chromeDownload = true;
  downloadZIPs();
});

// --- State ---
let selection = [];
let background = { settings: {} };
let dlSettings = {};
let filters = { category: 'response', hostname: null };
let totalData = {};
let gscData = {};

elCategory.addEventListener('change', function() {
  filters.category = this.value;
  applyFilters();
  generateChart();
});

// --- WIZ data + property list extraction ---
function find_WIZ_global_data(doc) {
  const elm = doc.querySelector('[data-id="_gd"]');
  const html = elm.innerHTML;
  const jsonString = html.replace('window.WIZ_global_data = ', '').slice(0, -1);
  return JSON.parse(jsonString);
}

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

async function fetchWIZdata() {
  const response = await fetch('https://search.google.com/search-console', {
    mode: 'cors',
    credentials: 'include',
  });
  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const wizData = find_WIZ_global_data(doc);
  background.settings['QrtxK'] = wizData.QrtxK;
  background.settings['SNlM0e'] = wizData.SNlM0e;
  return { properties: extractProperties(doc), email: wizData.oPEP7c || null };
}

// --- Initialization ---
async function init() {
  // URL param from options page "View" link takes priority
  const urlParam = new URLSearchParams(location.search).get('property');
  if (urlParam) {
    background.settings.resource_id = urlParam;
    delete background.settings.hostname;
  }

  // Get resource_id / hostname from active GSC tab URL (skip when opened via ?property=)
  if (!urlParam) {
    const tabs = await chrome.tabs.query({ url: 'https://search.google.com/*' });
    if (tabs && tabs.length > 0) {
      const tabURL = new URL(tabs[0].url);
      background.settings['resource_id'] = tabURL.searchParams.get('resource_id');
      background.settings['hostname'] = tabURL.searchParams.get('hostname');
    }
  }

  // Fetch WIZ tokens + property list from GSC HTML
  let properties = [];
  try {
    const result = await fetchWIZdata();
    properties = result.properties;
    if (result.email) {
      elUserEmailText.textContent = result.email;
    } else {
      elNotLoggedInMsg.style.display = 'block';
    }
  } catch (err) {
    console.error('Failed to fetch WIZ data:', err);
    elNotLoggedInMsg.style.display = 'block';
  }

  const property = background.settings.hostname || background.settings.resource_id;
  elDownloadBtnTxt.textContent = shortLabel(property || '');

  // Populate datalist with all accessible GSC properties
  const datalist = document.getElementById('hostname-list');
  properties.forEach(({ url, label }) => {
    const opt = document.createElement('option');
    opt.value = url;
    opt.label = label;
    datalist.appendChild(opt);
  });

  // Load persisted data from storage
  chrome.storage.local.get(null, function(data) {
    totalData = data;

    const storedProperties = Object.keys(data).filter((k) => k !== 'cronJobs');

    // Add any stored keys not already in the datalist
    const listedUrls = new Set([...datalist.options].map((o) => o.value));
    storedProperties.forEach((key) => {
      if (!listedUrls.has(key)) {
        const opt = document.createElement('option');
        opt.value = key;
        datalist.appendChild(opt);
      }
    });

    // Pre-select: active GSC property, else first stored key
    const initialHostname = property || storedProperties[0] || '';
    elHostname.value = initialHostname;
    filters.hostname = initialHostname;

    if (data[initialHostname]) {
      gscData = data[initialHostname];
      tableData = gscDataFlat();
      table.replaceData(tableData).then(() => {
        applyFilters();
        generateChart();
        updateFreshness();
      });
    }

    if (property && !totalData[property]) {
      downloadZIPs();
    }
  });
}

init();

elHostname.addEventListener('change', function () {
  const hostname = this.value.trim();
  if (!hostname) return;
  filters.hostname = hostname;
  elDownloadBtnTxt.textContent = shortLabel(hostname);
  background.settings.resource_id = hostname;
  delete background.settings.hostname;
  selection = [];
  chrome.storage.local.get(hostname, (result) => {
    gscData = result[hostname] || {};
    tableData = gscDataFlat();
    table.replaceData(tableData).then(() => {
      applyFilters();
      generateChart();
      updateFreshness();
    });
  });
});

// --- Helpers ---
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

function mergeGSCdata(gscData, hostname) {
  if (!totalData[hostname]) return gscData;
  Object.keys(gscData).forEach((date) => {
    if (!totalData[hostname][date]) {
      totalData[hostname][date] = gscData[date];
    } else {
      Object.keys(gscData[date]).forEach((key) => {
        totalData[hostname][date][key] = gscData[date][key];
      });
    }
  });
  return totalData[hostname];
}

function generateChart() {
  if (!gscData || Object.keys(gscData).length === 0) return;

  const chartColumns = [];
  const xColumn = ['x'];
  const xTemp = {};
  const temp = {};

  Object.keys(gscData).forEach((date) => {
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
  tableData = [];
  Object.keys(gscData).forEach((date) => {
    Object.values(gscData[date]).forEach((row) => {
      row['Date'] = date;
      tableData.push(row);
    });
  });
  return tableData;
}

function generateURLs() {
  if (selection.length > 0) return;
  const urlWpath = 'https://search.google.com/u/' + background.settings.QrtxK + '/search-console/export/crawl-stats/drilldown';
  const params = {
    hl: 'en',
    resource_id: dlSettings['resource_id'],
    request_type: '3',
    at: background.settings.SNlM0e,
  };
  if (dlSettings['hostname']) params['hostname'] = dlSettings['hostname'];

  function makeURL(override) {
    const dlURL = new URL(urlWpath);
    Object.entries(params).forEach(([k, v]) => dlURL.searchParams.set(k, v));
    Object.entries(override).forEach(([k, v]) => dlURL.searchParams.set(k, v));
    return dlURL.href;
  }

  [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20].forEach((t) =>
    selection.push({ url: makeURL({ response: t }), category: 'response' })
  );
  [1, 11, 4, 5, 2, 12, 10, 6, 7, 3, 9, 13, 14].forEach((t) =>
    selection.push({ url: makeURL({ file_type: t }), category: 'file_type' })
  );
  [1, 2].forEach((t) =>
    selection.push({ url: makeURL({ purpose: t }), category: 'purpose' })
  );
  [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach((t) =>
    selection.push({ url: makeURL({ googlebot_type: t }), category: 'googlebot_type' })
  );
}

async function downloadZIPs() {
  if (downloading) return;
  downloading = true;
  elDownloadToggleBtn.disabled = true;

  dlSettings = { resource_id: background.settings.resource_id || elHostname.value };
  if (background.settings.hostname) dlSettings['hostname'] = background.settings.hostname;
  generateURLs();

  if (!background.settings.QrtxK) {
    elErrorMsg.style.display = 'block';
    downloading = false;
    elDownloadToggleBtn.disabled = false;
    return;
  }

  dlProgress = selection.length;
  let completed = 0;
  elFetchBar.style.display = 'block';

  function updateProgress() {
    completed++;
    const remaining = dlProgress - completed + 1;
    document.title = `${remaining} to download`;
    elFetchProgressLabel.textContent = `${remaining} to download`;
    elFetchProgress.style.width = `${Math.floor((completed / (dlProgress + 1)) * 100)}%`;
  }

  const dlGscData = {};

  async function fetchBlob(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const header = resp.headers.get('Content-Disposition');
    const filename = JSON.parse(header.split(';')[1].split('=')[1]);
    const blob = await resp.blob();
    if (chromeDownload) {
      chrome.downloads.download({
        saveAs: false,
        conflictAction: 'uniquify',
        url: window.URL.createObjectURL(blob),
        filename: 'gscData/' + filename,
      }, () => {
        if (chrome.runtime.lastError) console.warn('Download error:', chrome.runtime.lastError.message);
      });
    }
    return blob;
  }

  // Summary file
  const summaryURL = new URL('https://search.google.com/u/' + background.settings.QrtxK + '/search-console/export/crawl-stats');
  Object.entries({
    hl: 'en',
    resource_id: dlSettings['resource_id'],
    request_type: '3',
    at: background.settings.SNlM0e,
    ...(dlSettings['hostname'] ? { hostname: dlSettings['hostname'] } : {}),
  }).forEach(([k, v]) => summaryURL.searchParams.set(k, v));

  try {
    const blob = await fetchBlob(summaryURL.href);
    const zip = await JSZip.loadAsync(blob);
    const csv = await zip.files['Summary crawl stats chart.csv'].async('string');
    Papa.parse(csv, { dynamicTyping: true, header: true }).data.forEach((item) => {
      if (!item['Date']) return;
      if (!dlGscData[item['Date']]) dlGscData[item['Date']] = {};
      dlGscData[item['Date']]['summary'] = {
        category: 'summary',
        type: 'total',
        resource_id: dlSettings['resource_id'],
        hostname: dlSettings['hostname'] || dlSettings['resource_id'],
        'Average response time (ms)': item['Average response time (ms)'],
        'Total crawl requests': item['Total crawl requests'],
        'Total download size (Bytes)': item['Total download size (Bytes)'],
      };
    });
  } catch (err) {
    console.error('Summary download failed:', err);
    elErrorMsg.style.display = 'block';
  }
  updateProgress();

  // Drilldown files
  for (const row of selection) {
    try {
      const blob = await fetchBlob(row.url);
      const zip = await JSZip.loadAsync(blob);
      const metaCsv = await zip.files['Metadata.csv'].async('string');
      const dataType = Papa.parse(metaCsv, { dynamicTyping: true, header: true }).data[0]?.['Value'];
      if (dataType) {
        const chartCsv = await zip.files['Chart.csv'].async('string');
        Papa.parse(chartCsv, { dynamicTyping: true, header: true }).data.forEach((item) => {
          if (!item['Date']) return;
          if (!dlGscData[item['Date']]) dlGscData[item['Date']] = {};
          dlGscData[item['Date']][dataType] = {
            category: row.category,
            type: dataType,
            resource_id: dlSettings['resource_id'],
            hostname: dlSettings['hostname'] || dlSettings['resource_id'],
            'Average response time (ms)': item['Average response time (ms)'],
            'Total crawl requests': item['Total crawl requests'],
            'Total download size (Bytes)': item['Total download size (Bytes)'],
            'Affected pages': item['Affected pages'],
          };
        });
      }
    } catch (err) {
      console.warn('Skipping', row.url, err.message);
    }
    updateProgress();
    await new Promise((r) => setTimeout(r, 200));
  }

  // Finalise
  elFetchBar.style.display = 'none';
  document.title = 'GSC crawl stats downloader';
  chromeDownload = false;
  downloading = false;
  elDownloadToggleBtn.disabled = false;
  gscData = dlGscData;
  selection = [];

  const hostname = dlSettings.hostname || dlSettings['resource_id'];
  chrome.storage.local.set({ [hostname]: mergeGSCdata(dlGscData, hostname) });

  filters.hostname = hostname;
  elHostname.value = hostname;
  elDownloadBtnTxt.textContent = shortLabel(hostname);
  const datalist = document.getElementById('hostname-list');
  const listed = new Set([...datalist.options].map((o) => o.value));
  if (!listed.has(hostname)) {
    const opt = document.createElement('option');
    opt.value = hostname;
    datalist.appendChild(opt);
  }

  tableData = gscDataFlat();
  table.replaceData(tableData).then(() => {
    applyFilters();
    generateChart();
    updateFreshness();
  });
}
