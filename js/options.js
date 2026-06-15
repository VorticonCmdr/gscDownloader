// backup data
function downloadBlob(content, filename, contentType) {
  // Create a blob
  var blob = new Blob([content], { type: contentType });
  var url = URL.createObjectURL(blob);
  // Create a link to download it
  var pom = document.createElement('a');
  pom.href = url;
  pom.setAttribute('download', filename);
  pom.click();
}
function backupData() {
  chrome.storage.local.get(null, function(data) {
    let timestamp = new Date().getTime();
    let totalDataString = JSON.stringify(data);
    var zip = new JSZip();
    zip.file(`backup.json`, totalDataString);
    zip.generateAsync({type:"blob"})
    .then(function(content) {
      downloadBlob(content, `${timestamp}-backup.zip`, "");
    });
  });
}
$('#backup').on('click', backupData);

// restore backup
const dropArea = document.getElementById('drop-area');
const fileInput = document.getElementById('fileInput');

function readFile(file) {
  let new_zip = new JSZip();
  const reader = new FileReader();
  reader.onload = () => {
    new_zip.loadAsync(reader.result)
    .then(function(zip) {
      zip.file("backup.json").async("string")
      .then(function (fileData) {
        try {
          let totalData = JSON.parse(fileData);
          chrome.storage.local.set(totalData);
          console.log('backup restored');
        } catch (e) {
          console.log(e);
        }
      });
    });
  };
  reader.readAsBinaryString(file);
}

dropArea.addEventListener('dragover', (event) => {
  event.stopPropagation();
  event.preventDefault();
  // Style the drag-and-drop as a "copy file" operation.
  event.dataTransfer.dropEffect = 'copy';
});

dropArea.addEventListener('drop', (event) => {
  event.stopPropagation();
  event.preventDefault();
  const fileList = event.dataTransfer.files;
  readFile(fileList[0]);
});

fileInput.addEventListener('change', (event) => {
  const fileList = event.target.files;
  readFile(fileList[0]);
});
