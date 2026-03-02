import {
  LanguageKingdom, KingdomMetrics, Biome, TILES,
  BuildingRank, BuildingPurpose, CityBuilding, CitizenData, CityInterior,
} from '../types';
import { footprintToRank, type TemplateVariant } from '../editor/VariationEngine';

// ─── Helpers ────────────────────────────────────────────────

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Minimum stars to appear on the map ─────────────────────
const MIN_STARS = 2;

// ─── Stars → Building footprint (with rectangular shapes) ───
// Maps star count to one or more footprint options that match editor presets.
// A seed selects which shape a building gets, adding visual variety.
// The #1 repo in a kingdom gets a +2 bonus on both dimensions.
// Base max is 16×16 — only the #1 repo gets boosted to 20×20.
// Most buildings are small homes. Only top few repos are notable.
// #1 repo gets +4 bonus → castle. Everyone else is modest.
// A city of cottages with a few guild halls feels like a real medieval town.
const FOOTPRINT_PRESETS: { minStars: number; shapes: { w: number; h: number }[] }[] = [
  { minStars: 100000, shapes: [{ w: 6,  h: 8  }] },                    // keep (+ #1 bonus → 10×12 castle)
  { minStars: 50000,  shapes: [{ w: 5,  h: 7  }] },                    // manor (+ #1 bonus → 9×11 palace)
  { minStars: 20000,  shapes: [{ w: 5,  h: 5  }] },                    // manor
  { minStars: 10000,  shapes: [{ w: 4,  h: 6  }, { w: 4,  h: 4  }] }, // guild
  { minStars: 5000,   shapes: [{ w: 4,  h: 4  }, { w: 3,  h: 5  }] }, // guild/cottage
  { minStars: 2000,   shapes: [{ w: 3,  h: 5  }, { w: 3,  h: 3  }] }, // cottage
  { minStars: 500,    shapes: [{ w: 3,  h: 3  }] },                    // cottage
  { minStars: 2,      shapes: [{ w: 3,  h: 3  }] },                    // cottage
];

function getBuildingFootprint(stars: number, isTopRepo: boolean, seed: number): { w: number; h: number } {
  let shapes = [{ w: 3, h: 3 }]; // fallback (cottage)
  for (const t of FOOTPRINT_PRESETS) {
    if (stars >= t.minStars) { shapes = t.shapes; break; }
  }
  // Pick a shape deterministically from the options
  const shape = shapes[Math.abs(seed) % shapes.length];
  let { w, h } = shape;
  // #1 repo is the castle — only it can reach 20×20
  if (isTopRepo) {
    w = Math.min(20, w + 4);
    h = Math.min(20, h + 4);
  }
  return { w, h };
}

// ─── Footprint → rank classification ────────────────────────
// Delegates to footprintToRank for consistency between game and editor.
// Kept exported for backwards compatibility.
export function sizeToRank(side: number): BuildingRank {
  return footprintToRank(side, side);
}

// ─── Determine building purpose from repo topics ────────────
function getBuildingPurpose(m: KingdomMetrics): BuildingPurpose {
  const topics = (m.repo.topics || []).map(t => t.toLowerCase());
  const desc = (m.repo.description || '').toLowerCase();
  const all = [...topics, desc].join(' ');

  if (/web|frontend|react|vue|angular|css|html|ui|browser/.test(all)) return 'web';
  if (/ml|machine.?learn|ai|data|neural|tensor|model|nlp|llm/.test(all)) return 'arcane';
  if (/cli|tool|devops|docker|deploy|build|lint|test|terminal/.test(all)) return 'forge';
  if (/library|framework|sdk|package|module|api/.test(all)) return 'market';
  return 'general';
}

// ─── Biome base tile ────────────────────────────────────────
function biomeBaseTile(biome: Biome): number {
  switch (biome) {
    case 'forest': return TILES.GRASS_DARK;
    case 'volcanic': return TILES.GRASS_DARK;
    case 'mountain': return TILES.GRASS;
    case 'crystal': return TILES.GRASS_DARK;
    case 'desert': return TILES.SAND;
    case 'tundra': return TILES.SNOW;
    default: return TILES.GRASS;
  }
}

// ─── Aggregate citizens from all repos in this language ─────
function aggregateCitizens(repos: KingdomMetrics[], language: string): CitizenData[] {
  const userMap = new Map<string, CitizenData>();

  for (const r of repos) {
    for (const c of r.contributors) {
      const existing = userMap.get(c.login);
      if (existing) {
        existing.totalContributions += c.contributions;
        if (!existing.repos.includes(r.repo.full_name)) {
          existing.repos.push(r.repo.full_name);
        }
      } else {
        userMap.set(c.login, {
          login: c.login,
          avatar_url: c.avatar_url,
          totalContributions: c.contributions,
          repos: [r.repo.full_name],
          cities: [language],
        });
      }
    }
  }

  // Sort by contributions descending
  return [...userMap.values()].sort((a, b) => b.totalContributions - a.totalContributions);
}

// ═════════════════════════════════════════════════════════════
// MAIN: Generate a city interior for one language kingdom
//
// Organic medieval layout:
//   1. Terrain, walls, moat, gates
//   2. Castle at center with plaza
//   3. Road network (radial + ring + side streets)
//   4. Place buildings ALONG roads (dense core, sparse edges)
//   5. Prune dead-end roads, scatter decorations
// ═════════════════════════════════════════════════════════════
export function generateCityInterior(
  kingdom: LanguageKingdom,
): CityInterior {
  const rand = mulberry32(kingdom.language.charCodeAt(0) * 1000 + kingdom.repos.length);

  // Sort repos by stars descending — #1 is the castle
  const sortedRepos = [...kingdom.repos]
    .sort((a, b) => b.repo.stargazers_count - a.repo.stargazers_count)
    .filter(m => m.repo.stargazers_count >= MIN_STARS);

  // ── Pre-compute building footprints ──
  const footprints: { w: number; h: number }[] = sortedRepos.map((m, i) =>
    getBuildingFootprint(m.repo.stargazers_count, i === 0, i),
  );

  // ── City dimensions — compact sizing ──
  let totalArea = 0;
  for (const fp of footprints) {
    totalArea += (fp.w + 2) * (fp.h + 2); // +2 for road/gap
  }
  // Compact multiplier — we want a dense city, not a sprawling field
  totalArea *= 2.0;
  const gridSide = Math.ceil(Math.sqrt(totalArea));
  const W = Math.max(40, Math.min(200, gridSide));
  const H = W;
  const baseTile = biomeBaseTile(kingdom.biome);

  // ── 1. Fill base terrain ──
  const terrain: number[][] = Array.from({ length: H }, () =>
    Array(W).fill(baseTile)
  );

  // ── 2. City walls (single-tile border) ──
  for (let x = 0; x < W; x++) {
    terrain[1][x] = TILES.CASTLE_WALL;
    terrain[H - 2][x] = TILES.CASTLE_WALL;
  }
  for (let y = 0; y < H; y++) {
    terrain[y][1] = TILES.CASTLE_WALL;
    terrain[y][W - 2] = TILES.CASTLE_WALL;
  }
  for (const [cx, cy] of [[1, 1], [W - 2, 1], [1, H - 2], [W - 2, H - 2]]) {
    terrain[cy][cx] = TILES.CASTLE_TOWER;
  }

  // Gates (center of each wall)
  const midX = Math.floor(W / 2);
  const midY = Math.floor(H / 2);
  terrain[1][midX] = TILES.CASTLE_GATE;
  terrain[H - 2][midX] = TILES.CASTLE_GATE;
  terrain[midY][1] = TILES.CASTLE_GATE;
  terrain[midY][W - 2] = TILES.CASTLE_GATE;

  // Water moat outside walls
  for (let x = 0; x < W; x++) { terrain[0][x] = TILES.WATER; terrain[H - 1][x] = TILES.WATER; }
  for (let y = 0; y < H; y++) { terrain[y][0] = TILES.WATER; terrain[y][W - 1] = TILES.WATER; }

  // ── Helpers ──
  // PERF: Use flat Uint8Array grids instead of string-keyed Sets.
  // Lookup is grid[y * W + x] — a single array index, no hashing or string allocation.
  // For 200×200 this is 40KB vs 600KB+ for string Sets, and ~10x faster lookups.
  const safe = (x: number, y: number) => x >= 2 && x < W - 2 && y >= 2 && y < H - 2;
  const buildings: CityBuilding[] = [];
  const buildingGrid = new Uint8Array(W * H);  // 1 = building tile
  const roadGrid = new Uint8Array(W * H);      // 1 = road tile
  let roadCount = 0;

  function drawRoad(x: number, y: number) {
    if (safe(x, y) && !buildingGrid[y * W + x] && terrain[y][x] === baseTile) {
      terrain[y][x] = TILES.ROAD;
      roadGrid[y * W + x] = 1;
      roadCount++;
    }
  }

  // ── 3. Castle at center ──
  const castleSize = footprints.length > 0 ? footprints[0] : { w: 5, h: 5 };
  const plazaR = Math.max(3, Math.floor(Math.max(castleSize.w, castleSize.h) / 2) + 2);

  if (sortedRepos.length > 0) {
    const cs = castleSize;
    const castleX = midX - Math.floor(cs.w / 2);
    const castleY = midY - Math.floor(cs.h / 2);
    const castleRank = footprintToRank(cs.w, cs.h);
    placeBuildingTiles(terrain, castleX, castleY, cs.w, cs.h, castleRank);
    for (let dy = 0; dy < cs.h; dy++) {
      for (let dx = 0; dx < cs.w; dx++) {
        buildingGrid[(castleY + dy) * W + (castleX + dx)] = 1;
      }
    }
    buildings.push({
      repoMetrics: sortedRepos[0],
      rank: castleRank,
      purpose: getBuildingPurpose(sortedRepos[0]),
      x: castleX, y: castleY,
      width: cs.w, height: cs.h,
    });
  }

  // ── 4. Build road network — all axis-aligned for gap-free tile coverage ──
  const cityRadius = Math.floor((Math.min(W, H) - 6) / 2);

  // Helper: draw a gap-free horizontal or vertical road (axis-aligned Bresenham)
  function drawHRoad(y: number, x0: number, x1: number) {
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    for (let x = lo; x <= hi; x++) drawRoad(x, y);
  }
  function drawVRoad(x: number, y0: number, y1: number) {
    const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
    for (let y = lo; y <= hi; y++) drawRoad(x, y);
  }

  // 4a. Castle plaza (ring of road around the castle, 2 tiles wide)
  for (let dy = -plazaR; dy <= plazaR; dy++) {
    for (let dx = -plazaR; dx <= plazaR; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      if (dist >= plazaR - 1) drawRoad(midX + dx, midY + dy);
    }
  }

  // 4b. Main avenues — axis-aligned, 2 tiles wide, from plaza to gates (no wobble = no gaps)
  // North avenue
  drawVRoad(midX, 2, midY - plazaR);
  drawVRoad(midX + 1, 2, midY - plazaR);
  // South avenue
  drawVRoad(midX, midY + plazaR, H - 3);
  drawVRoad(midX + 1, midY + plazaR, H - 3);
  // West avenue
  drawHRoad(midY, 2, midX - plazaR);
  drawHRoad(midY + 1, 2, midX - plazaR);
  // East avenue
  drawHRoad(midY, midX + plazaR, W - 3);
  drawHRoad(midY + 1, midX + plazaR, W - 3);

  // 4c. Ring roads — axis-aligned rectangles (perfect tile coverage, no gaps)
  const ringDistances = cityRadius > 30 ? [0.35, 0.65] : [0.5];
  for (const ringPct of ringDistances) {
    const r = Math.floor(cityRadius * ringPct);
    const top = midY - r, bot = midY + r;
    const left = midX - r, right = midX + r;
    drawHRoad(top, left, right);     // top edge
    drawHRoad(bot, left, right);     // bottom edge
    drawVRoad(left, top, bot);       // left edge
    drawVRoad(right, top, bot);      // right edge
  }

  // 4d. Side streets — axis-aligned branches creating city blocks
  // Between each pair of roads, add perpendicular streets every ~8 tiles
  const blockSize = Math.max(6, Math.min(10, Math.floor(cityRadius * 0.25)));

  // Horizontal side streets (between north/south avenues and ring roads)
  for (let y = 4; y < H - 4; y += blockSize) {
    if (Math.abs(y - midY) < plazaR + 2) continue; // skip castle plaza area
    // Don't draw a full cross-city road, just short block connectors
    // Draw between the ring road and the outer wall
    for (const ringPct of ringDistances) {
      const r = Math.floor(cityRadius * ringPct);
      // Left blocks: from wall to ring road
      if (y >= midY - r - 1 && y <= midY + r + 1) {
        drawHRoad(y, 3, midX - plazaR - 1);
        drawHRoad(y, midX + plazaR + 2, W - 4);
      }
    }
  }
  // Vertical side streets
  for (let x = 4; x < W - 4; x += blockSize) {
    if (Math.abs(x - midX) < plazaR + 2) continue;
    for (const ringPct of ringDistances) {
      const r = Math.floor(cityRadius * ringPct);
      if (x >= midX - r - 1 && x <= midX + r + 1) {
        drawVRoad(x, 3, midY - plazaR - 1);
        drawVRoad(x, midY + plazaR + 2, H - 4);
      }
    }
  }

  // 4e. Fill 1-tile road gaps — any grass tile with road on 2+ opposite sides
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      if (terrain[y][x] !== baseTile) continue;
      if (buildingGrid[y * W + x]) continue;
      const n = terrain[y - 1][x] === TILES.ROAD ? 1 : 0;
      const s = terrain[y + 1][x] === TILES.ROAD ? 1 : 0;
      const w = terrain[y][x - 1] === TILES.ROAD ? 1 : 0;
      const e = terrain[y][x + 1] === TILES.ROAD ? 1 : 0;
      // Fill if it bridges two road segments (N-S or W-E)
      if ((n && s) || (w && e)) drawRoad(x, y);
    }
  }

  // ── 5. Place buildings using LOT SUBDIVISION (Watabou/SimCity approach) ──
  // Step A: Find rectangular "blocks" of empty grass between roads
  // Step B: Subdivide each block into lots, fill with buildings row by row
  // Step C: Larger buildings near center, cottages fill remaining space

  const occupiedGrid = new Uint8Array(W * H);  // 1 = occupied

  // Mark all non-base tiles as occupied
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (terrain[y][x] !== baseTile) occupiedGrid[y * W + x] = 1;
    }
  }
  // Castle + 1-tile buffer
  if (buildings.length > 0) {
    const b = buildings[0];
    for (let dy = -1; dy <= b.height; dy++) {
      for (let dx = -1; dx <= b.width; dx++) {
        const px = b.x + dx, py = b.y + dy;
        if (px >= 0 && px < W && py >= 0 && py < H) occupiedGrid[py * W + px] = 1;
      }
    }
  }

  function canPlace(bx: number, by: number, bw: number, bh: number): boolean {
    if (bx < 3 || bx + bw > W - 3 || by < 3 || by + bh > H - 3) return false;
    for (let dy = 0; dy < bh; dy++) {
      for (let dx = 0; dx < bw; dx++) {
        if (occupiedGrid[(by + dy) * W + (bx + dx)]) return false;
      }
    }
    return true;
  }

  function commitBuilding(
    repo: KingdomMetrics,
    fp: { w: number; h: number },
    bx: number, by: number,
  ) {
    const rank = footprintToRank(fp.w, fp.h);
    placeBuildingTiles(terrain, bx, by, fp.w, fp.h, rank);
    for (let bdy = 0; bdy < fp.h; bdy++) {
      for (let bdx = 0; bdx < fp.w; bdx++) {
        const idx = (by + bdy) * W + (bx + bdx);
        buildingGrid[idx] = 1;
        occupiedGrid[idx] = 1;
      }
    }
    const purpose = getBuildingPurpose(repo);
    buildings.push({
      repoMetrics: repo,
      rank, purpose,
      x: bx, y: by,
      width: fp.w, height: fp.h,
    });
  }

  // Step A: Find rectangular blocks of empty grass between roads.
  // Scan left-to-right, top-to-bottom. For each unvisited grass tile,
  // greedily expand right then down to find the largest rectangle.
  interface CityBlock { x: number; y: number; w: number; h: number; dist: number }
  const blockVisitGrid = new Uint8Array(W * H);
  const cityBlocks: CityBlock[] = [];

  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      const idx = y * W + x;
      if (blockVisitGrid[idx]) continue;
      if (terrain[y][x] !== baseTile) continue;
      if (occupiedGrid[idx]) continue;

      // Expand right
      let bw = 0;
      while (x + bw < W - 3 && terrain[y][x + bw] === baseTile && !occupiedGrid[y * W + (x + bw)] && !blockVisitGrid[y * W + (x + bw)]) {
        bw++;
      }
      // Expand down (ensuring full row width)
      let bh = 1;
      while (y + bh < H - 3) {
        let fullRow = true;
        for (let dx = 0; dx < bw; dx++) {
          const ti = (y + bh) * W + (x + dx);
          if (terrain[y + bh][x + dx] !== baseTile || occupiedGrid[ti] || blockVisitGrid[ti]) {
            fullRow = false; break;
          }
        }
        if (!fullRow) break;
        bh++;
      }
      // Mark visited
      for (let dy = 0; dy < bh; dy++) {
        for (let dx = 0; dx < bw; dx++) {
          blockVisitGrid[(y + dy) * W + (x + dx)] = 1;
        }
      }
      if (bw >= 3 && bh >= 3) {
        const dist = Math.abs(x + bw / 2 - midX) + Math.abs(y + bh / 2 - midY);
        cityBlocks.push({ x, y, w: bw, h: bh, dist });
      }
    }
  }

  // Sort blocks by distance to center for reference
  cityBlocks.sort((a, b) => a.dist - b.dist);

  // Step B: Build placement queue — larger buildings first
  const repoQueue = sortedRepos.slice(1).map((repo, idx) => ({
    repo,
    fp: footprints[idx + 1],
    area: footprints[idx + 1].w * footprints[idx + 1].h,
  }));
  repoQueue.sort((a, b) => b.area - a.area);
  let repoIdx = 0;

  // Step C: Distribute buildings across blocks to create neighborhoods.
  // Instead of packing all large buildings in the center, round-robin
  // across blocks so each block gets 1-3 repo buildings before the next.
  // This creates a realistic spread with big buildings anchoring
  // different parts of the city.

  // Separate big repos (anchors) from smaller ones
  const anchorThreshold = 16; // area >= 16 → anchor a neighborhood
  const anchors = repoQueue.filter(r => r.area >= anchorThreshold);
  const smallRepos = repoQueue.filter(r => r.area < anchorThreshold);

  // Distribute anchors one-per-block across the city
  const usableBlocks = cityBlocks.filter(b => b.w >= 4 && b.h >= 4);
  for (let ai = 0; ai < anchors.length && usableBlocks.length > 0; ai++) {
    const blockIdx = ai % usableBlocks.length;
    const block = usableBlocks[blockIdx];
    const { repo, fp } = anchors[ai];

    // Try center of block first, then scan for a fit
    let placed = false;
    const bCenterX = block.x + Math.floor((block.w - fp.w) / 2);
    const bCenterY = block.y + Math.floor((block.h - fp.h) / 2);
    if (canPlace(bCenterX, bCenterY, fp.w, fp.h)) {
      commitBuilding(repo, fp, bCenterX, bCenterY);
      placed = true;
    } else {
      // Scan block for any valid position
      for (let sy = block.y; sy + fp.h <= block.y + block.h && !placed; sy++) {
        for (let sx = block.x; sx + fp.w <= block.x + block.w && !placed; sx++) {
          if (canPlace(sx, sy, fp.w, fp.h)) {
            commitBuilding(repo, fp, sx, sy);
            placed = true;
          }
        }
      }
    }
    if (!placed) {
      // Couldn't fit in this block — push back to small repos for spiral fallback
      smallRepos.push(anchors[ai]);
    }
  }

  // Fill remaining small repo buildings across blocks, round-robin style
  // Each block gets at most 2-3 buildings per pass to spread them out
  let smallIdx = 0;
  const maxPerBlock = 3;
  for (let pass = 0; pass < 4 && smallIdx < smallRepos.length; pass++) {
    for (const block of cityBlocks) {
      if (smallIdx >= smallRepos.length) break;
      let placedInBlock = 0;

      let curY = block.y;
      while (curY + 3 <= block.y + block.h && smallIdx < smallRepos.length && placedInBlock < maxPerBlock) {
        let curX = block.x;
        let rowMaxH = 3;

        while (curX + 3 <= block.x + block.w && smallIdx < smallRepos.length && placedInBlock < maxPerBlock) {
          const { repo, fp } = smallRepos[smallIdx];

          if (curX + fp.w <= block.x + block.w &&
              curY + fp.h <= block.y + block.h &&
              canPlace(curX, curY, fp.w, fp.h)) {
            commitBuilding(repo, fp, curX, curY);
            rowMaxH = Math.max(rowMaxH, fp.h);
            curX += fp.w;
            smallIdx++;
            placedInBlock++;
            continue;
          }

          // Try next few in queue for a smaller fit
          let fitted = false;
          for (let j = smallIdx + 1; j < smallRepos.length && j < smallIdx + 8; j++) {
            const alt = smallRepos[j];
            if (curX + alt.fp.w <= block.x + block.w &&
                curY + alt.fp.h <= block.y + block.h &&
                canPlace(curX, curY, alt.fp.w, alt.fp.h)) {
              commitBuilding(alt.repo, alt.fp, curX, curY);
              rowMaxH = Math.max(rowMaxH, alt.fp.h);
              curX += alt.fp.w;
              smallRepos.splice(j, 1);
              placedInBlock++;
              fitted = true;
              break;
            }
          }
          if (!fitted) curX++;
        }
        curY += rowMaxH;
      }
    }
  }

  // Fallback: spiral placement for any remaining buildings
  while (smallIdx < smallRepos.length) {
    const { repo, fp } = smallRepos[smallIdx];
    let placed = false;
    for (let r = 2; r < Math.floor(W / 2) && !placed; r++) {
      for (let dy = -r; dy <= r && !placed; dy++) {
        for (let dx = -r; dx <= r && !placed; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const bx = midX + dx, by = midY + dy;
          if (!canPlace(bx, by, fp.w, fp.h)) continue;
          commitBuilding(repo, fp, bx, by);
          placed = true;
        }
      }
    }
    smallIdx++;
  }

  // Step D: FILLER COTTAGES — fill remaining empty blocks with generic homes.
  // In a real medieval city most buildings are unnamed commoner homes.
  // Use varied footprints so the variation engine picks from all small templates
  // (3×3 cottage, 3×5 guild, 4×4 guild) — not just one size.
  // Scan from center outward for natural density gradient.
  // PERF: Cap passes to prevent runaway on large grids (200×200 = 40K candidates).

  let fillerCount = 0;
  const MAX_FILLER_PASSES = 20;

  // Filler footprints in priority order — try larger first for variety,
  // fall back to smaller to fill tight gaps.
  const FILLER_FOOTPRINTS = [
    { w: 4, h: 4 },  // guild — matches hovel1-style templates
    { w: 3, h: 5 },  // guild — matches home3/red-cottage style templates
    { w: 3, h: 3 },  // cottage — smallest, fills remaining gaps
  ];
  const maxFillerSide = 5; // largest dimension in FILLER_FOOTPRINTS

  // Build a list of candidate positions. Use distance bands to create
  // a more even spread with clusters (neighborhoods) rather than
  // pure center-outward fill.
  const fillerCandidates: { x: number; y: number }[] = [];
  for (let y = 3; y < H - 3 - maxFillerSide; y++) {
    for (let x = 3; x < W - 3 - maxFillerSide; x++) {
      fillerCandidates.push({ x, y });
    }
  }
  // Sort by distance bands (rings) — within each band, positions are interleaved
  // so buildings spread across all quadrants of the city evenly
  const maxDist = Math.abs(midX) + Math.abs(midY);
  const bandSize = Math.max(4, Math.floor(maxDist / 6));
  fillerCandidates.sort((a, b) => {
    const distA = Math.abs(a.x + 1 - midX) + Math.abs(a.y + 1 - midY);
    const distB = Math.abs(b.x + 1 - midX) + Math.abs(b.y + 1 - midY);
    const bandA = Math.floor(distA / bandSize);
    const bandB = Math.floor(distB / bandSize);
    if (bandA !== bandB) return bandA - bandB;
    // Within same band, alternate quadrants for even spread
    const quadA = (a.x < midX ? 0 : 1) + (a.y < midY ? 0 : 2);
    const quadB = (b.x < midX ? 0 : 1) + (b.y < midY ? 0 : 2);
    return quadA - quadB;
  });

  // Simple deterministic shuffle helper — vary which footprint we try first
  // at each candidate so we get a mix of sizes, not all 4×4 then all 3×5.
  let fillerSeed = 0;

  // Multiple passes — each new building creates adjacency for the next wave.
  // Stop when a full pass adds nothing OR we hit the pass cap.
  let fillerChanged = true;
  let fillerPass = 0;
  while (fillerChanged && fillerPass < MAX_FILLER_PASSES) {
    fillerChanged = false;
    fillerPass++;
    for (const fc of fillerCandidates) {
      const { x, y } = fc;

      // Try each footprint size, starting at a rotating offset for variety
      let placed = false;
      const startIdx = (fillerSeed++) % FILLER_FOOTPRINTS.length;
      for (let fi = 0; fi < FILLER_FOOTPRINTS.length; fi++) {
        const fp = FILLER_FOOTPRINTS[(startIdx + fi) % FILLER_FOOTPRINTS.length];
        if (!canPlace(x, y, fp.w, fp.h)) continue;

        // Place if adjacent to a road OR another building (buildings grow clusters)
        let adjacent = false;
        checkAdj:
        for (let ey = -1; ey <= fp.h; ey++) {
          for (let ex = -1; ex <= fp.w; ex++) {
            if (ex >= 0 && ex < fp.w && ey >= 0 && ey < fp.h) continue; // skip interior
            const rx = x + ex, ry = y + ey;
            if (rx >= 0 && rx < W && ry >= 0 && ry < H) {
              if (roadGrid[ry * W + rx] || buildingGrid[ry * W + rx]) {
                adjacent = true;
                break checkAdj;
              }
            }
          }
        }
        if (!adjacent) continue;

        const rank = footprintToRank(fp.w, fp.h);
        placeBuildingTiles(terrain, x, y, fp.w, fp.h, rank);
        for (let bdy = 0; bdy < fp.h; bdy++) {
          for (let bdx = 0; bdx < fp.w; bdx++) {
            const idx = (y + bdy) * W + (x + bdx);
            buildingGrid[idx] = 1;
            occupiedGrid[idx] = 1;
          }
        }
        buildings.push({
          rank,
          purpose: 'general' as BuildingPurpose,
          x, y,
          width: fp.w, height: fp.h,
          isPublic: true,
          publicName: '',  // unnamed commoner home — no label
        });
        fillerCount++;
        fillerChanged = true;
        placed = true;
        break; // placed this candidate, move on
      }
    }
  }

  console.log(`[CityGenerator] ${kingdom.language}: ${sortedRepos.length} repos → ${buildings.length} buildings (${fillerCount} filler, ${fillerPass} passes) in ${W}×${H} city (${roadCount} road tiles, ${cityBlocks.length} blocks)`);

  // ── 6. Connect any disconnected buildings to nearest road ──
  for (const b of buildings) {
    const doorX = b.x + Math.floor(b.width / 2);
    const doorY = b.y + b.height;

    let alreadyConnected = false;
    for (let cy = b.y - 1; cy <= b.y + b.height && !alreadyConnected; cy++) {
      for (let cx = b.x - 1; cx <= b.x + b.width && !alreadyConnected; cx++) {
        if (cx >= 0 && cx < W && cy >= 0 && cy < H && terrain[cy][cx] === TILES.ROAD) {
          alreadyConnected = true;
        }
      }
    }
    if (alreadyConnected) continue;

    let nearX = -1, nearY = -1, nearDist = Infinity;
    for (let sy = Math.max(2, doorY - 20); sy < Math.min(H - 2, doorY + 20); sy++) {
      for (let sx = Math.max(2, doorX - 20); sx < Math.min(W - 2, doorX + 20); sx++) {
        if (terrain[sy][sx] === TILES.ROAD) {
          const d = Math.abs(sx - doorX) + Math.abs(sy - doorY);
          if (d < nearDist) { nearDist = d; nearX = sx; nearY = sy; }
        }
      }
    }

    if (nearX >= 0) {
      let px = doorX, py = doorY;
      const hdir = nearX > px ? 1 : -1;
      while (px !== nearX) { drawRoad(px, py); px += hdir; }
      const vdir = nearY > py ? 1 : -1;
      while (py !== nearY) { drawRoad(px, py); py += vdir; }
    }
  }

  // ── 7. Prune dead-end road stubs ──
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 3; y < H - 3; y++) {
      for (let x = 3; x < W - 3; x++) {
        if (terrain[y][x] !== TILES.ROAD) continue;
        let roadNeighbors = 0;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const t = terrain[y + dy][x + dx];
          if (t === TILES.ROAD || t === TILES.CASTLE_GATE) roadNeighbors++;
        }
        let nearBuilding = false;
        for (let dy = -1; dy <= 1 && !nearBuilding; dy++) {
          for (let dx = -1; dx <= 1 && !nearBuilding; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < W && ny >= 0 && ny < H && buildingGrid[ny * W + nx]) nearBuilding = true;
          }
        }
        if (roadNeighbors <= 1 && !nearBuilding) {
          terrain[y][x] = baseTile;
          changed = true;
        }
      }
    }
  }

  // ── 8. Scatter biome decorations on empty tiles ──
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      if (terrain[y][x] !== baseTile) continue;
      const r = rand();
      if (kingdom.biome === 'forest' && r < 0.15) terrain[y][x] = TILES.FOREST;
      if (kingdom.biome === 'volcanic' && r < 0.05) terrain[y][x] = TILES.LAVA;
      if (kingdom.biome === 'crystal' && r < 0.08) terrain[y][x] = TILES.CRYSTAL;
    }
  }

  // ── 9. Replace plain grass with city grass variants (town_A sprites) ──
  // Uses detailed grass textures from town_A spritesheet for a polished town look
  const cityGrassTiles = [
    TILES.CITY_GRASS_1, TILES.CITY_GRASS_2, TILES.CITY_GRASS_3,
    TILES.CITY_GRASS_4, TILES.CITY_GRASS_5, TILES.CITY_GRASS_6,
  ];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (terrain[y][x] === TILES.GRASS || terrain[y][x] === TILES.GRASS_DARK) {
        terrain[y][x] = cityGrassTiles[Math.floor(rand() * cityGrassTiles.length)];
      }
    }
  }

  // ── Aggregate citizens ──
  const citizens = aggregateCitizens(kingdom.repos, kingdom.language);

  return {
    language: kingdom.language,
    biome: kingdom.biome,
    width: W,
    height: H,
    terrain,
    buildings,
    citizens,
    king: kingdom.king,
    totalStars: kingdom.totalStars,
    totalRepos: kingdom.repos.length,
  };
}

// ─── Place building tiles on terrain (generic for any size) ──
function placeBuildingTiles(
  terrain: number[][],
  bx: number, by: number,
  bw: number, bh: number,
  rank: BuildingRank,
) {
  const H = terrain.length;
  const W = terrain[0].length;
  const safe = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H;

  // Small buildings (cottages/guilds): just mark as house tiles, no fortress walls
  // Large buildings (keep+): walls on edges, towers on corners
  const isLarge = rank === 'citadel' || rank === 'castle' || rank === 'palace' || rank === 'keep';

  for (let dy = 0; dy < bh; dy++) {
    for (let dx = 0; dx < bw; dx++) {
      if (!safe(bx + dx, by + dy)) continue;
      const isCorner = (dx === 0 || dx === bw - 1) && (dy === 0 || dy === bh - 1);
      const isEdge = dx === 0 || dx === bw - 1 || dy === 0 || dy === bh - 1;
      const isGate = dx === Math.floor(bw / 2) && dy === bh - 1;

      if (isLarge) {
        // Large buildings get fortress-style walls
        if (isGate) {
          terrain[by + dy][bx + dx] = TILES.CASTLE_GATE;
        } else if (isCorner && bw >= 4) {
          terrain[by + dy][bx + dx] = TILES.CASTLE_TOWER;
        } else if (isEdge) {
          terrain[by + dy][bx + dx] = TILES.CASTLE_WALL;
        } else {
          terrain[by + dy][bx + dx] = TILES.CASTLE_ROOF;
        }
      } else {
        // Small buildings — just fill with house tile (no walled compound)
        terrain[by + dy][bx + dx] = TILES.HOUSE_LARGE;
      }
    }
  }

  // Banner above gate for larger buildings only
  if (isLarge && bw >= 5) {
    const bannerX = bx + Math.floor(bw / 2);
    const bannerY = by - 1;
    if (safe(bannerX, bannerY)) terrain[bannerY][bannerX] = TILES.BANNER;
  }
}

// ═════════════════════════════════════════════════════════════
// POST-HOC: Add public/civic buildings into an existing city
// Called after async template loading completes.
// ═════════════════════════════════════════════════════════════

const CIVIC_NAMES = [
  'Fountain', 'Town Square', 'Market Plaza', 'Well',
  'Monument', 'Garden', 'Shrine', 'Clock Tower',
  'Statue', 'Pavilion', 'Courtyard', 'Bell Tower',
];

export function placePublicBuildings(
  city: CityInterior,
  publicVariants: TemplateVariant[],
): CityBuilding[] {
  if (publicVariants.length === 0) return [];

  const { width: W, height: H, terrain, buildings } = city;
  const rand = mulberry32(W * 137 + H * 31 + buildings.length);

  // Rebuild occupied grid from existing buildings + non-base terrain
  // PERF: Flat Uint8Array instead of string-keyed Set
  const occGrid = new Uint8Array(W * H);
  const baseTile = terrain[3]?.[3] ?? TILES.GRASS;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (terrain[y][x] !== baseTile) occGrid[y * W + x] = 1;
    }
  }
  // Also mark existing building footprints + 1-tile buffer
  for (const b of buildings) {
    for (let dy = -1; dy <= b.height; dy++) {
      for (let dx = -1; dx <= b.width; dx++) {
        const px = b.x + dx, py = b.y + dy;
        if (px >= 0 && px < W && py >= 0 && py < H) occGrid[py * W + px] = 1;
      }
    }
  }

  function canPlace(bx: number, by: number, bw: number, bh: number): boolean {
    if (bx < 2 || bx + bw > W - 2 || by < 2 || by + bh > H - 2) return false;
    for (let dy = 0; dy < bh; dy++) {
      for (let dx = 0; dx < bw; dx++) {
        if (occGrid[(by + dy) * W + (bx + dx)]) return false;
      }
    }
    return true;
  }

  function markOccupied(bx: number, by: number, bw: number, bh: number) {
    for (let dy = -1; dy <= bh; dy++) {
      for (let dx = -1; dx <= bw; dx++) {
        const px = bx + dx, py = by + dy;
        if (px >= 0 && px < W && py >= 0 && py < H) occGrid[py * W + px] = 1;
      }
    }
  }

  const midX = Math.floor(W / 2);
  const midY = Math.floor(H / 2);
  const repoCount = buildings.filter(b => !b.isPublic).length;

  // Scale civic count: more repos → more civic buildings
  const civicCount = Math.min(
    publicVariants.length * 2,
    Math.floor(repoCount * 0.4) + 2,
  );

  const added: CityBuilding[] = [];

  for (let c = 0; c < civicCount; c++) {
    const variant = publicVariants[c % publicVariants.length];
    const rank = footprintToRank(variant.width, variant.height);
    // Use the template's actual dimensions for placement
    const pw = variant.width;
    const ph = variant.height;

    // Scatter throughout the city, prefer road-adjacent spots
    const angle = (c * 2.7) + rand() * 1.2;
    const dist = 5 + rand() * (W * 0.35);
    const tx = midX + Math.round(Math.cos(angle) * dist);
    const ty = midY + Math.round(Math.sin(angle) * dist);

    // Spiral search for placement
    let placed = false;
    for (let r = 0; r < 20 && !placed; r++) {
      for (let dy = -r; dy <= r && !placed; dy++) {
        for (let dx = -r; dx <= r && !placed; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const bx = tx + dx, by = ty + dy;
          if (!canPlace(bx, by, pw, ph)) continue;

          // Prefer spots near roads
          let nearRoad = false;
          for (let cy = -1; cy <= ph && !nearRoad; cy++) {
            for (let cx = -1; cx <= pw && !nearRoad; cx++) {
              const rx = bx + cx, ry = by + cy;
              if (rx >= 0 && rx < W && ry >= 0 && ry < H && terrain[ry][rx] === TILES.ROAD) {
                nearRoad = true;
              }
            }
          }
          if (!nearRoad && r < 10) continue;

          markOccupied(bx, by, pw, ph);

          const building: CityBuilding = {
            rank,
            purpose: 'general' as BuildingPurpose,
            x: bx,
            y: by,
            width: pw,
            height: ph,
            isPublic: true,
            publicName: CIVIC_NAMES[c % CIVIC_NAMES.length],
            templateKey: variant.textureKey,
          };
          buildings.push(building);
          added.push(building);
          placed = true;
        }
      }
    }
  }

  console.log(`[CityGenerator] Placed ${added.length} civic buildings`);
  return added;
}
