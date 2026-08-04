# Google SEO Execution Plan for XYZ / arphen.xyz

Status: Phase 1 complete; Phase 2 queued
Baseline date: 2026-08-04  
Primary market: English-language Google Search  
Product: XYZ, a free local-first RSVP and adaptive speed-reading application  
Canonical origin: `https://arphen.xyz`

## Current Status

### Completed on 2026-08-04

- [x] Tickets 1-5: route manifest, deterministic public-route prerendering, status and indexing policy, metadata and structured-data audit, and existing-content discoverability.
- [x] Production deployment through GitHub Actions and Cloudflare Pages at commit `602134a`.
- [x] Production smoke checks: public routes return `200`, unknown routes return `404`, private routes return `X-Robots-Tag: noindex, nofollow`, and `www` redirects to the apex host.
- [x] Discovery assets verified in production: `robots.txt`, `sitemap.xml`, Open Graph image, and PWA icons.
- [x] CI regression coverage includes lint, 593 tests, TypeScript/build validation, Playwright browser installation, prerender validation, and deployment.

### Pending external action

- [ ] Sign in to the verified Search Console property and submit `https://arphen.xyz/sitemap.xml`.
- [ ] Use URL Inspection and request indexing for `/`, `/manifesto`, `/research`, and `/manual` once the Search Console session is authenticated.
- [ ] Export the preceding 90-day Search Console baseline outside the repository.

### Next implementation sequence

1. Complete the Search Console release procedure above and record the submission date.
2. Create `/rsvp-reader` as the first new search-intent page, with a real bounded RSVP demonstration and no unsupported speed or comprehension claims.
3. Run the Section 8 quality gate, add the route to the manifest and sitemap, deploy through CI, and inspect its raw HTML before starting another page.
4. Use Search Console query data to choose the next page: `/epub-speed-reader`, `/pdf-speed-reader`, `/privacy`, or `/how-it-works`.
5. Review indexing and query data at 3, 14, and 28 days; do not multiply pages before the first new page has evidence of value.

## 1. Purpose

Increase qualified, non-branded Google visibility dramatically without turning the product into a generic SaaS landing page, an SEO content farm, or a visually cheap collection of cards and listicles.

The strategy is:

1. Make the existing public pages fully understandable before JavaScript runs.
2. Build a small, authoritative search-intent cluster around RSVP reading, private browser-based reading, EPUB/PDF speed reading, and adaptive pacing.
3. Demonstrate the product with real interfaces, measurements, and technical explanations instead of marketing filler.
4. Earn links through the open-source product, original research, and useful interactive tools.
5. Measure results in Google Search Console without adding invasive analytics that contradict the product's privacy claim.

This document is written for an implementation agent. Follow it in order. Do not start by producing large volumes of copy.

## 2. Non-Negotiable Product and Design Rules

These rules override any generic SEO recommendation.

### Product integrity

- Keep the application usable as the primary experience. Do not replace `/` with a conventional marketing homepage.
- Preserve the claims "no login," "local-first," and "no tracking" only when they remain technically true. fully free as in freedom,
- Do not add GA4, Meta Pixel, session replay, marketing cookies, newsletter popups, chat widgets, or third-party lead forms.
- Do not add an email gate before the reader, upload flow, demo, manual, or research.
- Do not make private/user-state routes indexable: `/reader/*`, `/settings/*`, `/sync`, `/exchange`, and `/library` should remain outside the search index unless their purpose changes substantially.
- Do not create public pages for user-uploaded books or reading history.

### Visual integrity

- Preserve the existing diagnostic-instrument language: monospace typography, basalt/black surfaces, restrained Lacanian red and dune gold accents, dense but legible controls, and direct technical language.
- Keep cards at 8px radius or less. Do not build nested cards, floating section cards, gradient-orb backgrounds, stock-photo heroes, or generic three-column feature grids.
- Do not add a huge marketing hero. The first viewport must show the product, an actual interactive demonstration, or the specific subject of the page.
- Do not put long explanatory copy over the main reading controls. Place crawlable supporting content after the primary tool or in a dedicated editorial route.
- Use real product screenshots or live product states. Do not use abstract AI artwork.
- Use existing icon libraries for controls. Do not add hand-drawn decorative SVGs.

### Editorial integrity

- No keyword stuffing, doorway pages, spun pages, city pages, fake reviews, fake testimonials, fake usage numbers, fake awards, or fake ratings.
- No "Top 10" listicles unless the list is the most honest format for original research.
- No unsupported claims about comprehension, cognition, disability, productivity, or reading speed.
- Treat "Read 3x Faster" as a claim requiring evidence. If there is no defensible test, replace it in editorial copy with a measurable product fact such as "Adjustable from 50 to 2,000 WPM" or "Train with adaptive RSVP pacing."
- Every new page must contain unique information, a unique purpose, and at least one product-specific proof element. Do not publish paraphrases of another page.
- Cite primary or reputable sources for cognitive and scientific claims. Include a visible references section.
- Do not publish agent-generated prose without a factual and tonal review.

## 3. Verified Baseline

The implementation agent must understand the current state before making changes.

### Search Console

As of 2026-08-04:

- The domain property `sc-domain:arphen.xyz` is verified.
- Search Console showed 2 indexed pages and 2 non-indexed pages.
- The recent performance overview showed 1 total web-search click.
- `https://www.arphen.xyz/` had a historical Googlebot smartphone fetch failure: `Server error (5xx)` on 2026-07-28.
- The `www` failure has been repaired with a Cloudflare Worker that returns a permanent redirect to the apex domain.
- A Search Console live test now reports `URL is available to Google` and `Page can be indexed`.
- An indexing request for `https://www.arphen.xyz/` was added to Google's priority crawl queue on 2026-08-04.
- Search Console reports can continue showing the historical failure until Google processes a new crawl. Do not undo the redirect while waiting.

### Current public search surface

The sitemap contains only:

- `/`
- `/manifesto`
- `/research`
- `/manual`

Relevant implementation files:

- `index.html`
- `public/sitemap.xml`
- `public/robots.txt`
- `src/App.tsx`
- `src/components/SeoHead.tsx`
- `src/components/Library/Archive.tsx`
- `src/components/Manifesto.tsx`
- `src/components/Research.tsx`
- `src/components/Manual.tsx`
- `src/test/indexHtmlPrerender.test.ts`
- `wrangler.www-redirect.toml`
- `src/cloudflare/wwwRedirect.ts`

### Confirmed technical problem

`SeoHead` changes metadata in a client-side `useEffect`. The server response for every sitemap route currently contains the homepage metadata and homepage fallback content.

Verified raw responses:

| URL | Raw title | Raw canonical | Raw heading |
| --- | --- | --- | --- |
| `/` | Homepage | `https://arphen.xyz/` | `XYZ` |
| `/manifesto` | Homepage | `https://arphen.xyz/` | `XYZ` |
| `/research` | Homepage | `https://arphen.xyz/` | `XYZ` |
| `/manual` | Homepage | `https://arphen.xyz/` | `XYZ` |

Google can render JavaScript, but making Google render the whole application merely to discover each page's identity slows discovery and makes failures more likely. This is the first engineering priority.

### Things that are already correct

- The apex HTTPS site returns `200` and HSTS.
- HTTP apex redirects to HTTPS.
- Both HTTP and HTTPS `www` now redirect to the HTTPS apex while preserving path and query.
- The sitemap uses apex HTTPS URLs.
- The homepage declares an apex canonical.
- `/reader/*` is excluded in `robots.txt`.
- SoftwareApplication and FAQ JSON-LD exist in `index.html`, although their eligibility and visible-content consistency still need review.

Do not redo working infrastructure for appearance's sake.

## 4. Success Definition

SEO cannot guarantee rankings or traffic. Measure controllable leading indicators and Search Console outcomes.

### First 30 days after deployment

- Every intended public URL returns unique, complete HTML without JavaScript.
- Every intended public URL has one self-referencing canonical, one unique title, one unique description, and one visible `h1`.
- All private application routes return `X-Robots-Tag: noindex` or an equivalent server-visible directive.
- Unknown routes return a real `404`, not a `200` homepage redirect.
- The sitemap is valid, generated from one route manifest, and submitted successfully.
- Zero production `5xx` responses on the canonical-host matrix.
- At least 90% of submitted public URLs are indexed or in a non-error discovery state.
- Public editorial pages meet Core Web Vitals "Good" thresholds at the 75th percentile when enough field data exists.

### First 90 days

- Publish 6 to 10 excellent indexable pages, not dozens of thin pages.
- Establish impressions for all four primary intent clusters in Section 7.
- Have at least three non-branded queries reach Google's top 20, subject to market competitiveness.
- Increase non-branded impressions materially from the saved launch baseline. Set the numerical target only after exporting the preceding 90 days from Search Console.
- Earn at least five legitimate referring domains from open-source, reading, privacy, accessibility, or research communities. No paid bulk links.

## 5. Execution Protocol for the Agent

Work in small pull-request-sized slices. For every slice:

1. Read the owning component and its nearest tests.
2. State the behavior being changed and the check that could falsify the implementation.
3. Make the smallest cohesive change.
4. Run focused tests immediately.
5. Run the production build.
6. Inspect the production-like HTML with JavaScript disabled.
7. Report changed files, command results, and any deferred work.

Do not combine a routing rewrite, visual redesign, and ten new content pages in one change.

Required commands:

```bash
npx vitest run
npm run lint
npm run build
git diff --check
```

Use non-interactive test commands only.

## 6. Phase 1: Make the Existing Site Reliably Indexable

Status: complete and deployed on 2026-08-04.

Complete this phase before creating new search pages.

### 6.1 Introduce one public-route manifest

Create a typed source of truth containing every indexable route and its:

- pathname
- title
- description
- canonical URL
- content type
- sitemap inclusion
- change date
- optional Open Graph image
- optional structured-data builder

Use the manifest to generate both route metadata and `sitemap.xml`. Do not maintain route details independently in four components, `index.html`, and the sitemap.

Suggested location:

```text
src/seo/publicRoutes.ts
```

Acceptance criteria:

- Duplicate paths and canonicals fail a unit test.
- Canonicals are apex HTTPS and contain no query or fragment.
- Every indexable `src/App.tsx` route exists in the manifest.
- Every sitemap entry exists in the manifest.

### 6.2 Generate static HTML for public routes

Keep Vite and React. Do not migrate the application to another framework solely for SEO.

Preferred implementation:

1. Build the app normally.
2. Start the production build locally.
3. Use the existing Playwright toolchain in a post-build script to visit each public route.
4. Wait until route content and `SeoHead` have settled.
5. Serialize the rendered document to route-specific output such as `dist/research/index.html`.
6. Keep client scripts so the page becomes interactive after load.
7. Ensure the serialized head contains the route's final metadata and structured data.

An equally robust established prerender library is acceptable, but do not add a large SSR framework without demonstrating why the post-build approach fails.

Important details:

- Do not serialize IndexedDB data, user books, settings, IDs, or local state.
- Use an empty browser context for every route.
- Do not emit the homepage `<noscript>` fallback into unrelated route documents.
- Make output deterministic so two builds without source changes are identical.
- Avoid hydration flicker. The first rendered screen must match the interactive page.

Acceptance criteria:

```bash
for route_name in / /manifesto /research /manual; do
  curl -sS "http://127.0.0.1:4173$route_name" |
    grep -E '<title>|rel="canonical"|<h1'
done
```

Expected:

- Four distinct titles.
- Four correct self-referencing canonicals.
- Four route-appropriate headings.
- Route-specific body copy exists in the response when JavaScript is disabled.
- No page depends on the generic homepage fallback to communicate its purpose.

Add focused tests that parse built HTML with Cheerio. Test the built artifact, not only React effects in JSDOM.

### 6.3 Return correct status codes

The current wildcard client route navigates to `/`, which can make nonexistent URLs look like valid soft-404 pages.

Implement:

- A generated `404.html` with a restrained on-brand error state and links to the cockpit, manual, and research.
- A real HTTP `404` for unknown paths in the Cloudflare Pages deployment.
- Client-side unknown-route behavior that shows the same not-found state instead of silently navigating home.

Acceptance criteria:

```bash
curl -sSI https://arphen.xyz/this-page-must-not-exist
```

Expected: `404`, never `200` and never a redirect to `/`.

### 6.4 Keep application-state routes out of the index

Add server-visible `X-Robots-Tag: noindex, nofollow` headers through `public/_headers` for:

```text
/reader/*
/settings/*
/sync
/exchange
/library
```

Also remove reader-page self-canonicals. A private or locally generated reader URL should not declare itself as an indexable canonical.

Do not rely only on `robots.txt`: Google must be allowed to see a `noindex` directive, and a disallowed URL can remain known without being crawled. Choose one coherent policy and test it. Preferred policy for these routes is crawlable response plus `noindex`; if sensitive content could appear in server HTML, return no content and `noindex`.

### 6.5 Correct metadata and entity consistency

Decide and document the naming relationship:

- Product name: `XYZ`
- Project/publisher name: `Arphen`
- Domain: `arphen.xyz`

Use this relationship consistently. Do not alternate between XYZ and Arphen as if they are the same unnamed entity.

Recommended initial titles:

| Route | Title direction |
| --- | --- |
| `/` | `XYZ: Private RSVP Speed Reader for EPUB and PDF` |
| `/manifesto` | `The Local-First Reading Manifesto | XYZ` |
| `/research` | `Adaptive RSVP and Semantic Pacing Research | XYZ` |
| `/manual` | `XYZ Speed Reading Manual: RSVP, Pacing, and Controls` |

Keep titles descriptive and natural. Do not mechanically append a list of keywords.

Requirements:

- Approximately 45 to 65 characters where a natural title permits it.
- Descriptions should communicate a specific reason to visit, usually within 140 to 165 characters. Google may rewrite them.
- One canonical per page.
- Route-specific Open Graph URL, title, description, and image.
- Use actual Unicode punctuation or normal ASCII; do not emit literal escape sequences into JSX.
- Remove `<meta name="keywords">`; Google does not use it for ranking.
- Replace the Vite favicon reference with the real product favicon.

### 6.6 Use structured data conservatively

Structured data must match visible page content.

Implement:

- Homepage: `SoftwareApplication` with a stable `@id`, accurate offers, supported platforms/formats, screenshot, publisher, and canonical URL.
- Research: `TechArticle` or `Article` only if visible author, publication date, modified date, and article body are present.
- Manual and guides: `Article` or `HowTo` only when the page visibly satisfies the selected schema requirements.
- Nested guide pages: `BreadcrumbList` only when the same breadcrumb is visibly rendered.
- Publisher: one stable `Organization` entity for Arphen if Arphen is in fact the publisher.

Do not add:

- `AggregateRating` without real, visible, independently collected ratings.
- Fake review schema.
- FAQ schema merely to chase a rich result.
- Hidden questions or answers.

Review the existing `FAQPage` block. Keep it only if the same questions and answers are visibly available on the homepage. Google generally limits FAQ rich results, so it is not a priority.

### 6.7 Generate and validate discovery files

Generate `public/sitemap.xml` from the public-route manifest during build.

Rules:

- Include only canonical, indexable `200` pages.
- Never include fragment URLs such as `/manual#controls`; sitemap fragments do not create separate pages.
- Use truthful `lastmod` values derived from content changes. Do not update all dates on every build.
- Omit `priority` and `changefreq` unless there is a demonstrated use; Google ignores them.
- Keep one sitemap until the site exceeds practical single-sitemap limits.

For `robots.txt`:

- Keep the sitemap declaration.
- Remove `Crawl-delay`; Googlebot ignores it and the site does not need artificial throttling.
- Avoid redundant `Allow` rules.
- Coordinate Cloudflare Managed Robots settings so the deployed file is intentional.

## 7. Phase 2: Build a Focused Search-Intent Architecture

Status: queued. Start with `/rsvp-reader` only after the Search Console release procedure and baseline export are complete.

Do not target the broad phrase "speed reading" first. Establish authority in narrower areas where the product has a genuine differentiator.

### Primary clusters

1. **RSVP tool intent**: RSVP reader, rapid serial visual presentation reader, adjustable WPM reader.
2. **File-format intent**: EPUB speed reader, PDF speed reader, read TXT or Markdown with RSVP.
3. **Privacy and local-first intent**: private speed-reading app, offline browser reader, local AI reading tool, no-account reader.
4. **Method and research intent**: adaptive RSVP pacing, reading comprehension at high WPM, semantic pacing, RSVP versus conventional reading.

### Initial page map

Create pages one at a time in this order. Publish the next page only when the previous page passes the quality gate in Section 8.

| Proposed route | Search intent | Page job | Required unique proof |
| --- | --- | --- | --- |
| `/rsvp-reader` | Use an RSVP reader now | Let the visitor try a bounded demo and open the full reader | Live RSVP sample using the real pacing component |
| `/epub-speed-reader` | Read an EPUB faster/private | Explain and demonstrate local EPUB import | Real EPUB import flow, supported behavior, limitations |
| `/pdf-speed-reader` | Use RSVP with a PDF | Explain PDF extraction and reading workflow | Real PDF flow, OCR limitation disclosure, screenshot |
| `/how-it-works` | Understand XYZ/adaptive pacing | Explain the processing pipeline clearly | Architecture diagram, actual pacing examples, no invented benchmark |
| `/privacy` | Determine where books/data go | Make local-first behavior auditable | Data-flow diagram, storage list, network behavior, source links |
| `/guides/what-is-rsvp` | Learn RSVP reading | Give a balanced, cited explanation | Interactive comparison and references |
| `/guides/rsvp-comprehension` | Evaluate comprehension tradeoffs | Explain evidence and limits | Primary-source citations and a reproducible self-test |
| `/speed-test` | Test a chosen WPM | Provide a useful linkable tool | Local interactive test with no account or tracking |

Do not create format pages before the format works reliably in production. A landing page that promises a broken workflow is worse than no page.

### Later candidates, only if Search Console justifies them

- `/guides/how-to-read-epub-online`
- `/guides/variable-speed-reading`
- `/guides/offline-reading-app`
- `/compare/rsvp-vs-traditional-reading`

Use Search Console query data to decide. Do not create competitor comparison pages unless the comparison is tested, factual, fair, and useful.

## 8. Content Quality Gate

Every proposed indexable page must pass all of these checks.

### Intent

- One primary visitor question is stated in the page brief.
- The page answers that question directly in the first meaningful section.
- The page does not compete with another arphen.xyz page for the same intent.

### Original value

At least one of:

- A live product interaction.
- A real screenshot showing the relevant state.
- Original measurements with a documented method.
- Source-code-level explanation with links to the repository.
- A balanced synthesis of primary research with citations.
- A reproducible test or downloadable benchmark.

### Copy

- Use enough copy to answer the question completely, not an arbitrary word count.
- Prefer concrete nouns and product behavior over adjectives.
- Define RSVP on first use.
- State limitations next to claims, not in tiny legal text.
- Use one `h1`, a logical heading hierarchy, short paragraphs, lists only when lists improve comprehension, and descriptive link text.
- Include visible author/publisher and reviewed/modified dates for research and guides.
- End with a relevant action such as trying the reader, opening a sample, or reading the manual. Do not add several competing CTAs.

### Visual composition

- The first viewport shows the tool, demonstration, or literal page subject.
- Editorial content is an unframed reading column, not a stack of marketing cards.
- Diagrams use the existing visual system and are readable on mobile.
- Screenshots show real UI at useful resolution and include descriptive alt text.
- No visual element exists only to make the page look "SEO complete."

### Technical

- Static HTML contains the complete core answer.
- Page has unique metadata and valid canonical.
- Page is in the sitemap and internal link graph.
- Structured data, if present, validates and matches visible content.
- Mobile layout has no overlap or clipped text.
- Keyboard navigation and heading order work.
- No new third-party tracker is loaded.

## 9. Phase 3: Internal Linking and Navigation

Build a small, meaningful graph rather than a giant SEO footer.

### Global discovery

- Add restrained links for `Manual`, `Research`, and possibly `Methods` or `Guides` to the existing navigation.
- Do not expose settings, reader IDs, exchange payloads, or local library state as crawl links.
- Add a compact footer or terminal-style colophon on editorial pages with links to the product, manual, research, privacy, source repository, and license.
- Keep the homepage product-first. Global links should not dominate the cockpit.

### Contextual links

- Manifesto should link naturally to the technical research and privacy explanation.
- Research should link to relevant implementation pages and the manual.
- Manual should link to the RSVP explanation and the live reader.
- Format pages should link to the relevant guide, privacy page, and actual import action.
- Guides should link back to the tool only where it advances the reader's task.

### Research-page correction

The current Research component renders one tab's content at a time based on client state. Content hidden behind buttons has no stable URL and is less discoverable.

Choose one approach:

1. Render all research sections as normal document sections with anchor navigation; or
2. Give substantial sections canonical subroutes and static HTML.

Prefer normal sections unless each section independently satisfies a distinct search intent. Do not create thin subroutes from tabs merely to increase URL count.

### Link rules

- Use standard `<a href>` or React Router `<Link>` elements that produce crawlable anchors.
- Do not make navigation depend on click handlers attached to non-link elements.
- Use descriptive text, not repeated "learn more."
- Keep the number of repeated sitewide links restrained.
- Add visible breadcrumbs only for nested guides; keep top-level product pages simple.

## 10. Phase 4: Performance and Rendering Quality

Measure before refactoring. Large generated bundles do not prove that every route downloads them.

### Establish route budgets

Use Playwright to record requests and transferred bytes for a clean visit to each public route. Save the baseline in a test artifact or Markdown table.

Targets for public editorial pages:

- Server response under 800 ms from representative regions where feasible.
- LCP at or below 2.5 seconds at the 75th percentile.
- CLS at or below 0.1.
- INP at or below 200 ms.
- No local-AI model, PDF worker, TTS model, or WebLLM runtime download until the visitor invokes the relevant feature.

### Likely work

- Route-split heavy reader, PDF, TTS, and model code from editorial pages.
- Keep the static content visible while React loads.
- Preserve explicit dimensions for media and interactive demos to prevent layout shift.
- Self-host or carefully preload only fonts actually used above the fold.
- Keep HTML `no-cache` behavior compatible with PWA updates; keep fingerprinted assets immutable.
- Verify the service worker cannot serve stale route metadata after deployment.

Do not sacrifice the functioning reader for a synthetic Lighthouse score. Test both the public page and the transition into the app.

## 11. Phase 5: Authority and Legitimate Link Acquisition

Links should be a consequence of useful work. Never buy bulk backlinks or automate outreach spam.

### Open-source foundation

- Improve the GitHub repository description, topics, screenshots, demo URL, installation notes, architecture summary, and contribution path.
- Link from the repository README to the canonical product, research, privacy explanation, and manual.
- Publish meaningful tagged releases with concise release notes.
- Submit the project selectively to relevant maintained open-source lists after checking each list's contribution rules.

### Linkable assets

Prioritize assets that remain useful without a sales pitch:

- The no-account RSVP speed test.
- A transparent comparison of fixed versus adaptive pacing.
- A small reproducible reading/pacing benchmark.
- A technical write-up of browser-only EPUB/PDF processing.
- A network/data-flow audit showing what leaves the browser.
- A carefully sourced review of RSVP comprehension evidence.

### Community distribution

- Share major releases with communities where the work is genuinely relevant: open-source software, self-hosted/local-first tools, reading research, accessibility, privacy, and browser ML.
- Write a technical launch post that explains a real engineering problem and links to source, not a generic product announcement.
- Contact researchers or maintainers only with a specific relevant artifact or correction. Do not request links in the first sentence.
- Create press-quality screenshots and a short factual project summary so other authors can describe XYZ accurately.

### Prohibited link tactics

- Bulk directory submissions.
- Paid link packages.
- Private blog networks.
- AI-written guest-post campaigns.
- Comment spam.
- Reciprocal-link schemes.
- Fake scholarship, award, or statistics pages.

## 12. Measurement Without Compromising Privacy

Use Google Search Console as the primary SEO measurement system.

Do not add client-side analytics by default. If aggregated Cloudflare traffic analytics are considered later, document exactly what is collected and update public privacy statements before enabling it.

### Save a baseline export

Before Phase 1 deploys, export the previous 90 days from Search Console:

- Queries: clicks, impressions, CTR, position.
- Pages: clicks, impressions, CTR, position.
- Countries and devices.
- Indexing report.
- Core Web Vitals report.

Store aggregate exports outside the public repository if they contain sensitive business information.

### Weekly review for the first eight weeks

- New indexing errors.
- Submitted versus indexed URLs.
- Non-branded queries gaining impressions.
- Pages with impressions but low CTR.
- Queries where position is between 8 and 30.
- Canonical selection differences.
- Mobile crawl and Core Web Vitals problems.

Do not rewrite titles after a few days of data. Compare at least 28 days where traffic volume permits.

### Decision rules

- **High impressions, low CTR:** improve title/description to match intent; do not add hype.
- **Position 8-20:** improve the page's answer, proof, internal links, and references before creating a duplicate page.
- **Crawled, not indexed:** inspect uniqueness, canonical, status, rendered content, and internal links.
- **Discovered, not indexed:** improve server-rendered content and internal discovery; verify performance and sitemap dates.
- **No impressions after 8-12 weeks:** reassess intent and page value; merge or remove weak pages rather than multiplying them.

## 13. Required Automated Tests

Add tests that fail the build for SEO regressions.

### Manifest tests

- Unique paths.
- Unique canonical URLs.
- Apex HTTPS only.
- No query strings or fragments.
- Every public route has title, description, and sitemap policy.

### Built-HTML tests

For every indexable route:

- Output file exists.
- Exactly one non-empty `<title>`.
- Exactly one canonical matching the manifest.
- Exactly one description.
- Exactly one visible `h1`.
- Core page copy exists without JavaScript.
- `html[lang]` is correct.
- No `noindex`.
- Open Graph URL matches canonical.
- JSON-LD parses as JSON.

For every non-indexable route pattern:

- Header or static directive contains `noindex`.
- Route is absent from sitemap.

### Deployment smoke tests

```bash
set -e

for url in \
  'http://arphen.xyz/' \
  'http://www.arphen.xyz/' \
  'https://www.arphen.xyz/'
do
  curl -sSIL --max-redirs 5 "$url"
done

curl -sSI 'https://arphen.xyz/'
curl -sSI 'https://arphen.xyz/research'
curl -sSI 'https://arphen.xyz/this-page-must-not-exist'
curl -sS 'https://arphen.xyz/sitemap.xml' | xmllint --noout -
```

Expected:

- All alternate origins reach `https://arphen.xyz/` through permanent redirects.
- Public pages return `200`.
- Unknown page returns `404`.
- Sitemap is valid XML.
- No redirect loops or `5xx` responses.

Add a Googlebot-smartphone user-agent smoke test because the historical failure affected that crawler.

## 14. Search Console Release Procedure

After each production SEO release:

1. [x] Run production smoke tests on 2026-08-04.
2. [x] Inspect `/`, `/research`, and `/settings/pacing` in production.
3. [ ] Submit or resubmit `https://arphen.xyz/sitemap.xml` only when its URL set changes or Search Console reports a problem. The current browser session is signed out.
4. [ ] Use URL Inspection and `Test live URL` for the four public URLs after authentication.
5. [ ] Request indexing once per important changed URL. Repeated requests do not increase priority.
6. [x] Record the 2026-08-04 deployment and affected URLs: `/`, `/manifesto`, `/research`, `/manual`.
7. [ ] Check results after 3 days, 14 days, and 28 days.

Do not treat stale report labels as live failures when the live test passes. Compare the report's last-crawl date with the deployment date.

## 15. Execution Tickets

The implementation agent should execute these tickets in order.

### Ticket 1: SEO route manifest and tests [complete]

Deliver:

- Typed public-route manifest.
- Unit tests for uniqueness and canonical rules.
- Existing pages migrated to manifest metadata.

Stop condition: tests and build pass; no visual changes.

### Ticket 2: Per-route static HTML [complete]

Deliver:

- Deterministic post-build prerendering.
- Route-specific output for the four existing sitemap pages.
- Built-HTML tests.

Stop condition: raw local HTTP responses show unique metadata, headings, and body content without JavaScript.

### Ticket 3: Status and indexing policy [complete]

Deliver:

- Real `404` behavior.
- Server-visible noindex policy for application-state routes.
- Sitemap and robots generation cleanup.
- Removal of reader self-canonicals.

Stop condition: status/header matrix passes locally and on preview deployment.

### Ticket 4: Metadata and structured-data audit [complete]

Deliver:

- Product/publisher naming decision.
- Accurate titles and descriptions.
- Route-specific social metadata.
- Visible-content-aligned JSON-LD.
- Real favicon.

Stop condition: built HTML tests and schema validation pass.

### Ticket 5: Existing-content discoverability [complete]

Deliver:

- Research content available through stable document sections or justified routes.
- Contextual links among Manifesto, Research, Manual, Privacy, and the product.
- Restrained editorial colophon/navigation.

Stop condition: all important content and links are present in static HTML and mobile screenshots remain coherent.

### Ticket 6: First search-intent page [next]

Deliver only `/rsvp-reader` first.

- Full page brief.
- Real interactive demonstration.
- Original explanatory content.
- Metadata, schema if justified, internal links, sitemap entry, tests.

Stop condition: passes every quality gate in Section 8. Review results before reusing any pattern.

### Ticket 7: Format and trust pages [queued]

Deliver one page per change:

1. `/epub-speed-reader`
2. `/pdf-speed-reader`
3. `/privacy`
4. `/how-it-works`

Stop condition for each: the promised product flow is tested and the page contains unique proof.

### Ticket 8: Linkable guide/tool [queued]

Choose `/speed-test` or `/guides/what-is-rsvp` based on Search Console queries and editorial readiness.

Stop condition: useful without signup, technically accurate, mobile tested, and suitable for genuine community sharing.

### Ticket 9: Performance pass [queued]

Deliver:

- Route request/byte baseline.
- Lazy-loading corrections supported by measurements.
- Core Web Vitals checks for representative mobile and desktop viewports.
- PWA metadata freshness test.

Stop condition: no regression in reader behavior; public page budgets improve or remain within target.

### Ticket 10: Distribution package [queued]

Deliver:

- Updated repository presentation.
- Screenshots.
- Factual 100-word and 250-word summaries.
- One technical launch article.
- A hand-selected outreach list with relevance notes.

Stop condition: no automated or bulk outreach.

## 16. Final Definition of Done

The plan is successfully implemented when:

- Google can understand every public page from the first HTML response.
- The canonical/status/noindex matrix is deterministic.
- The site has a compact set of substantial pages covering real user intents.
- New pages look and feel like parts of the same diagnostic reading instrument.
- Every claim is either directly observable, measured, qualified, or cited.
- The product remains private and usable without signup.
- Search Console shows healthy crawling and growing non-branded impressions.
- The project has earned links through useful software and original work, not SEO theater.

The desired outcome is not "more SEO pages." It is a clearer, faster, more referenceable public body of work around a genuinely useful reading tool.