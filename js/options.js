let chromeDownload = false;
let dlQueue = 0;

let chart;
const $table = $('#table');
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
  'summary': '#000000'
};
let chartConfig = {
  metric: 'Total crawl requests'
}
$('#metric').on('change', function(event) {
  chartConfig.metric = this.value;
  generateChart();
});

const exportTypes = ['csv', 'excel', 'xlsx'];

let tableData = [];
$table.bootstrapTable('destroy');
$table.bootstrapTable({
  data: tableData,
  exportTypes: exportTypes
});
let selection = [];

let background = {
  settings: {}
}

chrome.tabs.query({url:'https://search.google.com/*'}, function (tabs) {
  if (!tabs) {
    return;
  }
  if (tabs.length < 1) {
    return;
  }
  chrome.tabs.sendMessage(tabs[0].id, {type: "getWIZ"}, function(response) {
    background.settings = response.data;
    let property = background.settings['hostname'] || background.settings['resource_id'];
    $('#downloadBtnTxt').text(property);
  });
});

chrome.runtime.onMessage.addListener(
  function(request, sender, sendResponse) {

    let tabURL = new URL(sender.tab.url);

    switch (request.type) {
      case "WIZ_global_data":
        background.settings = request?.data || {};
        background.settings['resource_id'] = tabURL.searchParams.get('resource_id');
        background.settings['hostname'] = tabURL.searchParams.get('hostname');
        break;
      default:
        console.log(request);
    }
  }
);

let dlSettings = {
  resource_id: background.settings.resource_id
};
if (background.settings.hostname) {
  dlSettings['hostname'] = background.settings.hostname;
}

let filters = {
  category: 'response',
  hostname: background.settings.resource_id
}
$('#category').on('change', function(event) {
  filters.category = this.value;
  $table.bootstrapTable('filterBy', filters);
  generateChart();
});

let totalData = {};
function mergeGSCdata(gscData, hostname) {
  if (!totalData[hostname]) {
    return gscData;
  }
  Object.keys(gscData).forEach((date) => {
    totalData[hostname][date] = gscData[date];
  });
  gscData = totalData[hostname];
  return totalData[hostname];
}

chrome.storage.local.get(null, function(data) {
  totalData = data;

  Object.keys(data).forEach((key) => {
    $('#hostname').append($('<option>', {
      value: key,
      text: key
    }));
  });

  let hostname = $('#hostname').val();
  filters.hostname = hostname;
  if (data[hostname]) {
    gscData = data[hostname];
    tableData = gscDataFlat();

    $table.bootstrapTable('destroy');
    $table.bootstrapTable({
      data: tableData,
      exportTypes: exportTypes
    });
    $table.bootstrapTable('filterBy', filters);
    generateChart();
  }

  $('#hostname').on('change', function (event) {
    filters.hostname = this.value;
    gscData = data[filters.hostname];
    tableData = gscDataFlat();
    $table.bootstrapTable('destroy');
    $table.bootstrapTable({
      data: tableData,
      exportTypes: exportTypes
    });
    $table.bootstrapTable('filterBy', filters);
    generateChart();
  });

});

function numberToLocaleString(value, row) {
  return value.toLocaleString();
}

function generateXColumn() {
  let xColumn = ['x'];
  Object.keys(gscData).forEach((date) => {
    xColumn.push(date);
  });
  return xColumn;
}

function generateChart() {
  let columns = [];
  let groups = [], group = [];
  //columns.push(generateXColumn());
  let xColumn = ['x'];
  let xTemp = {};
  let temp = {};
  Object.keys(gscData).forEach((date) => {
    Object.keys(gscData[date])
    .filter((key) => {
      return Object.keys(filters).every((k) => {
        return gscData[date][key][k] == filters[k];
      });
    })
    .forEach((key) => {
      xTemp[date] = date;
      if (temp[key]) {
        temp[key].push(gscData[date][key][chartConfig.metric]);
      } else {
        temp[key] = [key];
        temp[key].push(gscData[date][key][chartConfig.metric]);
      }
      group.push(key);
    });
  });

  Object.keys(xTemp).forEach((date) => {
    xColumn.push(date);
  });

  columns.push(xColumn);

  Object.values(temp).forEach((column) => {
    columns.push(column)
  });

  groups.push(group);

  chart = c3.generate({
    data: {
      x: 'x',
      columns: columns,
      colors: colors,
      type: 'line'
    },
    axis: {
      x: {
        type: 'timeseries',
        tick: {
          format: '%Y-%m-%d'
        }
      }
    },
    tooltip: {
      format: {
        value: function (value, ratio, id) {
          return value.toLocaleString();
        }
      }
    }
  });
}

let gscData = {};

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
  if (selection.length > 0) {
    return;
  }
  let urlWpath = "https://search.google.com/u/"+background.settings.QrtxK+"/search-console/export/crawl-stats/drilldown";
  let params = {
    hl: "en",
    resource_id: dlSettings['resource_id'],
    request_type: "3",
    at: background.settings.SNlM0e
  }
  if (dlSettings['hostname']) {
    params['hostname'] = dlSettings['hostname'];
  }

  function generateResponseURLs() {
    let dlURL = new URL(urlWpath);
    Object.entries(params).forEach((item) => {
      dlURL.searchParams.set(item[0], item[1]);
    });

    let responseTypes = [
      1, // OK (200)
      2, // Not found (404)
      3, // Unauthorized (401/407)
      4, // Other client error (4XX)
      5, // DNS error
      6, // Fetch error
      7, // Blocked by robots.txt
      9, // Server error (5XX)
      10, // DNS unresponsive
      11, // robots.txt not available
      12, // Page could not be reached
      13, // Page timeout
      15, // Redirect error
      16, // Other fetch error
      17, // Moved permanently (301)
      18, // Moved temporarily (302)
      19, // Moved (other)
      20  // Not modified (304)
    ];

    responseTypes.forEach((responseType) => {
      dlURL.searchParams.set("response", responseType);
      selection.push({
        url: dlURL.href,
        category: "response"
      });
    });
  }

  function generateGooglebotTypeURLs() {
    let dlURL = new URL(urlWpath);
    Object.entries(params).forEach((item) => {
      dlURL.searchParams.set(item[0], item[1]);
    });

    let googlebotTypes = [
      1, // Smartphone
      2, // Desktop
      3, // Image
      4, // Video
      5, // Page resource load
      6, // Other agent type
      7, // AdsBot
      8, // StoreBot
      9  // AMP
    ];

    googlebotTypes.forEach((googlebotType) => {
      dlURL.searchParams.set("googlebot_type", googlebotType);
      selection.push({
        url: dlURL.href,
        category: "googlebot_type"
      });
    });
  }

  function generatePurposeURLs() {
    let dlURL = new URL(urlWpath);
    Object.entries(params).forEach((item) => {
      dlURL.searchParams.set(item[0], item[1]);
    });

    let purposes = [
      1, // Discovery
      2  // Refresh
    ];

    purposes.forEach((purpose) => {
      dlURL.searchParams.set("purpose", purpose);
      selection.push({
        url: dlURL.href,
        category: "purpose"
      });
    });
  }

  function generateFileTypeURLs() {
    let dlURL = new URL(urlWpath);
    Object.entries(params).forEach((item) => {
      dlURL.searchParams.set(item[0], item[1]);
    });

    let file_types = [
      1,  // HTML
      11, // JSON
      4,  // JS
      5,  // CSS
      2,  // IMAGE
      12, // Syndication
      10, // Other XML
      6,  // PDF
      7,  // Other file type
      3,  // VIDEO
      9,  // Unknown (failed requests)
      13, // AUDIO
      14 // Geographic data
    ];

    file_types.forEach((file_type) => {
      dlURL.searchParams.set("file_type", file_type);
      selection.push({
        url: dlURL.href,
        category: "file_type"
      });
    });
  }

  generateResponseURLs();
  generateFileTypeURLs();
  generatePurposeURLs();
  generateGooglebotTypeURLs();
}

function downloadZIPs() {
  dlSettings = {
    resource_id: background.settings.resource_id
  };
  if (background.settings.hostname) {
    dlSettings['hostname'] = background.settings.hostname;
  }
  generateURLs();
  dlQueue = selection.length+1;
  downloadSummary()
}

function calcDownloadProgress() {
  dlQueue--;
  document.title = `${dlQueue} to download`;
}

let dlGscData = {}
function downloadSummary() {
  let dlURL = new URL("https://search.google.com/u/"+background.settings.QrtxK+"/search-console/export/crawl-stats");
  let params = {
    hl: "en",
    resource_id: dlSettings['resource_id'],
    request_type: "3",
    at: background.settings.SNlM0e
  }
  if (dlSettings['hostname']) {
    params['hostname'] = dlSettings['hostname'];
  }

  Object.entries(params).forEach((item) => {
    dlURL.searchParams.set(item[0], item[1]);
  });

  let filename = 'temp';
  fetch(dlURL.href)
    .then(response => {
      if (!response.ok) {
        throw new Error('Network response was not OK');
      }
      const header = response.headers.get('Content-Disposition');
      const parts = header.split(';');
      filename = JSON.parse(parts[1].split('=')[1]);
      return Promise.resolve(response.blob());
    })
    .then(function (blob) {
      calcDownloadProgress();

      if (chromeDownload) {
        var blobURL = window.URL.createObjectURL(blob);
        chrome.downloads.download({
          saveAs: false,
          conflictAction: 'uniquify',
          url: blobURL,
          filename: 'gscData/'+filename
        }, function (id) {
          if(chrome.runtime.lastError) {
            console.warn("Whoops.. " + chrome.runtime.lastError.message);
          }
        });
      }

      return blob;
    })
    .then(JSZip.loadAsync)
    .then(function (zip) {
      zip.files["Summary crawl stats chart.csv"].async('string').then(function (fileData) {
        let csvResult = Papa.parse(fileData,{dynamicTyping: true, header: true});
        csvResult.data.forEach((item, i) => {

          if (dlGscData[item['Date']]) {
            dlGscData[item['Date']]['summary'] = {};
          } else {
            dlGscData[item['Date']] = {
              'summary': {}
            };
          }
          dlGscData[item['Date']]['summary']['category'] = 'summary'
          dlGscData[item['Date']]['summary']['type'] = 'total';
          dlGscData[item['Date']]['summary']['resource_id'] = dlSettings['resource_id'];
          dlGscData[item['Date']]['summary']['hostname'] = dlSettings['hostname'] || dlSettings['resource_id'];
          dlGscData[item['Date']]['summary']['Average response time (ms)'] = item['Average response time (ms)'];
          dlGscData[item['Date']]['summary']['Total crawl requests'] = item['Total crawl requests'];
          dlGscData[item['Date']]['summary']['Total download size (Bytes)'] = item['Total download size (Bytes)'];
        });

        downloadStats();
      });
    })
    .catch(error => {
      console.error('Error:', error);
    });
}

function downloadStats() {
  var row = selection.shift();

  if (!row) {
    chromeDownload = false;
    gscData = dlGscData;

    var save = {};
    var hostname = dlSettings.hostname || dlSettings['resource_id'];
    save[hostname] = mergeGSCdata(dlGscData, hostname);
    chrome.storage.local.set(save);

    filters.hostname = hostname;
    if ([...document.querySelector("#hostname").options].map( opt => opt.value ).includes(hostname)) {
      $('#hostname').val(hostname).change();
    } else {
      $('#hostname').append($('<option>', {
        value: hostname,
        text: hostname
      }));
      $('#hostname').val(hostname);
    }

    tableData = gscDataFlat();
    $table.bootstrapTable('destroy');
    $table.bootstrapTable({
      data: tableData,
      exportTypes: exportTypes
    });
    $table.bootstrapTable('filterBy', filters);
    generateChart();

    return;
  }

  let filename = 'temp';
  fetch(row.url)
    .then(response => {
      if (!response.ok) {
        throw new Error('Network response was not OK');
      }
      const header = response.headers.get('Content-Disposition');
      const parts = header.split(';');
      filename = JSON.parse(parts[1].split('=')[1]);
      return Promise.resolve(response.blob());
    })
    .then(function (blob) {
      calcDownloadProgress();
      if (chromeDownload) {
        var blobURL = window.URL.createObjectURL(blob);
        chrome.downloads.download({
          saveAs: false,
          conflictAction: 'uniquify',
          url: blobURL,
          filename: 'gscData/'+filename
        }, function (id) {
          if(chrome.runtime.lastError) {
            // Something went wrong
            console.warn("Whoops.. " + chrome.runtime.lastError.message);
            // Maybe explain that to the user too?
          }
        });
      }
      return blob;
    })
    .then(JSZip.loadAsync)
    .then(function (zip) {

      zip.files["Metadata.csv"]
        .async('string')
        .then(function (fileData) {
          let csvResult = Papa.parse(fileData,{dynamicTyping: true, header: true});
          let dataType = csvResult.data[0]['Value'];

          zip.files["Chart.csv"].async('string').then(function (fileData) {
            let csvResult = Papa.parse(fileData,{dynamicTyping: true, header: true});

            csvResult.data.forEach((item, i) => {

              if (dlGscData[item['Date']]) {
                dlGscData[item['Date']][dataType] = {};
              } else {
                dlGscData[item['Date']] = {};
                dlGscData[item['Date']][dataType] = {};
              }
              dlGscData[item['Date']][dataType]['category'] = row.category;
              dlGscData[item['Date']][dataType]['type'] = dataType;
              dlGscData[item['Date']][dataType]['resource_id'] = dlSettings['resource_id'];
              dlGscData[item['Date']][dataType]['hostname'] = dlSettings['hostname'] || dlSettings['resource_id'];
              dlGscData[item['Date']][dataType]['Average response time (ms)'] = item['Average response time (ms)'];
              dlGscData[item['Date']][dataType]['Total crawl requests'] = item['Total crawl requests'];
              dlGscData[item['Date']][dataType]['Total download size (Bytes)'] = item['Total download size (Bytes)'];
            });

            setTimeout(downloadStats, 500);
          });

        });

    })
    .catch(error => {
      console.error('Error:', error);
    });

}

$('#downloadBtn').on('click', downloadZIPs);
$('#downloadBtnSave').on('click', function() {
  chromeDownload = true;
  downloadZIPs();
});

chrome.runtime.onMessage.addListener(
  function(request, sender, sendResponse) {

    switch (request.type) {
      case "WIZ_global_data":
        let tabURL = new URL(sender.tab.url);
        let property = tabURL.searchParams.get('hostname') || tabURL.searchParams.get('resource_id');
        $('#downloadBtnTxt').text(property);
        break;
      default:
        console.log(request);
    }
  }
);

setTimeout(function() {
  let property = background.settings.hostname || background.settings.resource_id;
  $('#downloadBtnTxt').text(property);
}, 100);
