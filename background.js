// Background Service Worker v3 - 仅负责下载，API 调用全部移到 content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'xdl-download') {
    chrome.downloads.download({
      url: request.url,
      filename: request.filename || `x-video-${Date.now()}.mp4`,
      saveAs: true
    }).then(downloadId => {
      sendResponse({ success: true, downloadId });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});

// 清理旧下载
chrome.downloads.onDeterminingFilename && chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  suggest({ filename: item.filename });
});
