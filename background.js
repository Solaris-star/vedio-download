// Background Service Worker v4
// 使用 Guest Token + Bearer Token 调用 X GraphQL API（无痕模式，不需 Cookies）

const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// ---------- 获取 guest token ----------
async function getGuestToken() {
  const res = await fetch('https://api.twitter.com/1.1/guest/activate.json', {
    method: 'POST',
    headers: { 'authorization': `Bearer ${BEARER}` }
  });
  if (!res.ok) throw new Error(`Guest token failed: ${res.status}`);
  const data = await res.json();
  return data.guest_token;
}

// ---------- GraphQL 配置 ----------
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

// ---------- 提取视频变体 ----------
function extractVariants(data) {
  try {
    // X 的 GraphQL 响应结构：尝试多种路径
    const paths = [
      d => d?.data?.tweetResult?.result?.legacy?.extended_entities?.media,
      d => d?.data?.tweetResult?.result?.legacy?.entities?.media,
      d => d?.data?.threaded_conversation_with_injections?.instructions,
    ];

    let media = null;
    // 先试直接路径
    for (const p of paths.slice(0, 2)) {
      media = p(data);
      if (media) break;
    }

    // 如果前两条路径没找到，遍历 instructions 找 tweet
    if (!media) {
      const instructions = paths[2](data) || [];
      for (const inst of instructions) {
        const entries = inst?.entries || [];
        for (const entry of entries) {
          const item = entry?.content?.itemContent?.tweet_results?.result ||
                       entry?.content?.items?.[0]?.item?.itemContent?.tweet_results?.result;
          if (item) {
            const m = item?.legacy?.extended_entities?.media || item?.legacy?.entities?.media;
            if (m) { media = m; break; }
          }
        }
        if (media) break;
      }
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
    console.log('[XDL BG] extract error:', e.message);
  }
  return null;
}

// ---------- 缓存：guest token 有效期约 4h，每次请求前检查 ----------
let cachedGuestToken = null;
let guestTokenExpiry = 0;

async function ensureGuestToken() {
  if (cachedGuestToken && Date.now() < guestTokenExpiry) return cachedGuestToken;
  cachedGuestToken = await getGuestToken();
  guestTokenExpiry = Date.now() + 60 * 60 * 1000; // 1h 缓存
  return cachedGuestToken;
}

// ---------- 主入口：获取视频变体 ----------
async function fetchVideoVariants(tweetId) {
  let guestToken;
  try {
    guestToken = await ensureGuestToken();
  } catch (e) {
    return { error: '获取访问令牌失败: ' + e.message };
  }

  const headers = {
    'authorization': `Bearer ${BEARER}`,
    'x-guest-token': guestToken,
    'content-type': 'application/json',
    'origin': 'https://x.com',
    'referer': `https://x.com/i/status/${tweetId}`,
  };

  for (const q of QUERY_IDS) {
    try {
      const url = `https://x.com/i/api/graphql/${q.id}/${q.name}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          variables: makeVariables(tweetId),
          features: FEATURES,
        }),
      });

      if (!resp.ok) {
        console.log(`[XDL BG] Query ${q.id} returned ${resp.status}`);
        continue;
      }

      const data = await resp.json();
      const variants = extractVariants(data);
      if (variants && variants.length > 0) return { variants };
    } catch (e) {
      console.log(`[XDL BG] Query ${q.id} failed:`, e.message);
    }
  }

  return { error: '获取视频链接失败，GraphQL 接口未返回视频数据' };
}

// ---------- 消息处理 ----------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'xdl-get-variants') {
    fetchVideoVariants(request.tweetId).then(sendResponse);
    return true; // 保持通道开放，异步响应
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

console.log('[XDL BG] Service Worker v4 loaded');