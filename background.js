chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'download') {
    chrome.downloads.download({
      url: request.url,
      filename: request.filename || `x-video-${Date.now()}.mp4`,
      saveAs: true
    });
  }
});