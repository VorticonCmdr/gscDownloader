var s = document.createElement('script');
s.src = chrome.extension.getURL('js/script.js');
(document.head||document.documentElement).appendChild(s);
s.onload = function() {
  s.remove();
};

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
      break;
    default:
      //console.log(event.data);
  }
});
