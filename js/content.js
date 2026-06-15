var eventData = {};

chrome.runtime.onMessage.addListener(
  function(request, sender, sendResponse) {
    if (request?.type == 'getWIZ') {
      sendResponse({
        type: 'WIZ_global_data',
        data: eventData
      });
    }
  }
);

window.addEventListener('message', function(event) {

  if (event.origin !== 'https://search.google.com') {
    return;
  }

  switch (event.data.type) {
    case "WIZ_global_data":
      chrome.runtime.sendMessage({
        type: 'WIZ_global_data',
        data: event.data.data
      });

      let tabURL = new URL(window.location.href);
      eventData = {
        'resource_id': tabURL.searchParams.get('resource_id'),
        'hostname': tabURL.searchParams.get('hostname'),
        'QrtxK': event.data.data.QrtxK,
        'SNlM0e': event.data.data.SNlM0e
      };

      break;
    default:
      //console.log(event.data);
  }

});

var s = document.createElement('script');
s.src = chrome.runtime.getURL('js/script.js');
(document.head||document.documentElement).appendChild(s);
s.onload = function() {
  s.remove();
};
