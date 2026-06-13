// X/Twitter 视频下载器 v3 - 浮动按钮方案
// 核心原则：绝不触碰 X 的 React DOM 树，用 position:fixed 浮动按钮覆盖在视频上

function findVideoTweets() {
  const results = [];
  document.querySelectorAll('article').forEach(tweet => {
    if (tweet.dataset.xdlDone) return;
    const video = tweet.querySelector('video');
    if (!video) return;
    const links = tweet.querySelectorAll('a[href*="/status/"]');
    for (const link of links) {
      const m = link.href.match(/\/status\/(\d+)/);
      if (m) {
        results.push({ tweet, video, tweetId: m[1] });
        tweet.dataset.xdlDone = 'true';
        break;
      }
    }
  });
  return results;
}

// ---------- 创建浮动按钮 ----------
const btnId = 'xdl-float-btn';
function ensureButton() {
  let btn = document.getElementById(btnId);
  if (!btn) {
    btn = document.createElement('div');
    btn.id = btnId;
    btn.textContent = '⬇ 下载视频';
    btn.style.cssText = `
      position:fixed; z-index:2147483647; display:none;
      background:rgba(0,0,0,0.75); color:#fff;
      border:1px solid rgba(255,255,255,0.2); border-radius:8px;
      padding:6px 12px; font-size:13px; font-weight:600;
      cursor:pointer; backdrop-filter:blur(4px);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      box-shadow:0 2px 8px rgba(0,0,0,0.3); pointer-events:auto;
      transition:opacity 0.15s;
    `;
    btn.onmouseenter = () => { btn.style.background = 'rgba(29,155,240,0.9)'; };
    btn.onmouseleave = () => { btn.style.background = 'rgba(0,0,0,0.75)'; };
    
    let currentTweetId = '';
    let downloading = false;
    
    btn.onclick = (e) => {
      e.stopPropagation();
      if (!currentTweetId || downloading) return;
      downloading = true;
      btn.textContent = '⏳ 获取链接...';
      
      chrome.runtime.sendMessage(
        { action: 'download-video', tweetId: currentTweetId },
        (response) => {
          downloading = false;
          if (response?.success) {
            btn.textContent = '✅ 已下载';
            setTimeout(() => { btn.textContent = '⬇ 下载视频'; }, 3000);
          } else {
            btn.textContent = '❌ ' + (response?.error?.substring(0, 15) || '失败');
            setTimeout(() => { btn.textContent = '⬇ 下载视频'; }, 3000);
          }
        }
      );
    };
    
    document.body.appendChild(btn);
  }
  return btn;
}

// ---------- 更新按钮位置 ----------
let activeVideo = null;
let animFrame = null;

function trackAndShow(video, tweetId) {
  const btn = ensureButton();
  activeVideo = video;
  btn.dataset.tweetId = tweetId;
  btn.style.display = 'block';
  
  function updatePosition() {
    if (!activeVideo || !activeVideo.isConnected || !document.body.contains(activeVideo)) {
      btn.style.display = 'none';
      activeVideo = null;
      animFrame = null;
      return;
    }
    
    const rect = activeVideo.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      btn.style.display = 'none';
      animFrame = null;
      return;
    }
    
    btn.style.display = 'block';
    btn.style.top = (rect.top + 8) + 'px';
    btn.style.left = (rect.right - btn.offsetWidth - 8) + 'px';
    
    // 绑定 tweet ID 给点击事件
    btn.dataset.tweetId = tweetId;
    // 重建 click handler 以使用最新的 tweetId
    const newBtn = btn;
    newBtn.onclick = (e) => {
      e.stopPropagation();
      const tId = newBtn.dataset.tweetId;
      if (!tId || btn.dataset.downloading === 'true') return;
      btn.dataset.downloading = 'true';
      newBtn.textContent = '⏳ 获取链接...';
      
      chrome.runtime.sendMessage(
        { action: 'download-video', tweetId: tId },
        (response) => {
          btn.dataset.downloading = 'false';
          if (response?.success) {
            newBtn.textContent = '✅ 已下载';
            setTimeout(() => { newBtn.textContent = '⬇ 下载视频'; }, 3000);
          } else {
            newBtn.textContent = '❌ ' + (response?.error?.substring(0, 15) || '失败');
            setTimeout(() => { newBtn.textContent = '⬇ 下载视频'; }, 3000);
          }
        }
      );
    };
    
    animFrame = requestAnimationFrame(updatePosition);
  }
  
  if (animFrame) cancelAnimationFrame(animFrame);
  updatePosition();
}

// ---------- 扫描页面 ----------
function scan() {
  const tweets = findVideoTweets();
  if (tweets.length === 0) return;
  
  // 找到当前可见区域内的第一个视频推文
  const viewportCenter = window.innerHeight / 2;
  let closest = null;
  let closestDist = Infinity;
  
  for (const t of tweets) {
    const rect = t.video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const dist = Math.abs(rect.top + rect.height / 2 - viewportCenter);
    if (dist < closestDist) {
      closestDist = dist;
      closest = t;
    }
  }
  
  if (closest) {
    trackAndShow(closest.video, closest.tweetId);
  }
}

// 监听滚动和变化
let scrollTimer = null;
window.addEventListener('scroll', () => {
  if (scrollTimer) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(scan, 200);
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

// 初始扫描
[500, 1500, 3000, 5000, 8000].forEach(t => setTimeout(scan, t));
setInterval(scan, 4000);
