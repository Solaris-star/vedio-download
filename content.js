// X/Twitter 视频下载器 v4
// Content Script：浮动按钮 + 分辨率选择，API 全权交给 background.js（Guest Token 方案）

// ---------- 分辨率映射 ----------
const BITRATE_TO_RES = {
  256:   '270p',
  832:   '360p',
  2176:  '720p',
  10368: '1080p',
  25128: '2160p 4K',
};

function fmtBitrate(b) {
  if (b >= 1000000) return (b / 1000000).toFixed(1) + 'Mbps';
  return Math.round(b / 1000) + 'kbps';
}

function fmtLabel(url, bitrate) {
  const res = BITRATE_TO_RES[bitrate] || (bitrate >= 10000000 ? '4K' : bitrate >= 5000000 ? '1080p' : bitrate >= 1000000 ? '720p' : '360p');
  const size = bitrate ? fmtBitrate(bitrate) : '未知';
  if (url) {
    const hasAudio = url && (url.includes('.m4a') || url.includes('/audio/'));
    return `${res} (${size})${hasAudio ? ' +音频' : ''}`;
  }
  return `${res} (${size})`;
}

// ---------- Toast ----------
function showToast(msg, duration) {
  duration = duration || 2500;
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
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, duration);
}

// ---------- 分辨率选择弹窗 ----------
function removePopup() {
  const old = document.getElementById('xdl-res-popup');
  if (old) old.remove();
}

function showResolutionPicker(variants, tweetId) {
  removePopup();

  const popup = document.createElement('div');
  popup.id = 'xdl-res-popup';
  popup.style.cssText = `
    position:fixed; z-index:2147483647;
    background:rgba(15,15,15,0.95); color:#e7e9ea;
    border:1px solid rgba(255,255,255,0.15); border-radius:12px;
    padding:8px 0; min-width:220px;
    backdrop-filter:blur(12px);
    box-shadow:0 8px 32px rgba(0,0,0,0.5);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    font-size:14px;
  `;

  const title = document.createElement('div');
  title.textContent = '选择画质下载';
  title.style.cssText = 'padding:4px 16px 8px;font-size:12px;color:#71767b;font-weight:600;letter-spacing:0.3px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:4px;';
  popup.appendChild(title);

  let defaultIdx = 0;
  variants.forEach((v, i) => {
    if (v.bitrate === 10368) defaultIdx = i;
  });

  variants.forEach((v, i) => {
    const item = document.createElement('div');
    const label = fmtLabel(v.url, v.bitrate);
    const isDefault = i === defaultIdx;
    item.textContent = isDefault ? label + ' ✓' : label;

    item.style.cssText = `
      padding:8px 16px; cursor:pointer;
      transition:background 0.1s;
      display:flex; align-items:center; justify-content:space-between;
      ${isDefault ? 'color:#fff;font-weight:600;' : 'color:#e7e9ea;'}
    `;

    item.onmouseenter = () => { item.style.background = 'rgba(239,243,244,0.1)'; };
    item.onmouseleave = () => { item.style.background = 'transparent'; };

    item.onclick = async (e) => {
      e.stopPropagation();
      popup.style.display = 'none';
      const clean = label.replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, '_');
      const filename = `x-video-${tweetId}-${clean}.mp4`;

      chrome.runtime.sendMessage(
        { action: 'xdl-download', url: v.url, filename },
        (response) => {
          if (response?.success) {
            showToast(`✅ 开始下载 ${label}`);
          } else {
            showToast('❌ 下载失败: ' + (response?.error || '未知错误'));
          }
        }
      );
      setTimeout(removePopup, 300);
    };

    popup.appendChild(item);
  });

  // 定位
  const btn = document.getElementById('xdl-float-btn');
  if (btn) {
    const r = btn.getBoundingClientRect();
    popup.style.top = (r.top - 10) + 'px';
    popup.style.left = (r.left - 210) + 'px';
  } else {
    popup.style.top = '50%';
    popup.style.left = '50%';
    popup.style.transform = 'translate(-50%, -50%)';
  }

  document.body.appendChild(popup);

  setTimeout(() => {
    const closer = (e) => {
      if (!popup.contains(e.target) && e.target.id !== 'xdl-float-btn') {
        removePopup();
        document.removeEventListener('click', closer);
      }
    };
    document.addEventListener('click', closer);
  }, 100);
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

    btn.textContent = '⏳ 获取视频信息...';
    btn.style.pointerEvents = 'none';

    // 委托 background.js 去调 GraphQL API
    chrome.runtime.sendMessage(
      { action: 'xdl-get-variants', tweetId },
      (response) => {
        btn.textContent = '⬇ 下载视频';
        btn.style.pointerEvents = 'auto';

        if (response?.error) {
          showToast('❌ ' + response.error);
          return;
        }

        if (response?.variants && response.variants.length > 0) {
          showResolutionPicker(response.variants, tweetId);
        } else {
          showToast('❌ 该推文中未找到可下载的视频');
        }
      }
    );
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
  removePopup();

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

// ---------- 扫描 ----------
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

// ---------- 事件 ----------
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

[800, 2000, 4000, 6000, 10000].forEach(t => setTimeout(scan, t));
setInterval(scan, 5000);