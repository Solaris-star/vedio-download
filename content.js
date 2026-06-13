// X/Twitter 视频下载器 - Content Script
// 扫描视频推文添加下载按钮，后台脚本负责获取视频直链

function addDownloadButtons() {
  document.querySelectorAll('article').forEach(tweet => {
    if (tweet.dataset.xdlDone) return;

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

    tweet.dataset.xdlDone = 'true';

    // 找容器放按钮（视频的父容器）
    let container = video.closest('[class*="r-"]') // X 的 Tailwind 类
      || video.parentElement?.closest('div[class]')
      || video.parentElement;

    if (!container) return;
    if (container.querySelector('.xdl-btn')) return;
    container.style.position = container.style.position || 'relative';

    // 创建按钮
    const btn = document.createElement('button');
    btn.className = 'xdl-btn';
    btn.textContent = '⬇ 下载视频';
    btn.title = '下载此视频';

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      btn.textContent = '⏳ 获取链接...';
      btn.disabled = true;

      chrome.runtime.sendMessage(
        { action: 'download-video', tweetId },
        (response) => {
          if (response?.success) {
            btn.textContent = '✅ 已下载';
          } else {
            btn.textContent = '❌ ' + (response?.error || '失败');
            setTimeout(() => {
              btn.textContent = '⬇ 下载视频';
              btn.disabled = false;
            }, 3000);
          }
        }
      );
    });

    container.appendChild(btn);
  });
}

// 监听 DOM 变化
if (document.body) {
  new MutationObserver(() => addDownloadButtons())
    .observe(document.body, { childList: true, subtree: true });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(() => addDownloadButtons())
      .observe(document.body, { childList: true, subtree: true });
  });
}

// 初始扫描 + 定期兜底
const scans = [1000, 3000, 5000, 8000];
scans.forEach(t => setTimeout(addDownloadButtons, t));
setInterval(addDownloadButtons, 5000);
