// page.js - 在页面主世界运行，拦截 fetch 获取 X API 中的视频 URL
(function() {
  // 防止重复注入
  if (window.__xdlInjected) return;
  window.__xdlInjected = true;

  const videoCache = {};

  // 从 X GraphQL 响应中提取视频 URL
  function extractVideos(json) {
    try {
      const entries = json?.data?.threaded_conversation_with_injections?.instructions?.[0]?.entries || [];
      for (const entry of entries) {
        const result = entry?.content?.itemContent?.tweet_results?.result;
        if (!result) continue;
        const media = result?.legacy?.extended_entities?.media || [];
        for (const m of media) {
          if (m.type === 'video' || m.type === 'animated_gif') {
            const variants = m?.video_info?.variants || [];
            let best = null;
            for (const v of variants) {
              if (v.content_type === 'video/mp4' && (!best || (v.bitrate || 0) > (best.bitrate || 0))) {
                best = v;
              }
            }
            if (best) {
              const tweetId = result.rest_id || result.id_str;
              const quality = best.url.match(/(\d+)x(\d+)/)?.[0] || 'unknown';
              videoCache[tweetId] = { url: best.url, quality, bitrate: best.bitrate || 0 };
              // 通知 content script
              window.dispatchEvent(new CustomEvent('xdl-video-found', {
                detail: { tweetId, url: best.url, quality, bitrate: best.bitrate || 0 }
              }));
            }
          }
        }
      }
    } catch(e) { /* ignore */ }
  }

  // 也处理 Grid 形式的推文数据（带 tweets 字段的响应）
  function extractVideosFromResult(result) {
    if (!result) return;
    const media = result?.legacy?.extended_entities?.media || [];
    for (const m of media) {
      if (m.type === 'video' || m.type === 'animated_gif') {
        const variants = m?.video_info?.variants || [];
        let best = null;
        for (const v of variants) {
          if (v.content_type === 'video/mp4' && (!best || (v.bitrate || 0) > (best.bitrate || 0))) {
            best = v;
          }
        }
        if (best) {
          const tweetId = result.rest_id || result.id_str;
          const quality = best.url.match(/(\d+)x(\d+)/)?.[0] || 'unknown';
          videoCache[tweetId] = { url: best.url, quality, bitrate: best.bitrate || 0 };
          window.dispatchEvent(new CustomEvent('xdl-video-found', {
            detail: { tweetId, url: best.url, quality, bitrate: best.bitrate || 0 }
          }));
        }
      }
    }
  }

  // ---------- 拦截 fetch ----------
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await origFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

    if (url.includes('/i/api/graphql/')) {
      try {
        const clone = response.clone();
        const json = await clone.json();
        extractVideos(json);
        // 也尝试从别的结构中提取（比如 UserTweets 等）
        const instructions = json?.data?.user?.result?.timeline_v2?.timeline?.instructions || [];
        for (const inst of instructions) {
          if (inst.type === 'TimelineAddEntries') {
            for (const entry of (inst.entries || [])) {
              const items = entry?.content?.timelineModule?.items || [entry?.content?.itemContent];
              for (const item of items) {
                const res = item?.itemContent?.tweet_results?.result || item?.tweet_results?.result;
                extractVideosFromResult(res);
              }
            }
          }
        }
      } catch(e) { /* ignore parse errors */ }
    }

    return response;
  };

  // ---------- 拦截 XMLHttpRequest ----------
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    this._xUrl = url;
    return origOpen.apply(this, arguments);
  };

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(...args) {
    if (this._xUrl && this._xUrl.includes('/i/api/graphql/')) {
      const xhr = this;
      const origOnLoad = xhr.onload;
      xhr.onload = function() {
        try {
          const json = JSON.parse(xhr.responseText);
          extractVideos(json);
        } catch(e) {}
        if (origOnLoad) origOnLoad.apply(this, arguments);
      };
    }
    return origSend.apply(this, args);
  };

  console.log('[X视频下载器] 已注入，等待拦截视频数据...');
})();
