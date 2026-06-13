// X/Twitter 视频下载器 - Content Script
// 注入页面脚本来拦截 fetch（MV3 隔离世界限制）

// ---------- 注入页面脚本（在页面主世界运行，能拦截真正的 fetch）----------
const pageScript = document.createElement('script');
pageScript.src = chrome.runtime.getURL('page.js');
pageScript.onload = () => pageScript.remove();
(document.head || document.documentElement).appendChild(pageScript);

// ---------- 监听页面脚本发来的视频 URL ----------
window.addEventListener('xdl-video-found', (e) => {
  const { tweetId, url, quality, bitrate } = e.detail;
  // 存入全局 cache
  window.__xdlCache = window.__xdlCache || {};
  window.__xdlCache[tweetId] = { url, quality, bitrate };
});

// ---------- DOM 扫描添加下载按钮 ----------
function addDownloadButtons() {
  document.querySelectorAll('article').forEach(tweet => {
    if (tweet.dataset.xdlScanned) return;

    const videoBlock = tweet.querySelector('[class*="video"], [class*="player"]');
    if (!videoBlock) return;

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
      // 还没获取到数据，标记等待重试
      tweet.dataset.xdlWaiting = 'true';
      return;
    }

    // 创建下载按钮
    const btn = document.createElement('button');
    btn.className = 'xdl-btn';
    btn.innerHTML = `⬇ 下载 ${cached.quality || '视频'}`;
    btn.title = `下载此视频`;

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      btn.textContent = '⬇ 下载中...';
      btn.disabled = true;
      chrome.runtime.sendMessage({
        action: 'download',
        url: cached.url,
        filename: `x-video-${tweetId}.mp4`
      });
    });

    videoBlock.style.position = 'relative';
    videoBlock.appendChild(btn);
  });

  // 重试等待中的
  const waiting = document.querySelectorAll('article[data-xdl-waiting]');
  if (waiting.length > 0) {
    setTimeout(addDownloadButtons, 2000);
  }
}

// 监听 DOM
const observer = new MutationObserver(() => addDownloadButtons());
if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

setTimeout(addDownloadButtons, 2000);
setTimeout(addDownloadButtons, 5000);

// 定期扫描（处理页面长时间未触发 MutationObserver 的情况）
setInterval(() => {
  document.querySelectorAll('article[data-xdl-waiting]').forEach(el => {
    el.dataset.xdlScanned = '';
    el.dataset.xdlWaiting = '';
  });
  addDownloadButtons();
}, 3000);
