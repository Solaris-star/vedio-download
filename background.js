// Background Service Worker v5
// 使用 twimg syndication API（公开，无需任何认证/令牌）

async function fetchVideoVariants(tweetId) {
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=0`;

  try {
    const resp = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; XDL/5.0)' }
    });

    if (!resp.ok) {
      return { error: `API 返回 ${resp.status}` };
    }

    const data = await resp.json();
    const mediaDetails = data?.mediaDetails;
    if (!mediaDetails || !Array.isArray(mediaDetails) || mediaDetails.length === 0) {
      return { error: '该推文中不包含视频' };
    }

    for (const m of mediaDetails) {
      if (m.type === 'video' || m.type === 'animated_gif') {
        const variants = (m.video_info?.variants || [])
          .filter(v => v.content_type === 'video/mp4')
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

        if (variants.length > 0) {
          return { variants };
        }
      }
    }

    return { error: '未找到 MP4 视频变体' };
  } catch (e) {
    return { error: '请求失败: ' + e.message };
  }
}

// ---------- 消息处理 ----------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'xdl-get-variants') {
    fetchVideoVariants(request.tweetId).then(sendResponse);
    return true;
  }

  if (request.action === 'xdl-download') {
    chrome.downloads.download({
      url: request.url,
      filename: request.filename || `x-video-${Date.now()}.mp4`,
      saveAs: true,
    }).then(downloadId => {
      sendResponse({ success: true, downloadId });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});

console.log('[XDL BG] v5 loaded (syndication API)');