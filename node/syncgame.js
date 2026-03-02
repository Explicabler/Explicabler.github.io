#!/usr/bin/env node
/**
 * sync-games.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Run from the ROOT of your repo:  node scripts/sync-games.js
 *
 * Requirements:
 *   1. Free SerpApi account → https://serpapi.com  (100 free searches/month)
 *      Paste your API key below in SERPAPI_KEY.
 *   2. Node 18+  (has fetch built-in)
 *      OR:  npm install node-fetch@2
 *
 * What it does:
 *  1. Scans all game folders (any folder with index.html)
 *  2. Scans game-images/ for already-saved thumbnails
 *  3. For every game still missing an image:
 *       → searches Google Images via SerpApi for "<game name> game thumbnail"
 *       → tries each result URL until one downloads successfully
 *       → saves it as game-images/<foldername>.jpg
 *  4. Syncs projects.json:
 *       • Adds new game folders
 *       • Removes missing game folders
 *       • Fixes wrong url fields
 *       • Sets/clears the image field
 *  5. Writes projects.json and prints a full summary
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── CONFIG ───────────────────────────────────────────────────────────────────

// Get a free key at https://serpapi.com (100 free searches/month)
const SERPAPI_KEY = '871a50533471d37cf87f9dceaf5124e987f69d72e7103c299a56d92f1a8bb1ad';

// Set true to re-download images even for games that already have one
const FORCE_REFETCH = false;

// How many Google Images results to try before giving up on a game
const MAX_IMAGE_ATTEMPTS = 5;

// Folders that are NOT games
const SKIP_FOLDERS = new Set([
  '.git', 'game-images', 'scripts', 'js', 'GBA',
  'node_modules', '.github',
]);

// ── DEFAULT METADATA for new entries ─────────────────────────────────────────
const DEFAULT_ENGINE = 'html';
const DEFAULT_TYPE   = 'arcade';

const TYPE_RULES = [
  [/(soccer|football|basketball|tennis|golf|cricket|sport|volley|ping|boxing)/i, 'sport'],
  [/(puzzle|blox|2048|wordle|trivia|riddle|quiz|candy|bubble)/i,                'puzzle'],
  [/(platform|runner|dash|jump|parkour|doodle|run|flood|fancy|ovo)/i,           'platformer'],
  [/(rpg|undertale|adventure|quest)/i,                                           'rpg'],
  [/(simulation|idle|tycoon|miner|airline|sandbox|world|mine|monkey|papa|pou)/i,'simulation'],
  [/(interactive|element)/i,                                                     'interactive'],
  [/(action|shooter|sniper|tank|trigger|battle|war|zombie|fight|iron|stick)/i,  'action'],
];

function guessType(title) {
  for (const [rx, type] of TYPE_RULES) {
    if (rx.test(title)) return type;
  }
  return DEFAULT_TYPE;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function formatTitle(folderName) {
  return folderName
    .replace(/([a-z])(\d)/gi, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function urlToFolder(url) {
  if (!url) return null;
  return url.replace(/^\//, '').split('/')[0] || null;
}

/** Fuzzy-match a folder name to an existing image file */
function findExistingImage(folderName, imageFiles) {
  const fs = slugify(folderName);
  for (const img of imageFiles) {
    const is = slugify(img.replace(/\.(jpg|jpeg|png|webp|gif)$/i, ''));
    if (is === fs) return img;
  }
  for (const img of imageFiles) {
    const is = slugify(img.replace(/\.(jpg|jpeg|png|webp|gif)$/i, ''));
    if (is.includes(fs) && fs.length >= 4) return img;
  }
  for (const img of imageFiles) {
    const is = slugify(img.replace(/\.(jpg|jpeg|png|webp|gif)$/i, ''));
    if (fs.includes(is) && is.length >= 4) return img;
  }
  return null;
}

/**
 * Search Google Images via SerpApi for a game thumbnail.
 * Returns an array of image URLs to try (best first).
 */
async function searchImageUrls(gameTitle) {
  const query = encodeURIComponent(`${gameTitle} game thumbnail`);
  const url   = `https://serpapi.com/search.json?engine=google_images&q=${query}&api_key=${SERPAPI_KEY}&num=10&safe=active`;

  try {
    const res  = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      console.error(`\n   SerpApi HTTP ${res.status}: ${await res.text()}`);
      return [];
    }
    const data = await res.json();

    if (data.error) {
      console.error(`\n   SerpApi error: ${data.error}`);
      return [];
    }

    // images_results contains { original, thumbnail, title, ... }
    return (data.images_results || [])
      .slice(0, MAX_IMAGE_ATTEMPTS)
      .map(r => r.original)
      .filter(Boolean);
  } catch (e) {
    console.error(`\n   Search failed: ${e.message}`);
    return [];
  }
}

/**
 * Try to download an image URL and save it to destPath.
 * Skips non-image content types. Returns true on success.
 */
async function downloadImage(imageUrl, destPath) {
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8000);
    const res        = await fetch(imageUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    clearTimeout(timeout);

    if (!res.ok) return false;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return false;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return false; // skip tiny/broken images

    require('fs').writeFileSync(destPath, buf);
    return true;
  } catch {
    return false;
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');

if (typeof fetch === 'undefined') {
  try { global.fetch = require('node-fetch'); }
  catch {
    console.error('\n❌ fetch not available. Use Node 18+ or:  npm install node-fetch@2\n');
    process.exit(1);
  }
}

if (SERPAPI_KEY === 'YOUR_SERPAPI_KEY_HERE') {
  console.error('\n❌ Please set your SERPAPI_KEY at the top of sync-games.js');
  console.error('   Get a free key at https://serpapi.com (100 searches/month free)\n');
  process.exit(1);
}

const ROOT          = path.resolve(__dirname, '..');
const PROJECTS_FILE = path.join(ROOT, 'projects.json');
const IMAGES_DIR    = path.join(ROOT, 'game-images');

;(async () => {

  // 1. Discover game folders
  const allEntries  = fs.readdirSync(ROOT, { withFileTypes: true });
  const gameFolders = allEntries
    .filter(e => e.isDirectory() && !SKIP_FOLDERS.has(e.name) && !e.name.startsWith('.'))
    .filter(e => fs.existsSync(path.join(ROOT, e.name, 'index.html')))
    .map(e => e.name);

  console.log(`\n📁 Found ${gameFolders.length} game folders\n`);

  // 2. Load existing images
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  const refreshImages = () =>
    fs.readdirSync(IMAGES_DIR).filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f));
  let imageFiles = refreshImages();
  console.log(`🖼️  ${imageFiles.length} images already in game-images/\n`);

  // 3. Load projects.json
  let projects = [];
  if (fs.existsSync(PROJECTS_FILE)) {
    try {
      projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
      console.log(`📋 Loaded ${projects.length} entries from projects.json\n`);
    } catch (e) {
      console.error('❌ Failed to parse projects.json:', e.message);
      process.exit(1);
    }
  }

  const byFolder = new Map();
  for (const p of projects) {
    const folder = urlToFolder(p.url);
    if (folder) byFolder.set(folder.toLowerCase(), { folder, project: p });
  }

  // 4. Search web for missing images
  const stats = {
    added: [], removed: [], imageSet: [], imageCleared: [],
    urlFixed: [], downloaded: [], downloadFailed: [],
  };

  const needsImage = gameFolders.filter(folder => {
    const destPath = path.join(IMAGES_DIR, `${folder}.jpg`);
    return (!findExistingImage(folder, imageFiles) && !fs.existsSync(destPath)) || FORCE_REFETCH;
  });

  if (needsImage.length === 0) {
    console.log('✅ All games already have images — skipping web search\n');
  } else {
    console.log(`🔍 Searching for images for ${needsImage.length} games...\n`);

    for (const folder of needsImage) {
      const title    = byFolder.get(folder.toLowerCase())?.project?.title || formatTitle(folder);
      const destPath = path.join(IMAGES_DIR, `${folder}.jpg`);

      process.stdout.write(`   "${title}" ... `);

      const imageUrls = await searchImageUrls(title);

      if (imageUrls.length === 0) {
        console.log('❌ no results from search');
        stats.downloadFailed.push(folder);
        continue;
      }

      let saved = false;
      for (const imgUrl of imageUrls) {
        const ok = await downloadImage(imgUrl, destPath);
        if (ok) {
          saved = true;
          break;
        }
      }

      if (saved) {
        console.log(`✅ saved as ${folder}.jpg`);
        stats.downloaded.push(folder);
        imageFiles = refreshImages();
      } else {
        console.log('❌ all download attempts failed');
        stats.downloadFailed.push(folder);
      }
    }
    console.log('');
  }

  // 5. Build updated projects list
  let maxId = projects.reduce((m, p) => Math.max(m, p.id || 0), 0);
  const updatedProjects = [];

  for (const folder of gameFolders) {
    const key        = folder.toLowerCase();
    const imgFile    = findExistingImage(folder, imageFiles);
    const imgPath    = imgFile ? `/game-images/${imgFile}` : null;
    const correctUrl = `/${folder}/index.html`;

    if (byFolder.has(key)) {
      const p = byFolder.get(key).project;

      if (p.url !== correctUrl) {
        console.log(`🔧 Fix URL  [${p.title}]: "${p.url}" → "${correctUrl}"`);
        p.url = correctUrl;
        stats.urlFixed.push(p.title);
      }

      if (imgPath && p.image !== imgPath) {
        console.log(`🖼️  Set image [${p.title}]: ${imgPath}`);
        p.image = imgPath;
        stats.imageSet.push(p.title);
      } else if (!imgPath && p.image) {
        console.log(`🗑️  Clear image [${p.title}]: file no longer exists`);
        delete p.image;
        stats.imageCleared.push(p.title);
      }

      updatedProjects.push(p);
      byFolder.delete(key);

    } else {
      maxId++;
      const title = formatTitle(folder);
      const entry = {
        id:     maxId,
        title,
        type:   guessType(title),
        engine: DEFAULT_ENGINE,
        icon:   '🎮',
        color:  'accent',
        desc:   '',
        url:    correctUrl,
      };
      if (imgPath) entry.image = imgPath;

      console.log(`➕ Add [${title}] → ${correctUrl}${imgPath ? ` + ${imgPath}` : ''}`);
      stats.added.push(title);
      updatedProjects.push(entry);
    }
  }

  for (const [, { folder, project }] of byFolder) {
    console.log(`➖ Remove [${project.title}] — folder "${folder}" gone`);
    stats.removed.push(project.title);
  }

  // 6. Write projects.json
  updatedProjects.sort((a, b) => a.id - b.id);
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(updatedProjects, null, 2), 'utf8');
  console.log('\n📝 projects.json saved\n');

  // 7. Summary
  const W = 64;
  console.log('─'.repeat(W));
  console.log('✅ ALL DONE\n');
  console.log(`   Games in repo         : ${gameFolders.length}`);
  console.log(`   Total entries         : ${updatedProjects.length}`);
  console.log(`   ➕ Added              : ${stats.added.length}${stats.added.length ? '\n      ' + stats.added.join('\n      ') : ''}`);
  console.log(`   ➖ Removed            : ${stats.removed.length}${stats.removed.length ? ' — ' + stats.removed.join(', ') : ''}`);
  console.log(`   🔧 URLs fixed         : ${stats.urlFixed.length}${stats.urlFixed.length ? ' — ' + stats.urlFixed.join(', ') : ''}`);
  console.log(`   🖼️  Images set/updated : ${stats.imageSet.length}`);
  console.log(`   🗑️  Images cleared     : ${stats.imageCleared.length}`);
  console.log(`   🔍 Images downloaded  : ${stats.downloaded.length}`);
  if (stats.downloadFailed.length) {
    console.log(`   ❌ Download failed    : ${stats.downloadFailed.length}`);
    console.log(`      ${stats.downloadFailed.join(', ')}`);
    console.log(`      (re-run the script to retry these)`);
  }
  console.log('─'.repeat(W) + '\n');

})();