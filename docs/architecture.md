# Cross-domain Mixpanel PoC — architecture

## System overview

```mermaid
flowchart TB
  subgraph repo["Git repo"]
    alphaDir["alpha/"]
    bravoDir["bravo/"]
  end

  subgraph vercelA["Vercel project A"]
    alphaOrigin["https://alpha.example"]
    alphaPublic["public/ HTML + track.js"]
    alphaApi["api/config · api/track"]
  end

  subgraph vercelB["Vercel project B"]
    bravoOrigin["https://bravo.example"]
    bravoPublic["public/ HTML + track.js"]
    bravoApi["api/config · api/track"]
  end

  subgraph mixpanel["Mixpanel"]
    mpEvents["Events / Live View"]
  end

  alphaDir --> vercelA
  bravoDir --> vercelB

  alphaPublic --> alphaOrigin
  alphaApi --> alphaOrigin
  bravoPublic --> bravoOrigin
  bravoApi --> bravoOrigin

  alphaApi -->|"POST /api/track"| mpEvents
  bravoApi -->|"POST /api/track"| mpEvents

  alphaOrigin -.->|"OTHER_SITE_URL"| bravoOrigin
  bravoOrigin -.->|"OTHER_SITE_URL"| alphaOrigin
```

## Page flow (domain A → B → A)

```mermaid
flowchart LR
  subgraph domainA["Domain A — Alpha"]
    A1["index.html"]
    A2["page2.html"]
    A3["page3.html"]
    A1 --> A2 --> A3
  end

  subgraph domainB["Domain B — Bravo"]
    B2["page2.html\n(arrival)"]
  end

  A3 -->|"a.cross-domain\n+ ?distinct_id="| B2
  B2 -->|"Back to Alpha\n+ ?distinct_id="| A1
```

## Cross-domain stitch (link decoration)

```mermaid
sequenceDiagram
  participant User
  participant Alpha as Alpha origin
  participant TrackA as track.js
  participant ConfigA as GET /api/config
  participant Bravo as Bravo origin
  participant TrackB as track.js
  participant MP as Mixpanel API

  User->>Alpha: Browse pages (cookie A)
  TrackA->>ConfigA: MIXPANEL_TOKEN, OTHER_SITE_URL
  ConfigA-->>TrackA: otherSiteUrl = Bravo
  TrackA->>TrackA: decorate link href =<br/>Bravo/page2?distinct_id=ID

  User->>Alpha: Click "Go to Bravo"
  TrackA->>MP: Cross Domain Navigation<br/>(via POST /api/track)
  User->>Bravo: GET /page2.html?distinct_id=ID

  TrackB->>TrackB: mixpanel.identify(ID)
  Note over Bravo: Same user in Mixpanel,<br/>new cookie on domain B
  TrackB->>MP: Page Viewed<br/>arrived_from_other_domain: true
```

## Event pipeline (per page load)

```mermaid
flowchart LR
  subgraph browser["Browser"]
    HTML["HTML page"]
    TJ["track.js"]
    SDK["Mixpanel SDK\n(identify + cookie only)"]
  end

  subgraph server["Same-origin serverless"]
    CFG["/api/config"]
    TRK["/api/track"]
  end

  MP["api.mixpanel.com"]

  HTML --> TJ
  TJ --> CFG
  CFG --> TJ
  TJ --> TRK
  TRK --> MP
  TJ -.-> SDK

  TJ -->|"properties"| P["distinct_id<br/>current_url<br/>page, from, to, …"]
  P --> TRK
```

## What does *not* stitch users

```mermaid
flowchart TD
  start["User opens Bravo directly"] --> cold["No ?distinct_id in URL"]
  cold --> newId["Bravo assigns new anonymous id"]
  newId --> note["Different from Alpha unless<br/>they click decorated return link"]

  click["User clicks decorated link"] --> stitch["identify + shared distinct_id"]
```

## Visitor ID storage (per domain)

```mermaid
flowchart TD
  read["readVisitorId()"]
  ls["1. localStorage · visitor_id"]
  ck["2. cookie · visitor_id"]
  ss["3. sessionStorage · legacy only"]
  new["4. generate vid-…"]

  read --> ls
  ls -->|miss| ck
  ck -->|miss| ss
  ss -->|miss| new
  new --> persist["persistVisitorId()"]
  persist --> ls2["localStorage"]
  persist --> ck2["cookie · 1 year"]

  url["?distinct_id= from other TLD"] --> adopt["adoptVisitorId()"]
  adopt --> persist
```

**Per origin only.** `habuild.yoga`, `habuild.in`, and `habuild.com` each get their own localStorage + cookie. Cross-TLD stitch still needs URL handoff or a central server (below).

## Multi-TLD production (e.g. habuild.yoga / .in / .com)

| Approach | Reliability | Best for |
|----------|-------------|----------|
| **Link decoration + `?distinct_id=`** (this PoC) | Medium — click-only | Marketing links, email CTAs, known cross-domain paths |
| **localStorage + cookie per domain** | High on *one* TLD | Return visits on the same hostname |
| **Central visitor API** | High across TLDs | Same brand, multiple domains — **recommended production** |
| **Chrome extension bridge** | High for extension users only | Optional boost, not a primary strategy |

```mermaid
flowchart LR
  subgraph tlds["Different TLDs"]
    Y[habuild.yoga]
    I[habuild.in]
    C[habuild.com]
  end

  API["Central API<br/>GET /visitor · POST /sync"]
  DB[(Canonical visitor_id)]

  Y --> API
  I --> API
  C --> API
  API --> DB

  Y --> LSy[localStorage]
  I --> LSi[localStorage]
  C --> LSc[localStorage]
```

**Recommended stack for HaBuild:**

1. **Central server** — one canonical `visitor_id` (UUID), keyed by device signals + optional login.
2. **On each domain load** — read local `visitor_id`; if missing or stale, call central API; write to **localStorage + cookie**.
3. **Link decoration** — still decorate outbound links with `?distinct_id=` as a fast path (works without API round-trip).
4. **Mixpanel** — `identify(canonical_id)` on every domain after sync.
5. **Extension** — optional; sync localStorage across TLDs for power users, not required for analytics accuracy.

Cookies or localStorage **alone cannot share** across `.yoga`, `.in`, and `.com` (different site origins). Server-side canonical ID is the only reliable always-on solution; this PoC demonstrates the **client handoff** piece of that puzzle.

## Environment variables (mirrored)

| Project | `MIXPANEL_TOKEN` | `OTHER_SITE_URL` |
|---------|------------------|------------------|
| Alpha   | same token       | Bravo’s origin   |
| Bravo   | same token       | Alpha’s origin   |
