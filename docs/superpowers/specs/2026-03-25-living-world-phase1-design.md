# Phase 1: Living World — Design Spec

**Date:** 2026-03-25
**Goal:** Transform GitKingdom from a static visualization into a living, competitive world that gives users a reason to return.

## Overview

Three interlocking features that make the world feel alive:

1. **Live Event Feed** — scrolling ticker of world activity
2. **Citizen Thoughts** — commit messages as NPC thought bubbles
3. **Kingdom Wars & Battles** — passive competition with narrative battle arcs

These feed into each other: citizen thoughts and kingdom battles generate events that populate the live feed, creating a self-sustaining sense of activity.

## Phased Roadmap Context

This spec covers **Phase 1** only. Future phases are noted for context but not designed here:

- **Phase 2:** Graveyard + Resurrection (archived repos), Kingdom Defection prompts
- **Phase 3:** Referral tracking + Herald of the Realm badges, Community feature voting page
- **Future:** Visual decay on inactive repos (needs sprite design work), Community asset editor

---

## 1. Live Event Feed

### What It Is

A scrolling RPG-styled ticker panel showing recent world events. Uses a "fake real-time" approach: on page load, the last hour of events are fetched and replayed with staggered timing (one event every 3-5 seconds), making the world feel active without requiring persistent connections or new infrastructure.

### Data Model

New `world_events` table in Supabase:

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `event_type` | text | Enum: `citizen_joined`, `repo_added`, `building_upgraded`, `kingdom_rank_changed`, `battle_started`, `battle_round`, `battle_resolved` |
| `payload` | jsonb | Event-specific data (username, repo, kingdom, metric, etc.) |
| `created_at` | timestamptz | When the event occurred |

Index on `created_at` for efficient range queries. Retention: prune events older than 30 days via the kingdom-wars cron job (add as a final step).

### API

`GET /api/events?since=<ISO timestamp>`

- Returns events newer than `since`, ordered by `created_at` ascending
- Default: last 1 hour if no `since` param
- Max 50 events per response
- No authentication required (public feed)

### Event Generation

No new user action needed. Events are written as side effects of existing operations:

- `/api/world/join` → writes `citizen_joined` event
- `/api/repo/add` → writes `repo_added` event
- Refresh-pushed cron → writes `building_upgraded` event when a repo's star count crosses a building rank threshold (camp → hovel → cottage → guild → manor → keep → palace → castle → citadel)
- Kingdom wars cron → writes `kingdom_rank_changed`, `battle_started`, `battle_round`, `battle_resolved` events

### Frontend

- **Position:** Fixed bottom-right corner of both WorldScene and CityScene
- **Style:** Semi-transparent dark background matching existing RPG panel aesthetic (9-slice border, Silkscreen font)
- **Display:** Max 5 events visible at once. New events fade in at the bottom, older ones scroll up and fade out.
- **Replay:** On scene load, fetch events from last hour, queue them, display one every 3-5 seconds with fade-in animation
- **Interaction:** Clicking an event navigates to the relevant kingdom, building, or citizen
- **Collapsible:** Small toggle button (arrow icon) to minimize/expand the panel
- **Persistence:** Panel state (collapsed/expanded) saved to localStorage

---

## 2. Citizen Thoughts

### What It Is

Walking citizen NPCs display their last commit message as thought bubbles. Three layers of display: ambient pop-ups for atmosphere, hover for quick peek, and the citizen card for full detail.

### Data Flow

- Add `last_commit_message` field to the citizen API response
- Fetched server-side from GitHub API when contributor data is refreshed (piggyback on existing contributor fetch — not a new API call per citizen)
- Truncated to 80 characters server-side
- Cached alongside existing citizen data with the same staleness rules (24h fresh, 7-day stale)

### API Change

`GET /api/citizen?username=<username>` response gains:

```json
{
  "last_commit_message": "fix: resolve race condition in auth flow"
}
```

Bulk citizen data for CityScene also includes this field.

### Frontend — Three Layers

**Ambient pop-ups:**
- Every 6-8 seconds, a random on-screen citizen (who has a commit message) gets a thought bubble
- Max 2 ambient bubbles visible simultaneously
- Bubble appears above citizen's head, stays 4-5 seconds, fades out
- Pixel-art speech bubble sprite: rounded rectangle with tail pointing down, white with dark border
- Text in Silkscreen font, truncated to ~40 characters
- Only picks from citizens currently visible in the camera viewport

**Hover bubble:**
- Mouseover any walking citizen shows a thought bubble above their head
- Same visual style as ambient bubbles
- Truncated to ~40 characters
- Appears immediately, disappears when mouse leaves

**Citizen card (click):**
- The existing citizen info panel gains a "Thoughts" section at the bottom
- Shows the full commit message (up to 80 chars) styled as italic text in a quote block with a small thought-bubble icon
- Always visible when the card is open

**Generic fallback:**
Citizens with no commit message get a randomized RPG flavor line from a pool:
- "The realm is peaceful today..."
- "I serve the {kingdom} kingdom faithfully"
- "Another day in {city}..."
- "These are prosperous times..."
- "I wonder what lies beyond the border..."
- (10-15 variants using only the citizen's own kingdom name — no cross-kingdom data dependency. Randomly selected per citizen per session)

---

## 3. Kingdom Wars & Battles

### What It Is

Kingdoms passively compete across multiple metrics. A leaderboard tracks overall rankings, and the system automatically generates narrative **battles** between neighboring kingdoms that play out over 3-5 days with daily round updates.

### Metrics

| Metric | Display Name | Source |
|--------|-------------|--------|
| Commits (last 30 days) | Military Strength | Sum of contributor commits in repos of that language |
| Total stars | Wealth | Sum of stargazer_count for repos of that language |
| Active citizens (last 30 days) | Population | Count of contributors with recent commits |
| New repos (last 30 days) | Expansion | Count of repos added in the last 30 days |
| Weighted blend | Kingdom Power | 40% Military Strength + 30% Wealth + 20% Population + 10% Expansion (normalized to 0-100 per metric before weighting) |

### Data Model

**`kingdom_rankings` table:**

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `language` | text | Kingdom language |
| `metric` | text | Which metric |
| `value` | numeric | Current metric value |
| `rank` | integer | Current rank |
| `previous_rank` | integer | Rank from previous update |
| `updated_at` | timestamptz | Last recalculation |

**`kingdom_battles` table:**

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `kingdom_a` | text | Language of first kingdom |
| `kingdom_b` | text | Language of second kingdom |
| `metric` | text | The contested metric |
| `started_at` | timestamptz | Battle start |
| `ends_at` | timestamptz | Scheduled end (3-5 days from start) |
| `status` | text | `active` or `resolved` |
| `rounds` | jsonb | Array of daily snapshots: `[{day: 1, a_delta: 142, b_delta: 98}, ...]` |
| `winner` | text | Language of winning kingdom (null until resolved) |

### Battle Mechanics

**Spark (battle creation):**
- Cron detects two neighboring kingdoms within 10% of each other on any metric
- Creates a battle with 3-5 day duration (randomized)
- Generates `battle_started` event: "Border skirmish erupts between Python Forest and TypeScript Grasslands over Military Strength!"

**Daily rounds:**
- Each day, cron snapshots the contested metric for both kingdoms
- Delta since battle start (or last round) becomes the round result
- Generates `battle_round` event: "Day 2: TypeScript forces push forward (+142 commits vs Python's +98)"

**Resolution:**
- After the battle duration, whichever kingdom gained more in the metric wins
- Winner: `battle_resolved` event with trophy narrative + visual banner on territory
- Loser: "rallying" flavor event ("Python regroups after defeat...")

**Rules:**
- Max 1 active battle per kingdom at a time
- Only neighboring kingdoms can battle. Adjacency is derived from the world map's flood-fill ownership grid in `WorldGenerator.ts` — two kingdoms are neighbors if their territory tiles are orthogonally adjacent. At battle-eligibility time, compute a static adjacency list from the current world data (language pairs that share a border). This can be cached and recomputed when the world regenerates.
- Metric is randomly selected from the 4 individual metrics (not the combined score)
- ~1-2 new battles generated per week to keep a steady cadence. If fewer than 3 kingdoms exist or no pairs are within 10%, widen threshold to 25%. If still no eligible pairs, skip battle generation (small worlds are too small for wars).
- **Ties:** If both kingdoms gain exactly equal amounts, the defender (kingdom_a, the one with higher prior rank in that metric) wins. This avoids anti-climactic "no result" outcomes.

### Cron Job

Single Vercel cron endpoint: `GET /api/cron/kingdom-wars`

- Runs every 6 hours (4x daily — frequent enough for daily battle rounds, infrequent enough to stay within Vercel cron limits)
- Step 1: Aggregate metrics from `repos` and `contributors` tables → update `kingdom_rankings`
- Step 2: Compare new rankings to previous → write `kingdom_rank_changed` events for any shifts
- Step 3: Update active battles with daily round snapshots → write `battle_round` events
- Step 4: Resolve completed battles → write `battle_resolved` events
- Step 5: Check for new battle opportunities → write `battle_started` events

### Frontend — Leaderboard Panel

- Accessed from WorldScene via "Kingdom Rankings" button in RPG header bar (trophy/crown icon)
- Styled like existing info panels: dark background, 9-slice border, pixel fonts
- **Rankings tab:** Kingdoms listed per metric with up/down arrows for recent movement. Each row: biome icon, kingdom name, metric value, rank change indicator (green up / red down / dash)
- **Active Battles tab:** Current conflicts with progress bars showing each side's gains. Click to see round-by-round history.

### Frontend — World Map Indicators

- Kingdom label of the #1 overall Power kingdom gets a subtle crown icon
- Active battle zones: faint crossed-swords icon on the border between warring kingdoms (optional, depends on visual clutter)

---

## Shared Infrastructure

### Event Feed as Backbone

All three features generate events consumed by the live feed:

| Source | Event Types |
|--------|-------------|
| Citizen Thoughts | *(indirect — citizen joins generate events, thoughts are visual-only)* |
| Kingdom Wars | `kingdom_rank_changed`, `battle_started`, `battle_round`, `battle_resolved` |
| Existing actions | `citizen_joined`, `repo_added` |

### No New External Dependencies

- All data stored in existing Supabase instance (3 new tables)
- All compute via existing Vercel serverless + cron
- No WebSocket/SSE infrastructure needed
- GitHub API usage piggybacks on existing fetch patterns

### Migration Path to Real-Time

The fake real-time feed can be upgraded to polling (`setInterval` fetch every 30-60s) or Supabase Realtime (PostgreSQL LISTEN/NOTIFY) later without changing the data model or event generation. The upgrade is purely a frontend change.

---

## Testing Strategy

- **Unit tests:** `groupByLanguage`-style tests for metric aggregation, battle eligibility detection, event generation logic
- **API tests:** Verify `/api/events` returns correct time-windowed results, `/api/cron/kingdom-wars` correctly updates rankings and battles
- **Frontend:** Manual testing of feed replay timing, thought bubble display/fade, leaderboard panel interactions
- **Edge cases:** Kingdoms with zero activity, battles where both sides have equal gains (tie-breaking), citizens with empty/null commit messages
