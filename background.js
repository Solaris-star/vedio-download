// Background Service Worker - 通过 X API 获取视频直链

const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// ------------- 从 cookie 获取 CSRF token -------------
async function getCsrfToken() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: 'x.com' });
    const ct0 = cookies.find(c => c.name === 'ct0');
    return ct0?.value || '';
  } catch (e) {
    return '';
  }
}

// ------------- 获取 guest token -------------
async function getGuestToken() {
  const resp = await fetch('https://api.twitter.com/1.1/guest/activate.json', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${BEARER_TOKEN}` }
  });
  const data = await resp.json();
  return data.guest_token;
}

// ------------- 通过 API 获取推文视频 URL -------------
async function fetchTweetVideo(tweetId) {
  // 尝试 1: 用 cookies → 已登录状态
  const ct0 = await getCsrfToken();
  if (ct0) {
    try {
      const resp = await fetch(
        `https://api.twitter.com/1.1/statuses/show.json?id=${tweetId}&tweet_mode=extended`,
        {
          credentials: 'include',
          headers: {
            'Authorization': `Bearer ${BEARER_TOKEN}`,
            'x-csrf-token': ct0,
            'x-twitter-auth-type': 'OAuth2Session',
            'x-twitter-active-user': 'yes'
          }
        }
      );
      if (resp.ok) {
        const tweet = await resp.json();
        const videoUrl = extractVideoFromTweet(tweet);
        if (videoUrl) return videoUrl;
      }
    } catch(e) {
      console.log('[XDL] Cookie auth failed:', e.message);
    }
  }

  // 尝试 2: 用 guest token → 游客状态
  try {
    const guestToken = await getGuestToken();
    const resp = await fetch(
      `https://api.twitter.com/1.1/statuses/show.json?id=${tweetId}&tweet_mode=extended`,
      {
        headers: {
          'Authorization': `Bearer ${BEARER_TOKEN}`,
          'x-guest-token': guestToken
        }
      }
    );
    if (resp.ok) {
      const tweet = await resp.json();
      const videoUrl = extractVideoFromTweet(tweet);
      if (videoUrl) return videoUrl;
    }
  } catch(e) {
    console.log('[XDL] Guest token failed:', e.message);
  }

  return null;
}

function extractVideoFromTweet(tweet) {
  const media = tweet?.extended_entities?.media || [];
  for (const m of media) {
    if (m.type === 'video' || m.type === 'animated_gif') {
      const mp4s = (m.video_info?.variants || [])
        .filter(v => v.content_type === 'video/mp4')
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      if (mp4s.length > 0) return mp4s[0].url;
    }
  }
  return null;
}

// ------------- 处理来自 content script 的消息 -------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'download-video') {
    fetchTweetVideo(request.tweetId).then(videoUrl => {
      if (videoUrl) {
        chrome.downloads.download({
          url: videoUrl,
          filename: `x-video-${request.tweetId}.mp4`,
          saveAs: true
        });
        sendResponse({ success: true, url: videoUrl });
      } else {
        sendResponse({ success: false, error: '获取视频链接失败，请确认已登录 X 账号' });
      }
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});
