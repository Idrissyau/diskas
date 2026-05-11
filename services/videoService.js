/**
 * videoService.js — Modular, storage-saving video lesson service for Diskas
 *
 * Philosophy: NO video files are stored on this server.
 *             Only metadata, embed URLs, thumbnails, and IDs are stored in DB.
 *
 * Supported providers: YouTube · Vimeo · Bunny Stream · Cloudflare Stream
 *                      Loom · Wistia · Dailymotion · Custom Embed · External URL
 *
 * To add Bunny direct upload: set BUNNY_STORAGE_ZONE + BUNNY_API_KEY in .env
 * To add Cloudflare direct upload: set CF_ACCOUNT_ID + CF_STREAM_TOKEN in .env
 */

'use strict';

const { queryOne, insert } = require('../helpers/db');

/* ── Constants ──────────────────────────────────────────────────────────── */

/** Extensions that are ALWAYS blocked from direct upload */
const VIDEO_EXTENSIONS = [
  'mp4','mov','avi','mkv','webm','wmv','flv','m4v','3gp',
  'ogv','ts','mts','m2ts','vob','rmvb','asf','divx','f4v',
];

/** File size limits in bytes */
const FILE_SIZE_LIMITS = {
  image:    2  * 1024 * 1024,  // 2 MB
  pdf:      10 * 1024 * 1024,  // 10 MB
  document: 10 * 1024 * 1024,  // 10 MB
  zip:      25 * 1024 * 1024,  // 25 MB
};

/** Trusted iframe source domains — only these may appear in embed codes */
const TRUSTED_EMBED_DOMAINS = [
  'youtube.com', 'youtube-nocookie.com',
  'vimeo.com', 'player.vimeo.com',
  'iframe.mediadelivery.net', 'b-cdn.net',       // Bunny Stream
  'cloudflarestream.com', 'videodelivery.net',   // Cloudflare Stream
  'watch.cloudflarestream.com',
  'loom.com', 'share.loom.com',
  'wistia.com', 'fast.wistia.net',
  'dailymotion.com', 'geo.dailymotion.com',
  'rumble.com',
];

/** Human-readable provider labels */
const PROVIDER_LABELS = {
  youtube:    'YouTube',
  vimeo:      'Vimeo',
  bunny:      'Bunny Stream',
  cloudflare: 'Cloudflare Stream',
  loom:       'Loom',
  wistia:     'Wistia',
  dailymotion:'Dailymotion',
  rumble:     'Rumble',
  embed:      'Custom Embed',
  external:   'External URL',
};

/** Provider icon classes (Font Awesome) */
const PROVIDER_ICONS = {
  youtube:    'fa-brands fa-youtube',
  vimeo:      'fa-brands fa-vimeo-v',
  bunny:      'fa-solid fa-rabbit',
  cloudflare: 'fa-solid fa-cloud',
  loom:       'fa-solid fa-video',
  wistia:     'fa-solid fa-play-circle',
  dailymotion:'fa-solid fa-film',
  rumble:     'fa-solid fa-r',
  embed:      'fa-solid fa-code',
  external:   'fa-solid fa-link',
};

/* ── Provider Detection ─────────────────────────────────────────────────── */

/**
 * Detect video provider from a URL or embed code string.
 * @param {string} input
 * @returns {string|null} provider key or null
 */
function detectVideoProvider(input) {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim();

  if (/youtube\.com|youtu\.be/.test(s))                         return 'youtube';
  if (/vimeo\.com/.test(s))                                     return 'vimeo';
  if (/iframe\.mediadelivery\.net|bunnycdn|bunny\.net/.test(s)) return 'bunny';
  if (/cloudflarestream\.com|videodelivery\.net/.test(s))       return 'cloudflare';
  if (/loom\.com/.test(s))                                      return 'loom';
  if (/wistia\.com|fast\.wistia/.test(s))                       return 'wistia';
  if (/dailymotion\.com/.test(s))                               return 'dailymotion';
  if (/rumble\.com\/embed/.test(s))                             return 'rumble';
  if (s.includes('<iframe'))                                     return 'embed';
  if (/^https?:\/\//.test(s))                                   return 'external';

  return null;
}

/* ── Video ID Extraction ────────────────────────────────────────────────── */

/**
 * Extract video ID from a URL.
 * @param {string} url
 * @param {string} provider
 * @returns {string|null}
 */
function extractVideoId(url, provider) {
  if (!url || !provider) return null;
  try {
    switch (provider) {
      case 'youtube': {
        const patterns = [
          /[?&]v=([^&#/]+)/,
          /youtu\.be\/([^?&#/]+)/,
          /\/embed\/([^?&#/?]+)/,
          /\/shorts\/([^?&#/]+)/,
          /\/v\/([^?&#/]+)/,
        ];
        for (const p of patterns) {
          const m = url.match(p); if (m) return m[1];
        }
        return null;
      }
      case 'vimeo': {
        const m = url.match(/vimeo\.com\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/)?(\d+)/);
        return m ? m[1] : null;
      }
      case 'bunny': {
        // https://iframe.mediadelivery.net/embed/LIB_ID/VIDEO_GUID
        const m = url.match(/\/embed\/(\d+)\/([a-zA-Z0-9-]+)/);
        return m ? `${m[1]}/${m[2]}` : null;
      }
      case 'cloudflare': {
        const m = url.match(/(?:embed\/|watch\.cloudflarestream\.com\/|videodelivery\.net\/embed\/)([a-f0-9]+)/);
        return m ? m[1] : null;
      }
      case 'loom': {
        const m = url.match(/loom\.com\/(?:share|v|embed)\/([a-zA-Z0-9]+)/);
        return m ? m[1] : null;
      }
      case 'wistia': {
        const m = url.match(/wistia\.(?:com|net)\/(?:medias|embed\/iframe)\/([a-zA-Z0-9]+)/);
        return m ? m[1] : null;
      }
      case 'dailymotion': {
        const m = url.match(/dailymotion\.com\/(?:video|embed\/video)\/([a-zA-Z0-9]+)/);
        return m ? m[1] : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/* ── Embed URL Generation ───────────────────────────────────────────────── */

/**
 * Generate a clean, embeddable iframe src URL.
 * @param {string} url - original URL pasted by user
 * @param {string} provider
 * @param {string|null} videoId
 * @param {{ autoplay?: boolean }} options
 * @returns {string|null}
 */
function generateEmbedUrl(url, provider, videoId, options = {}) {
  const { autoplay = false } = options;
  const ap = autoplay ? 1 : 0;

  switch (provider) {
    case 'youtube':
      if (!videoId) return null;
      return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=${ap}&rel=0&modestbranding=1`;

    case 'vimeo':
      if (!videoId) return null;
      return `https://player.vimeo.com/video/${videoId}?autoplay=${ap}&title=0&byline=0&portrait=0`;

    case 'bunny': {
      const m = url.match(/\/embed\/(\d+)\/([a-zA-Z0-9-]+)/);
      if (m) return `https://iframe.mediadelivery.net/embed/${m[1]}/${m[2]}?autoplay=${autoplay}&preload=true`;
      return url;
    }

    case 'cloudflare':
      if (!videoId) return null;
      return `https://cloudflarestream.com/embed/${videoId}?autoplay=${autoplay}`;

    case 'loom': {
      if (!videoId) return null;
      return `https://www.loom.com/embed/${videoId}?autoplay=${autoplay}`;
    }

    case 'wistia': {
      if (!videoId) return null;
      return `https://fast.wistia.net/embed/iframe/${videoId}`;
    }

    case 'dailymotion': {
      if (!videoId) return null;
      return `https://geo.dailymotion.com/player.html?video=${videoId}&autoplay=${autoplay}`;
    }

    case 'external':
    case 'embed':
      return null; // handled via video tag or raw embed code

    default:
      return null;
  }
}

/* ── Thumbnail ──────────────────────────────────────────────────────────── */

/**
 * Get an auto-generated thumbnail URL (YouTube only without API key).
 * @param {string} provider
 * @param {string|null} videoId
 * @returns {string|null}
 */
function getThumbnailUrl(provider, videoId) {
  if (provider === 'youtube' && videoId) {
    return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  }
  return null;
}

/* ── Embed Code Sanitization ────────────────────────────────────────────── */

/**
 * Sanitize a custom <iframe> embed code.
 * Extracts the src, validates it against TRUSTED_EMBED_DOMAINS, and returns
 * a clean, minimal iframe tag — or null if the source is not trusted.
 * @param {string} embedCode
 * @returns {string|null}
 */
function sanitizeEmbedCode(embedCode) {
  if (!embedCode || typeof embedCode !== 'string') return null;
  const srcMatch = embedCode.match(/src\s*=\s*["']([^"']+)["']/i);
  if (!srcMatch) return null;

  let src = srcMatch[1].trim();
  if (src.startsWith('//')) src = 'https:' + src;

  try {
    const url   = new URL(src);
    const host  = url.hostname.replace(/^www\./, '');
    const ok    = TRUSTED_EMBED_DOMAINS.some(d => host === d || host.endsWith('.' + d));
    if (!ok) return null;
  } catch { return null; }

  return `<iframe src="${src}" frameborder="0" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture" style="width:100%;height:100%;border:none"></iframe>`;
}

/* ── Full Processing Pipeline ───────────────────────────────────────────── */

/**
 * Take raw creator inputs and return a DB-ready video metadata object.
 * @param {string|null} videoUrl      - URL pasted by creator
 * @param {string|null} embedCode     - custom <iframe> embed code
 * @param {string|null} customThumb   - creator-provided thumbnail URL
 * @param {boolean}     autoplay
 * @returns {object|null}
 */
function processVideoInput(videoUrl, embedCode, customThumb, autoplay = false) {
  const hasEmbed = embedCode && embedCode.trim();
  const rawInput = hasEmbed ? embedCode.trim() : (videoUrl ? videoUrl.trim() : null);
  if (!rawInput) return null;

  const provider  = detectVideoProvider(rawInput);
  const urlForId  = hasEmbed ? (videoUrl ? videoUrl.trim() : null) : rawInput;
  const videoId   = extractVideoId(urlForId || rawInput, provider);
  const embedUrl  = (provider && provider !== 'embed' && provider !== 'external')
    ? generateEmbedUrl(urlForId || rawInput, provider, videoId, { autoplay })
    : null;
  const safeEmbed = (provider === 'embed') ? sanitizeEmbedCode(embedCode) : null;
  const thumb     = customThumb || getThumbnailUrl(provider, videoId);

  let storageType = 'external_embed';
  if (provider === 'external')                            storageType = 'external_url';
  else if (provider === 'bunny' || provider === 'cloudflare') storageType = 'cloud_stream';
  else if (provider === 'embed')                          storageType = 'external_embed';
  else if (!provider)                                     storageType = 'text_only';

  return {
    video_provider:      provider       || null,
    video_id:            videoId        || null,
    video_url:           videoUrl       ? videoUrl.trim()  : null,
    video_embed_url:     embedUrl       || null,
    video_embed_code:    safeEmbed      || null,
    video_thumbnail_url: thumb          || null,
    storage_type:        storageType,
  };
}

/* ── File Upload Validation ─────────────────────────────────────────────── */

/**
 * Validate an express-fileupload file object.
 * Blocks video files; enforces size limits by type.
 * @param {object} file
 * @returns {{ valid: boolean, error?: string }}
 */
function validateFileUpload(file) {
  if (!file) return { valid: true };

  const ext  = (file.name || '').split('.').pop().toLowerCase();
  const size = file.size || 0;

  if (VIDEO_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      error: 'Direct video uploads are disabled to save server storage. '
           + 'Please use YouTube, Vimeo, Bunny Stream, Cloudflare Stream, or another '
           + 'external video host and paste the link into the Video URL field.',
    };
  }

  if (['jpg','jpeg','png','webp','gif'].includes(ext)) {
    if (size > FILE_SIZE_LIMITS.image)
      return { valid: false, error: `Image files must be under 2 MB. Your file is ${(size/1024/1024).toFixed(1)} MB.` };
  } else if (ext === 'pdf') {
    if (size > FILE_SIZE_LIMITS.pdf)
      return { valid: false, error: `PDF files must be under 10 MB. Your file is ${(size/1024/1024).toFixed(1)} MB.` };
  } else if (['doc','docx','xls','xlsx','ppt','pptx'].includes(ext)) {
    if (size > FILE_SIZE_LIMITS.document)
      return { valid: false, error: `Document files must be under 10 MB. Your file is ${(size/1024/1024).toFixed(1)} MB.` };
  } else if (ext === 'zip') {
    if (size > FILE_SIZE_LIMITS.zip)
      return { valid: false, error: `ZIP files must be under 25 MB. Your file is ${(size/1024/1024).toFixed(1)} MB.` };
  }

  return { valid: true };
}

/* ── Access Control ─────────────────────────────────────────────────────── */

/**
 * Check whether a user may access a lesson.
 * This is the authoritative server-side gate — do NOT rely only on frontend.
 *
 * @param {object}       lesson        - DB row with is_free_preview, required_plan_id
 * @param {number|null}  userId
 * @param {number}       communityId
 * @param {boolean}      isOwner
 * @returns {Promise<{ hasAccess: boolean, reason: string }>}
 */
async function checkLessonAccess(lesson, userId, communityId, isOwner) {
  // Community owners and admins bypass all restrictions
  if (isOwner) return { hasAccess: true, reason: 'owner' };

  // Free preview lessons are accessible to anyone who can reach the course page
  if (lesson.is_free_preview) return { hasAccess: true, reason: 'free_preview' };

  // Must be logged in
  if (!userId) return { hasAccess: false, reason: 'not_logged_in' };

  // Must be a community member
  const membership = await queryOne(
    'SELECT id FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, userId]
  );
  if (!membership) return { hasAccess: false, reason: 'not_member' };

  // If a specific plan is required, check active subscription
  if (lesson.required_plan_id) {
    const sub = await queryOne(
      `SELECT id FROM member_subscriptions
       WHERE user_id = ? AND community_id = ? AND plan_id = ?
         AND status IN ('active','trialing')
         AND (current_period_ends_at IS NULL OR current_period_ends_at > NOW())`,
      [userId, communityId, lesson.required_plan_id]
    );
    if (!sub) return { hasAccess: false, reason: 'wrong_plan' };
  }

  return { hasAccess: true, reason: 'member' };
}

/**
 * Mark a lesson complete for a user (idempotent).
 */
async function markLessonComplete(userId, lessonId) {
  const existing = await queryOne(
    'SELECT id FROM lesson_completions WHERE user_id = ? AND lesson_id = ?',
    [userId, lessonId]
  );
  if (!existing) {
    await insert('lesson_completions', { user_id: userId, lesson_id: lessonId });
  }
  return true;
}

/* ── Future Cloud Upload Stubs ──────────────────────────────────────────── */

/**
 * Prepare metadata/credentials for a future direct cloud upload.
 * Implement by setting env vars and wiring the provider SDK.
 * @param {string} provider - 'bunny' | 'cloudflare'
 * @param {object} options
 * @returns {object}
 */
function prepareCloudUpload(provider, options = {}) {
  const configs = {
    bunny: {
      provider: 'bunny',
      uploadUrl: process.env.BUNNY_STORAGE_ZONE
        ? `https://storage.bunnycdn.com/${process.env.BUNNY_STORAGE_ZONE}/`
        : null,
      authHeader: process.env.BUNNY_API_KEY || null,
      method: 'PUT',
      status: process.env.BUNNY_API_KEY ? 'ready' : 'not_configured',
      envVarsNeeded: ['BUNNY_STORAGE_ZONE', 'BUNNY_API_KEY', 'BUNNY_LIBRARY_ID'],
      message: process.env.BUNNY_API_KEY
        ? 'Bunny Stream is configured. Implement upload in this method.'
        : 'Set BUNNY_STORAGE_ZONE and BUNNY_API_KEY in .env to enable direct Bunny uploads.',
    },
    cloudflare: {
      provider: 'cloudflare',
      uploadUrl: process.env.CF_ACCOUNT_ID
        ? `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/stream`
        : null,
      authHeader: process.env.CF_STREAM_TOKEN || null,
      status: process.env.CF_STREAM_TOKEN ? 'ready' : 'not_configured',
      envVarsNeeded: ['CF_ACCOUNT_ID', 'CF_STREAM_TOKEN'],
      message: process.env.CF_STREAM_TOKEN
        ? 'Cloudflare Stream is configured. Implement upload in this method.'
        : 'Set CF_ACCOUNT_ID and CF_STREAM_TOKEN in .env to enable direct Cloudflare uploads.',
    },
  };
  return configs[provider] || { status: 'unsupported', provider };
}

/**
 * Handle webhook callbacks from cloud providers (future use).
 * Wire this to a POST route when implementing direct uploads.
 */
function handleCloudUploadWebhook(provider, payload) {
  // Future: update lesson row with final video ID/URL after cloud processing
  return { processed: false, provider, message: 'Webhook handling not yet implemented.' };
}

/* ── Exports ────────────────────────────────────────────────────────────── */

module.exports = {
  // Core pipeline
  detectVideoProvider,
  extractVideoId,
  generateEmbedUrl,
  getThumbnailUrl,
  processVideoInput,
  sanitizeEmbedCode,
  // Validation
  validateFileUpload,
  // Access control
  checkLessonAccess,
  markLessonComplete,
  // Cloud upload (stubs)
  prepareCloudUpload,
  handleCloudUploadWebhook,
  // Constants
  VIDEO_EXTENSIONS,
  FILE_SIZE_LIMITS,
  TRUSTED_EMBED_DOMAINS,
  PROVIDER_LABELS,
  PROVIDER_ICONS,
};
