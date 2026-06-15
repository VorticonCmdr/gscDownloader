chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({'url': chrome.runtime.getURL('crawl-stats.html')}, function (tab) {});
});

chrome.runtime.onMessage.addListener(
  function(request, sender, sendResponse) {
    // need to return true
    return true;
  }
);
