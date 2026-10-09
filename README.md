# Acquisition-Fit Leads

An add-on concept for [SaaSquatch Leads](https://www.saasquatchleads.com/): rather than ranking leads by "has an email", it ranks small businesses by **how likely the owner is to sell, and how reachable they are**. SaaSquatch's core users are search funders and acquisition entrepreneurs who want to buy a business, not sell into one.

```
Find businesses ──► Enrich & score ──► Review & export
(OpenStreetMap      (crawl site, extract    (filter, track status,
 or CSV import)      signals, verify email,  CSV / HubSpot CSV,
                     0-100 fit + reasons)    optional AI opener)
```

## Why this feature

A searcher's bottleneck is not volume. It is triage: which of 300 HVAC shops has a 60-year-old founder, no succession plan, and a reachable inbox? Generic lead tools don't answer that. This tool turns public signals into a transparent score, and every point is explained in plain English:

| Signal (extracted from the company's own site) | Points | Why it matters for an acquisition |
|---|---|---|
| Founded ≥ 25 years ago ("since 1968", "est. 1984", "40 years in business") | +25 | Founder is likely near retirement |
| Founded 15–24 / 8–14 years ago | +15 / +5 | Mature, proven business |
| Family- / owner-operated language | +10 | Owner is the decision maker |
| Multi-generation ("second-generation") | +5 | Succession is already a live topic |
| Explicit retirement / "business for sale" language | +10 | Direct exit intent |
| Owner / founder named on site | +10 | You know who to address |
| MX-verified email (non-department inbox) | +15 | Outreach won't bounce |
| Phone number | +5 | Cold-call ready |
| Stale site (© ≥ 3 years old) / no online booking | +10 / +5 | Digital/AI value-creation lever after the deal (Caprae's thesis) |
| Recurring-revenue vertical (HVAC, pest, accounting, dental…) | +10 | Higher multiple, more predictable cash flow |
| Hiring | +5 | Healthy demand |
| Franchise / chain (OSM `brand` tag, franchise wording, same name 3+ times) | −35 | Not an independent seller |
| Parked domain | −20 | Business may have closed |

Tier A ≥ 65, B ≥ 40, C below that. Weights live in [`lib/score.ts`](lib/score.ts), a single pure function.

## Features

- **Discovery**: 13 ETA-friendly verticals × any city or region, sourced from **OpenStreetMap** (Nominatim geocode, then Overpass). The data is free, licensed, and needs no API key.
- **CSV import**: bring your SaaSquatch, Apollo, or any other export. Headers are auto-mapped (company/name, website/domain/url, phone, email, city).
- **Enrichment crawler**: homepage plus up to 3 about/team/history/contact pages per site. It extracts emails (including Cloudflare-obfuscated ones), phones, LinkedIn/Facebook, owner names, founding year, copyright year, and ownership/succession/franchise/hiring/booking cues.
- **Data quality**:
  - **Dedupe** on domain (or normalized name + phone) across sources. A re-import fills blanks and never overwrites enrichment or status.
  - **Email validation**: syntax check, junk/no-reply filtering, own-domain and personal inboxes ranked first, and a **DNS MX check** on every address.
  - **Chain detection** and **parked-domain detection**.
- **Workflow**: tier and verified-email filters, a hide-chains filter, text search, a pipeline status (New / Contacted / Skip, bulk updates), a "why this score" drawer, and **Export CSV** or **HubSpot-ready CSV** (HubSpot import column names, with the score and reasons in Notes).
- **AI opener (optional)**: when `BEDROCK_REGION` is set, Claude (Sonnet 5.5 on Amazon Bedrock) writes a one-line summary and a respectful first-touch note to the owner, grounded only in the extracted facts.

## Architecture

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **Next.js 15 (App Router) + React 19 + Tailwind CSS 4** | One client page ([`app/page.tsx`](app/page.tsx)) plus a drawer. No component library. |
| API | **Next.js Route Handlers** (Node runtime) | `POST /api/discover`, `POST /api/enrich`, `GET/PATCH /api/leads`, `POST /api/opener` |
| Database | **libSQL / SQLite** via `@libsql/client` | `file:leadgen.db` locally. In production, **Turso** (hosted libSQL, AWS region) through `DATABASE_URL`, with identical code. Two tables: `leads`, `cache`. |
| Parsing | **cheerio** | Pure `extractSignals(html)` in [`lib/extract.ts`](lib/extract.ts), unit-tested |
| LLM | **Claude Sonnet 5.5 on Amazon Bedrock** via `@anthropic-ai/bedrock-sdk` (`AnthropicBedrockMantle`), low effort | About 1k tokens per opener, so roughly $0.005 each; $100 of credit covers about 15k drafts |
| Hosting | **Vercel** | Static page plus serverless functions; DB on Turso; LLM on AWS Bedrock |

**Caching and performance**
- Read-through `cache` table: site crawls for 7 days (failed crawls only 1 hour), MX lookups for 7 days, geocodes for 7 days, and Overpass results for 24 hours. Re-running a city returns instantly and never re-crawls.
- Enrichment is **one lead per request**. The browser runs a 4-worker pool, which keeps a live progress bar going, keeps every request well under serverless time limits, and stays polite to target sites.
- Per-fetch timeouts (8 s pages, 4 s robots.txt, 3 s MX), a 1.5 MB page cap, sub-pages fetched in parallel, and two Overpass mirrors with failover.
- Node's happy-eyeballs per-family timeout is raised to 2 s. The 250 ms default made many small-business hosts look "unreachable".

**Ethical collection**
- An identifying User-Agent, robots.txt `Disallow` rules honored, public business pages only, at most 4 pages per site, and directory data from OpenStreetMap (ODbL).

## Setup

```bash
npm install
cp .env.example .env.local     # all vars optional for local use
npm run dev                    # http://localhost:3000
npm test                       # node --test: extraction, scoring, dedupe, robots
```

Requires Node 22.6+ (the tests use Node's built-in TypeScript stripping; developed on Node 24).

## Deploy (Vercel + Turso)

```bash
turso db create leadgen && turso db show leadgen --url && turso db tokens create leadgen
# Vercel → New Project → import repo → env vars:
#   DATABASE_URL=libsql://…  DATABASE_AUTH_TOKEN=…
#   BEDROCK_REGION=us-east-1  AWS_BEARER_TOKEN_BEDROCK=…   (optional, for AI openers)
git push   # Vercel builds `next build` and deploys
```

Tables are created automatically on first request.

**Bedrock setup (for AI openers):** in the AWS console, open Amazon Bedrock → Model access and request access to Claude Sonnet 5.5 (Anthropic models need a one-time use-case form). Then go to Bedrock → API keys, create a key, and put it in `AWS_BEARER_TOKEN_BEDROCK`. If you'd rather use IAM, leave the key empty and the SDK falls back to the standard AWS credential chain. `BEDROCK_REGION` has its own name because Vercel reserves `AWS_REGION`.

## Limits and next steps

- OpenStreetMap coverage of US trades is uneven, which is why CSV import is first-class. The next step is plugging SaaSquatch's own sources (Apollo, Google Maps, Crunchbase) into `discover()`.
- No headless browser: JS-only sites read as thin. Upgrade path: a Playwright worker queue.
- No proxy rotation or CAPTCHA solving, by design. Blocked sites fail gracefully and are retried after an hour.
- Owner-name extraction is pattern-based. An LLM extraction pass over the about page would raise recall.
- No auth or multi-tenant support.
