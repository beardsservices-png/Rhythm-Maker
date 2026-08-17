# Rhythm Shop

Two rhythm-building modes, playable solo or as a turn-based pass-and-play:

- **Freeplay** — pick an instrument (family + tone variant, e.g. Kick → Punchy), toggle any of 32 steps by hand or hit Randomize, loop it.
- **Round Robin** — turn-based: each layer you add halves in step-density (32nd → 16th → 8th → quarter → half → whole), so friends can stack instruments on top of each other. Includes a "Generate Section B" variation and an A·A·B·A song-form auto-arrangement.

Both modes share an **"Ask Claude" assist panel** — it explains things and nudges density/swing/tempo on request, it never generates a full beat for you.

## Structure

```
public/
  index.html, freeplay.html, roundrobin.html
  css/   base.css (shared design tokens) + per-mode styles
  js/
    audio-engine.js   — instrument catalog (10 families × 2–3 tone variants),
                         layered synthesis + shared reverb bus, lookahead scheduler
    storage-client.js — save/load patterns via server API (falls back to localStorage)
    assist-client.js  — talks to /api/assist
    assist-panel.js   — shared "Ask Claude" UI, mounted on both mode pages
    freeplay.js, roundrobin.js
server.js     — zero-dependency Node static server + two JSON APIs
railway.json, package.json
```

## Stack & storage choices

**Backend: Node, no framework, no dependencies.** The job is "serve some static files
plus a tiny CRUD API," and Node's built-in `http` module does exactly that. Because the
frontend is already plain HTML/CSS/JS served as static files, keeping the server in the
same language means the whole thing deploys as a single `node server.js` with an empty
dependency tree — nothing to `npm install`, nothing to pin, nothing to break on redeploy.
(Python/Flask would have been just as reasonable and matches the BHS app, but it would add
a dependency and a WSGI server for no real gain here.)

**Storage: one JSON file per mode on the volume**, at `$DATA_DIR/freeplay.json` and
`$DATA_DIR/roundrobin.json`. This is a single-user tool saving a handful of named
patterns, so a full SQLite schema would be overkill — the entire dataset is a small
name→pattern map that reads and writes atomically as JSON, stays human-readable if Brian
ever wants to peek at or hand-edit it, and needs zero migration story. The volume is what
makes it durable; the file format inside it is deliberately the simplest thing that works.

## Running locally

```
node server.js
```
Serves on `http://localhost:8080` (or `$PORT`). No `npm install` needed — no dependencies.

## Deploying on Railway

1. Push this to the `Rhythm-Maker` repo.
2. In Railway: New Project → Deploy from GitHub repo.
3. Attach a volume and set `DATA_DIR` to its mount path (e.g. `/data`) so saved patterns persist across deploys — without it, patterns still save to a local `./data` folder that resets on redeploy.
4. Set `ANTHROPIC_API_KEY` as an environment variable to turn on the "Ask Claude" assist panel. Without it, the app works fine — Play, Randomize, save/load, both modes — the assist panel just returns a friendly "not configured" message instead of a reply.
5. Optional: `ANTHROPIC_MODEL` env var to override the default (`claude-sonnet-5`).

`railway.json` already declares the builder (Nixpacks), the start command, and the
`/health` health check, so Railway wires those up automatically — the only manual step is
attaching the volume and setting `DATA_DIR` (step 3), which Railway can't declare in-repo.

### Verifying the volume actually persists

After the first deploy: open the app, save a pattern in each mode, then trigger a redeploy
(push a commit, or Railway → Deployments → Redeploy). Reload the app — the saved patterns
should still be listed. If they vanish, `DATA_DIR` isn't pointing at the mounted volume:
check that the volume's mount path and the `DATA_DIR` variable match exactly (e.g. both
`/data`).

## API surface

`:mode` is `freeplay` or `roundrobin`. Freeplay patterns store `{ pattern, voiceId, bpm }`;
Round Robin patterns store the full layer set plus tempo `{ bpm, songForm, layers[], sectionB }`.

- `GET  /health` → `{ status: "ok", dataDir }` — Railway health check (also `/healthz`)
- `GET  /api/patterns/:mode` → `{ names: [...] }`
- `GET  /api/patterns/:mode/:name` → `{ name, data }`
- `POST /api/patterns/:mode/:name` with `{ data }` → save
- `DELETE /api/patterns/:mode/:name` → delete
- `POST /api/assist` with `{ instruction, context }` → `{ explanation, actions }`
