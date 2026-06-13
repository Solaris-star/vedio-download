// X/Twitter 视频下载器 - Content Script
// 注入页面脚本来拦截 fetch + 添加下载按钮

// ---------- 注入页面脚本（在页面主世界运行，能拦截真正的 fetch）----------
function injectPageScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('page.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

if (document.head || document.documentElement) {
  injectPageScript();
} else {
  document.addEventListener('DOMContentLoaded', injectPageScript);
}

// ---------- 监听页面脚本发来的视频 URL ----------
window.addEventListener('xdl-video-found', (e) => {
  const { tweetId, url, quality, bitrate } = e.detail;
  window.__xdlCache = window.__xdlCache || {};
  window.__xdlCache[tweetId] = { url, quality, bitrate };

  // 立即尝试为此 tweet 添加按钮
  document.querySelectorAll('article').forEach(tweet => {
    if (tweet.dataset.xdlScanned) return;
    tryAddButton(tweet);
  });
});

// ---------- 为单个 tweet 尝试添加按钮 ----------
function tryAddButton(tweet) {
  if (tweet.dataset.xdlScanned) return;

  // 找 video 元素
  const video = tweet.querySelector('video');
  if (!video) return;

  // 提取 tweet ID
  const links = tweet.querySelectorAll('a[href*="/status/"]');
  let tweetId = '';
  for (const link of links) {
    const m = link.href.match(/\/status\/(\d+)/);
    if (m) { tweetId = m[1]; break; }
  }
  if (!tweetId) return;

  tweet.dataset.xdlScanned = 'true';
  window.__xdlCache = window.__xdlCache || {};

  const cached = window.__xdlCache[tweetId];
  if (!cached) {
    // 还没获取到数据，标记等待
    tweet.dataset.xdlWaiting = 'true';
    return;
  }

  // 找合适的容器来放按钮：video 的父级或爷级，要 position:relative 才能定位
  let container = video.closest('[class*="video"], [class*="media"], [class*="player"]')
    || video.parentElement?.closest('[class*="r-"]')
    || video.parentElement;

  if (!container) return;
  if (container.querySelector('.xdl-btn')) return;

  container.style.position = container.style.position || 'relative';

  const btn = document.createElement('button');
  btn.className = 'xdl-btn';
  btn.innerHTML = `⬇ 下载 ${cached.quality || '视频'}`;
  btn.title = `下载视频 ${cached.quality || ''}`;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    btn.textContent = '⏬ 下载中...';
    btn.disabled = true;
    chrome.runtime.sendMessage({
      action: 'download',
      url: cached.url,
      filename: `x-video-${tweetId}.mp4`
    });
    setTimeout(() => { btn.textContent = '✅ 已下载'; }, 2000);
  });

  container.appendChild(btn);
}

// ---------- DOM 扫描 ----------
function scanArticles() {
  document.querySelectorAll('article').forEach(tryAddButton);

  // 重试等待中的
  const waiting = document.querySelectorAll('article[data-xdl-waiting]');
  if (waiting.length > 0) {
    setTimeout(scanArticles, 1500);
  }
}

// 监听 DOM
if (document.body) {
  new MutationObserver(() => scanArticles())
    .observe(document.body, { childList: true, subtree: true });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(() => scanArticles())
      .observe(document.body, { childList: true, subtree: true });
  });
}

// 初始扫描 + 定期兜底
setTimeout(scanArticles, 1000);
setTimeout(scanArticles, 3000);
setTimeout(scanArticles, 6000);
setInterval(() => {
  document.querySelectorAll('article[data-xdl-waiting]').forEach(el => {
    el.dataset.xdlScanned = '';
    el.dataset.xdlWaiting = '';
  });
  scanArticles();
}, 4000);
