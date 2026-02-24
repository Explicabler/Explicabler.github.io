# CS Hub — GitHub Pages Setup

## How to deploy

1. Push this folder to a GitHub repo
2. Go to **Settings → Pages → Source** and set it to `main` branch, `/ (root)`
3. Your site will be live at `https://yourusername.github.io/your-repo-name`

---

## How to add games

Edit `projects.json`. Each game looks like this:

```json
{
  "id": 1,
  "title": "Game Name",
  "type": "arcade",
  "engine": "html",
  "icon": "🎮",
  "color": "accent",
  "desc": "Short description of the game.",
  "url": "https://example.com/game",
  "image": "https://example.com/thumbnail.jpg"
}
```

**Fields:**
- `id` — unique number, increment for each game
- `title` — display name
- `type` — one of: `sport`, `simulation`, `interactive`, `puzzle`, `platformer`, `arcade`, `action`, `rpg`
- `engine` — `html` or `unity`
- `icon` — emoji shown when no thumbnail
- `color` — fallback card colour: `accent`, `cyan`, `green`, `orange`, `pink`, `yellow`
- `desc` — short description
- `url` — the game URL (must allow iframes)
- `image` — thumbnail URL (optional, can be null)

---

## Good free game sources (allow iframes)

- **itch.io** games set to "Embed allowed"
- **Scratch** projects: `https://scratch.mit.edu/projects/PROJECT_ID/embed`
- **CrazyGames embed URLs**
- Any game hosted on your own GitHub Pages repo


## New tooling

- `scripts/auto-metadata.mjs`: generate IDs, slugs, and default image paths from local game folder names.

```bash
node scripts/auto-metadata.mjs . > generated-metadata.json
```

## Planning next improvements

See `FEATURE_SUGGESTIONS.md` for a curated backlog of product ideas for discovery, UX, curation, performance, and moderation.
