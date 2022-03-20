var settings = {};

chrome.runtime.onMessage.addListener(
  function(request, sender, sendResponse) {
    let tabURL = new URL(sender.tab.url);

    switch (request.type) {
      case "WIZ_global_data":
        settings = request?.data || {};
        settings['resource_id'] = tabURL.searchParams.get('resource_id');
        settings['hostname'] = tabURL.searchParams.get('hostname');
        break;
      default:
        console.log(request);
    }
  }
);

chrome.browserAction.onClicked.addListener(function (tab) {
  chrome.tabs.create({'url': chrome.extension.getURL('options.html')}, function (tab) {});
});
