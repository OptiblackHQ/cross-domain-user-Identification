# Cross-domain Mixpanel tracking (link decoration PoC)

Two minimal static sites on **separate origins** (separate Vercel projects), each with its own Mixpanel cookie. Users are stitched across domains by passing `distinct_id` in the URL and calling `mixpanel.identify()` on arrival.

```
alpha (domain A)                    bravo (domain B)
index → page2 → page3  ──link──►   page2 (arrival)
       ▲                            │
       └──────── return link ───────┘
```

**Important:** Stitching only happens when someone **clicks** a decorated cross-domain link. Typing the Bravo URL directly will not carry Alpha’s id — but returning to Alpha via the decorated link will stitch again.

## Repo layout

| Path | Role |
|------|------|
| `alpha/` | Domain A — `index.html` → `page2.html` → `page3.html` (handoff to Bravo) |
| `bravo/` | Domain B — `page2.html` arrival + return link to Alpha |
| `*/api/config.js` | Serverless endpoint: `{ token, otherSiteUrl }` from env |
| `*/public/track.js` | Shared tracking logic (identical in both projects) |

## Deploy (two Vercel projects)

1. Push this repo to GitHub (or connect locally with `vercel` CLI).

2. **Project 1 — Alpha**
   - Import the repo in [Vercel](https://vercel.com/new).
   - Set **Root Directory** to `alpha`.
   - Environment variables:
     - `MIXPANEL_TOKEN` — your Mixpanel project token ([Project Settings → Access Keys](https://mixpanel.com/settings/project)).
     - `OTHER_SITE_URL` — full origin of Bravo, e.g. `https://your-bravo.vercel.app` (no trailing slash).
   - Deploy.

3. **Project 2 — Bravo**
   - Create a **second** Vercel project from the **same** repo.
   - Set **Root Directory** to `bravo`.
   - Environment variables:
     - `MIXPANEL_TOKEN` — **same** token as Alpha.
     - `OTHER_SITE_URL` — full origin of Alpha, e.g. `https://your-alpha.vercel.app`.
   - Deploy.

4. Update `OTHER_SITE_URL` on each project if preview URLs change, or use production domains.

**Bravo 404 on Vercel?** Check:

- Vercel project **Root Directory** is `bravo` (not repo root, not `alpha`).
- Open **`https://your-bravo.vercel.app/page2.html`** (arrival page), not only the bare domain before redeploy.
- After pulling latest code, redeploy Bravo (adds `index.html` + `/` → `page2.html` rewrite).

### Local dev

Use the built-in Node dev server (no Vercel CLI or npm install required).

1. Add a `.env` file in **each** app folder (`alpha/.env`, `bravo/.env`):

   **alpha/.env**
   ```
   MIXPANEL_TOKEN=your_token
   OTHER_SITE_URL=http://localhost:3001
   ```

   **bravo/.env**
   ```
   MIXPANEL_TOKEN=your_token
   OTHER_SITE_URL=http://localhost:3000
   ```

2. Open **two terminals** (run each command from the matching app folder, or from repo root):

   **Terminal 1 — Alpha (port 3000)**
   ```bash
   cd alpha
   npm run dev
   ```
   Or from repo root: `npm run dev:alpha`

   **Terminal 2 — Bravo (port 3001)**
   ```bash
   cd bravo
   npm run dev
   ```
   Or from repo root: `npm run dev:bravo`

   If you use `node scripts/dev-server.mjs`, run it from the **repo root** (`cross/`), not from `alpha/` or `bravo/`.

3. Open http://localhost:3000 (Alpha) and http://localhost:3001/page2.html (Bravo).

#### Optional: Vercel CLI

If `npx vercel dev` fails with `ECONNRESET`, that is an npm/network issue while downloading the CLI — use the Node dev server above instead. When your network is stable, you can run `vercel dev` from each folder with the same `.env` values.

## How it works

1. `track.js` loads config from `/api/config` (token never in HTML).
2. `mixpanel.init(token, { track_pageview: false, persistence: 'cookie' })`.
3. If `?distinct_id=` is in the URL → `mixpanel.identify(id)` so Bravo adopts Alpha’s user (or vice versa on return).
4. Every `a.cross-domain` gets `href = otherSiteUrl + '/page2.html?distinct_id=' + …` (or `data-target-path` for return links).
5. Events (sent via **`POST /api/track`** on your origin, then forwarded server-side to Mixpanel — avoids ad-blockers breaking `mixpanel.track()` in the browser):
   - **Page Viewed** — every load; `arrived_from_other_domain: true` when `distinct_id` was in the query string.
   - **Internal Link Clicked** — same-origin navigation (`a.internal`).
   - **Cross Domain Navigation** — click on `a.cross-domain`; includes `distinct_id_passed`.
   - All events include **`current_url`** (full page URL at send time) and **`distinct_id`**.
6. The Mixpanel JS SDK is still loaded for **`identify()`** and cookie persistence only.

## Verification checklist

- [ ] **Alpha, same session:** Open Alpha home → page 2 → page 3. The on-screen `distinct_id` stays **constant** (same cookie on one origin).
- [ ] **Alpha → Bravo:** From page 3, click “Go to Bravo”. On Bravo’s page 2, `distinct_id` **matches** Alpha’s (URL had `?distinct_id=`, then `identify()`).
- [ ] **Bravo cold start:** Open Bravo `/page2.html` **directly** (no query param). `distinct_id` should be **different** from Alpha’s anonymous id.
- [ ] **Bravo → Alpha return:** From Bravo, click “Back to Alpha”. On Alpha home, `distinct_id` **matches** again after the return handoff.
- [ ] **Mixpanel Live View:** See **Page Viewed**, **Internal Link Clicked**, and **Cross Domain Navigation** with expected properties.

## Limits (by design)

- No stitching for direct navigation or bookmarks without `distinct_id`.
- Link decoration must run on every page that emits cross-domain links (`track.js` updates `a.cross-domain` after init).
- Both sites must share the **same** `MIXPANEL_TOKEN` so identified users land in one Mixpanel project.
