function sendData() {
  if (!window?.WIZ_global_data?.SNlM0e) {
    return;
  }
  window.postMessage(
    {
      type: 'WIZ_global_data',
      data: window.WIZ_global_data
    },
    '*' /* targetOrigin: any */);
}
setTimeout(sendData, 10);

let href = window.location.href;
window.addEventListener("click", function() {
  if (window.location.href != href) {
    href = window.location.href;

    sendData();
  }
});

window.addEventListener('popstate', function(e){
  sendData();
});
