// X/Twitter 视频下载器 v3 - 浮动按钮 + GraphQL API + 分辨率选择
// 核心：content script 直接调 X GraphQL API（有页面 cookies，自带登录态）
// background.js 只负责 chrome.downloads.download

const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// ---------- Cookie 读取 ----------
function getCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// ---------- 分辨率映射 ----------
const BITRATE_TO_RES = {
  256:  '270p',
  832:  '360p',
  2176: '720p',
  10368: '1080p',
  25128: '2160p 4K',
};

function fmtBitrate(b) {
  if (b >= 1000000) return (b / 1000000).toFixed(1) + 'Mbps';
  return Math.round(b / 1000) + 'kbps';
}

function fmtLabel(url, bitrate) {
  const res = BITRATE_TO_RES[bitrate] || (bitrate >= 10000000 ? '4K' : bitrate >= 5000000 ? '1080p' : '720p');
  const size = bitrate ? fmtBitrate(bitrate) : '未知';
  return `${res} (${size})`;
}

// ---------- GraphQL API 调用 ----------
const QUERY_IDS = [
  { id: 'fP4dG0Q0mqi8YNHRfocw-A', name: 'TweetDetail' },
  { id: 'V8Y7RvxfQwbFgDbyPyfDqQ', name: 'TweetDetail' },
  { id: 'mLTm4vHZfbJ5CCGiIYR-HQ', name: 'TweetDetail' },
];

const FEATURES = {
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_vertical: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  tweet_awards_info_tweet_api_metrics_enabled: true,
  immersive_tweet_via_web_enabled: true,
  super_follow_badge_privacy_enabled: false,
  super_follow_tweet_api_enabled: true,
  super_follow_user_api_enabled: true,
  premium_content_api_read_enabled: true,
  responsive_web_media_download_video_enabled: false,
};

function makeVariables(tweetId) {
  return {
    focalTweetId: tweetId,
    with_rux_injections: false,
    rankingMode: 'Bidirectional',
    cursor: null,
    referer: null,
    controller_data: null,
    withBirdwatchNotes: false,
    withCommunityNotes: false,
  };
}

async function fetchVideoVariants(tweetId) {
  const ct0 = getCookie('ct0');
  if (!ct0) {
    return { error: '获取登录凭证失败，请刷新页面后重试' };
  }

  const headers = {
    'authorization': `Bearer ${BEARER}`,
    'x-csrf-token': ct0,
    'content-type': 'application/json',
  };

  for (const q of QUERY_IDS) {
    try {
      const resp = await fetch(`https://x.com/i/api/graphql/${q.id}/${q.name}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          variables: makeVariables(tweetId),
          features: FEATURES,
        }),
      });

      if (!resp.ok) continue;

      const data = await resp.json();
      const variants = extractVariants(data);
      if (variants && variants.length > 0) return { variants };
    } catch (e) {
      console.log(`[XDL] Query ${q.id} failed:`, e.message);
    }
  }

  return { error: '获取视频链接失败，请确认已登录 X 账号' };
}

// ---------- 从 GraphQL 响应提取视频变体 ----------
function extractVariants(data) {
  try {
    // 尝试多种路径提取 media 信息
    const paths = [
      d => d?.data?.tweetResult?.result?.legacy?.extended_entities?.media,
      d => d?.data?.tweetResult?.result?.legacy?.entities?.media,
      d => d?.data?.tweetDetailResult?.result?.legacy?.extended_entities?.media,
    ];

    let media = null;
    for (const p of paths) {
      media = p(data);
      if (media) break;
    }

    if (!media || !Array.isArray(media)) return null;

    for (const m of media) {
      if (m.type === 'video' || m.type === 'animated_gif') {
        const variants = (m.video_info?.variants || [])
          .filter(v => v.content_type === 'video/mp4')
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

        if (variants.length > 0) return variants;
      }
    }
  } catch (e) {
    console.log('[XDL] extractVariants error:', e.message);
  }
  return null;
}

// ---------- 清除旧的弹窗 ----------
function removeOldPopup() {
  const old = document.getElementById('xdl-res-popup');
  if (old) old.remove();
}

// ---------- 显示分辨率选择弹窗 ----------
function showResolutionPicker(variants, tweetId) {
  removeOldPopup();

  const popup = document.createElement('div');
  popup.id = 'xdl-res-popup';
  popup.style.cssText = `
    position:fixed; z-index:2147483647;
    background:rgba(15,15,15,0.95); color:#e7e9ea;
    border:1px solid rgba(255,255,255,0.15); border-radius:12px;
    padding:8px 0; min-width:200px;
    backdrop-filter:blur(12px);
    box-shadow:0 8px 32px rgba(0,0,0,0.5);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    font-size:14px;
  `;

  const title = document.createElement('div');
  title.textContent = '选择画质';
  title.style.cssText = 'padding:4px 16px 8px;font-size:12px;color:#71767b;font-weight:600;letter-spacing:0.3px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:4px;';
  popup.appendChild(title);

  // 推荐默认 1080p
  let defaultIdx = 0;
  variants.forEach((v, i) => {
    if (v.bitrate === 10368) defaultIdx = i;
  });

  variants.forEach((v, i) => {
    const item = document.createElement('div');
    const label = fmtLabel(v.url, v.bitrate);
    item.textContent = label;
    const isDefault = i === defaultIdx;
    if (isDefault) item.textContent += ' ✓';

    item.style.cssText = `
      padding:8px 16px; cursor:pointer;
      transition:background 0.1s;
      display:flex; align-items:center; justify-content:space-between;
      ${isDefault ? 'color:#fff;' : 'color:#e7e9ea;'}
    `;

    item.onmouseenter = () => { item.style.background = 'rgba(239,243,244,0.1)'; };
    item.onmouseleave = () => { item.style.background = 'transparent'; };

    item.onclick = async (e) => {
      e.stopPropagation();
      popup.style.display = 'none';
      // 立即触发下载
      const filename = `x-video-${tweetId}-${label.replace(/[^a-zA-Z0-9]/g,'_')}.mp4`;
      chrome.runtime.sendMessage(
        { action: 'xdl-download', url: v.url, filename },
        (response) => {
          if (response?.success) {
            showToast(`✅ 正在下载 ${label}`);
          } else {
            showToast('❌ 下载失败');
          }
        }
      );
      setTimeout(() => removeOldPopup(), 500);
    };

    popup.appendChild(item);
  });

  // 定位：在浮动按钮附近
  const btn = document.getElementById('xdl-float-btn');
  if (btn) {
    const rect = btn.getBoundingClientRect();
    popup.style.top = (rect.top - 10) + 'px';
    popup.style.left = (rect.left - 200) + 'px';
  } else {
    popup.style.top = '50%';
    popup.style.left = '50%';
    popup.style.transform = 'translate(-50%, -50%)';
  }

  document.body.appendChild(popup);

  // 点击其他地方关闭
  setTimeout(() => {
    const closer = (e) => {
      if (!popup.contains(e.target) && e.target.id !== 'xdl-float-btn') {
        removeOldPopup();
        document.removeEventListener('click', closer);
      }
    };
    document.addEventListener('click', closer);
  }, 100);
}

// ---------- Toast 提示 ----------
function showToast(msg) {
  const old = document.getElementById('xdl-toast');
  if (old) old.remove();

  const toast = document.createElement('div');
  toast.id = 'xdl-toast';
  toast.textContent = msg;
  toast.style.cssText = `
    position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
    z-index:2147483647;
    background:rgba(0,0,0,0.85); color:#fff;
    padding:10px 20px; border-radius:9999px;
    font-size:14px; font-weight:500;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    box-shadow:0 4px 16px rgba(0,0,0,0.3);
    transition:opacity 0.3s;
  `;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2500);
}

// ---------- 浮动按钮 ----------
const BTN_ID = 'xdl-float-btn';
let activeVideo = null;
let animFrame = null;

function ensureButton() {
  let btn = document.getElementById(BTN_ID);
  if (btn) return btn;

  btn = document.createElement('div');
  btn.id = BTN_ID;
  btn.textContent = '⬇ 下载视频';
  btn.style.cssText = `
    position:fixed; z-index:2147483647; display:none;
    background:rgba(0,0,0,0.75); color:#fff;
    border:1px solid rgba(255,255,255,0.2); border-radius:9999px;
    padding:6px 14px; font-size:13px; font-weight:600;
    cursor:pointer; backdrop-filter:blur(4px);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    box-shadow:0 2px 8px rgba(0,0,0,0.3);
    transition:background 0.15s;
    user-select:none;
  `;

  btn.onmouseenter = () => { btn.style.background = 'rgba(29,155,240,0.9)'; };
  btn.onmouseleave = () => { btn.style.background = 'rgba(0,0,0,0.75)'; };

  btn.onclick = async (e) => {
    e.stopPropagation();
    const tweetId = btn.dataset.tweetId;
    if (!tweetId) return;

    // 显示加载状态
    btn.textContent = '⏳ 获取视频信息...';
    btn.style.pointerEvents = 'none';

    const result = await fetchVideoVariants(tweetId);

    btn.textContent = '⬇ 下载视频';
    btn.style.pointerEvents = 'auto';

    if (result.error) {
      showToast('❌ ' + result.error);
      return;
    }

    if (result.variants && result.variants.length > 0) {
      showResolutionPicker(result.variants, tweetId);
    } else {
      showToast('❌ 该推文中未找到可下载的视频');
    }
  };

  document.body.appendChild(btn);
  return btn;
}

// ---------- 跟踪视频位置 ----------
function trackAndShow(video, tweetId) {
  const btn = ensureButton();
  if (animFrame) cancelAnimationFrame(animFrame);

  activeVideo = video;
  btn.dataset.tweetId = tweetId;
  removeOldPopup();

  function updatePos() {
    if (!activeVideo || !activeVideo.isConnected || !document.body.contains(activeVideo)) {
      btn.style.display = 'none';
      activeVideo = null;
      animFrame = null;
      return;
    }

    const r = activeVideo.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
      btn.style.display = 'none';
      activeVideo = null;
      animFrame = null;
      return;
    }

    btn.style.display = 'flex';
    btn.style.top = (r.top + 12) + 'px';
    btn.style.left = (r.right - btn.offsetWidth - 12) + 'px';
    animFrame = requestAnimationFrame(updatePos);
  }

  updatePos();
}

// ---------- 扫描页面 ----------
function scan() {
  document.querySelectorAll('article').forEach(tweet => {
    if (tweet.dataset.xdlDone) return;
    const video = tweet.querySelector('video');
    if (!video) return;
    const links = tweet.querySelectorAll('a[href*="/status/"]');
    for (const link of links) {
      const m = link.href.match(/\/status\/(\d+)/);
      if (m) {
        tweet.dataset.xdlDone = 'true';
        const tweetId = m[1];
        // 检查这个视频是否在 viewport 中心附近
        const r = video.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const vpCenter = window.innerHeight / 2;
        const vCenter = r.top + r.height / 2;
        if (Math.abs(vCenter - vpCenter) < window.innerHeight * 0.6) {
          trackAndShow(video, tweetId);
        }
        break;
      }
    }
  });
}

// ---------- 事件绑定 ----------
let scrollTimer = null;
window.addEventListener('scroll', () => {
  if (scrollTimer) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(scan, 150);
}, { passive: true });

if (document.body) {
  new MutationObserver(() => {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(scan, 300);
  }).observe(document.body, { childList: true, subtree: true });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(() => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(scan, 300);
    }).observe(document.body, { childList: true, subtree: true });
  });
}

// 初始 + 定时扫描
[800, 2000, 4000, 6000, 10000].forEach(t => setTimeout(scan, t));
setInterval(scan, 5000);