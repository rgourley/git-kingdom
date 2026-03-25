import { LanguageKingdom, KingdomMetrics, SettlementTier, Biome, TILES, COAST_BITMASK, SHORE_BITMASK, isWaterTile, isSandTile, isWalkable } from '../types';

// ─── Noise ─────────────────────────────────────────────────────
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createNoise(seed: number) {
  const rand = mulberry32(seed);
  const S = 256;
  const grid: number[] = [];
  for (let i = 0; i < S * S; i++) grid.push(rand());

  function smooth(x: number, y: number): number {
    const ix = Math.floor(x) & (S - 1);
    const iy = Math.floor(y) & (S - 1);
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const ix1 = (ix + 1) & (S - 1);
    const iy1 = (iy + 1) & (S - 1);
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = grid[iy * S + ix] + sx * (grid[iy * S + ix1] - grid[iy * S + ix]);
    const bot = grid[iy1 * S + ix] + sx * (grid[iy1 * S + ix1] - grid[iy1 * S + ix]);
    return top + sy * (bot - top);
  }

  return (x: number, y: number, octaves = 4): number => {
    let val = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      val += smooth(x * freq, y * freq) * amp;
      max += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return val / max;
  };
}

// ─── Types ─────────────────────────────────────────────────────
export interface WorldSettlement {
  repoMetrics: KingdomMetrics;
  tier: SettlementTier;
  mayor: { login: string; contributions: number } | null; // top contributor to THIS repo
  x: number;  // tile position on map
  y: number;
  kingdomIndex: number; // which kingdom this belongs to
}

export interface WorldKingdom {
  index: number;
  language: string;
  biome: Biome;
  king: { login: string; contributions: number; avatar_url: string } | null;
  totalCommits: number;
  totalStars: number;
  settlements: WorldSettlement[];
  centerX: number;
  centerY: number;
  centroidX: number;
  centroidY: number;
  targetArea: number; // total land tiles this kingdom wants
}

export interface WorldData {
  width: number;
  height: number;
  terrain: number[][];
  ownership: number[][];   // -1 = ocean/unclaimed
  kingdoms: WorldKingdom[];
  settlements: WorldSettlement[];
  collision: boolean[][];
}

// ─── Settlement tier from repo metrics ─────────────────────────
function getSettlementTier(m: KingdomMetrics): SettlementTier {
  const stars = m.repo.stargazers_count;
  if (stars >= 50000) return 'capital';
  if (stars >= 10000) return 'city';
  if (stars >= 1000) return 'town';
  if (stars >= 100) return 'village';
  if (stars >= 10) return 'hamlet';
  return 'camp';
}

// Land tiles per settlement tier (for building placement)
const settlementArea: Record<SettlementTier, number> = {
  camp: 10,
  hamlet: 20,
  village: 50,
  town: 120,
  city: 300,
  capital: 600,
};

// Base kingdom area per settlement (kingdom territory = sum of settlement areas * multiplier)
const KINGDOM_AREA_MULTIPLIER = 5; // territory is much bigger than just settlements

const MAX_PER_CONTINENT = 20;

// ═══════════════════════════════════════════════════════════════
// STEP 1: Generate landmass (geology first!)
// ═══════════════════════════════════════════════════════════════
function generateLandmass(W: number, H: number, numContinents: number): boolean[][] {
  const land: boolean[][] = Array.from({ length: H }, () => Array(W).fill(false));
  const elevation = createNoise(1111);
  const detail = createNoise(2222);

  const rand = mulberry32(7777);
  const centers: { x: number; y: number; r: number }[] = [];

  if (numContinents === 1) {
    centers.push({ x: W / 2, y: H / 2, r: Math.min(W, H) * 0.42 });
  } else {
    for (let i = 0; i < numContinents; i++) {
      const angle = (Math.PI * 2 * i) / numContinents;
      const dist = Math.min(W, H) * 0.22;
      centers.push({
        x: W / 2 + Math.cos(angle) * dist,
        y: H / 2 + Math.sin(angle) * dist,
        r: Math.min(W, H) * 0.32,
      });
    }
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let minNormDist = Infinity;
      for (const c of centers) {
        const dx = x - c.x, dy = y - c.y;
        const dist = Math.sqrt(dx * dx + dy * dy) / c.r;
        if (dist < minNormDist) minNormDist = dist;
      }

      const e = elevation(x * 0.025, y * 0.025, 4);
      const d = detail(x * 0.06, y * 0.06, 3) * 0.3;
      const threshold = minNormDist * 0.9 - d;
      land[y][x] = (e + 0.15) > threshold;

      const edgeX = Math.min(x, W - 1 - x);
      const edgeY = Math.min(y, H - 1 - y);
      if (Math.min(edgeX, edgeY) < 4) land[y][x] = false;
    }
  }

  // Smooth with cellular automata (2 passes)
  for (let iter = 0; iter < 2; iter++) {
    const copy = land.map(r => [...r]);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (copy[y + dy][x + dx]) neighbors++;
        land[y][x] = neighbors >= 5;
      }
    }
  }

  return land;
}

// ═══════════════════════════════════════════════════════════════
// STEP 2: Generate elevation map on land
// ═══════════════════════════════════════════════════════════════
function generateElevation(land: boolean[][], W: number, H: number): number[][] {
  const noise = createNoise(3333);
  const ridgeNoise = createNoise(4444);
  const elev: number[][] = Array.from({ length: H }, () => Array(W).fill(0));

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!land[y][x]) continue;

      const e = noise(x * 0.03, y * 0.03, 4);
      const ridge = 1.0 - Math.abs(ridgeNoise(x * 0.02, y * 0.02, 3) * 2 - 1);

      let coastDist = 0;
      for (let r = 1; r <= 15; r++) {
        let foundOcean = false;
        for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H || !land[ny][nx]) {
            foundOcean = true;
            break;
          }
        }
        if (foundOcean) { coastDist = r; break; }
      }
      if (coastDist === 0) coastDist = 15;
      const coastFactor = Math.min(1.0, coastDist / 12);

      elev[y][x] = (e * 0.5 + ridge * 0.3 + coastFactor * 0.2);
    }
  }

  return elev;
}

// ═══════════════════════════════════════════════════════════════
// STEP 2.5: Stamp a separate island for the "Uncharted" kingdom
// ═══════════════════════════════════════════════════════════════
function stampUnchartedIsland(
  land: boolean[][], W: number, H: number,
  kingdom: WorldKingdom,
): void {
  const noise = createNoise(9999);
  const margin = 8;

  // Find the ocean spot farthest from any land — that's where our island goes
  let bestX = margin, bestY = margin, bestMinDist = 0;

  for (let y = margin; y < H - margin; y += 3) {
    for (let x = margin; x < W - margin; x += 3) {
      if (land[y][x]) continue;

      // Measure distance to nearest land tile (scan outward)
      let minDist = 30; // cap at 30 — beyond that is all equally good
      outer: for (let r = 1; r <= 30; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < W && ny >= 0 && ny < H && land[ny][nx]) {
              minDist = r;
              break outer;
            }
          }
        }
      }

      // Prefer bottom half of map so the island isn't hidden behind the game header
      const topPenalty = y < H * 0.35 ? 0.5 : 1.0;
      const score = minDist * topPenalty;
      if (score > bestMinDist) {
        bestMinDist = score;
        bestX = x;
        bestY = y;
      }
    }
  }

  // Stamp an irregular island shape using noise for natural coastline
  const targetRadius = Math.max(10, Math.ceil(Math.sqrt(kingdom.targetArea / Math.PI)));
  for (let dy = -targetRadius; dy <= targetRadius; dy++) {
    for (let dx = -targetRadius; dx <= targetRadius; dx++) {
      const nx = bestX + dx, ny = bestY + dy;
      if (nx < 2 || nx >= W - 2 || ny < 2 || ny >= H - 2) continue;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const n = noise(nx * 0.1, ny * 0.1, 3);
      const adjustedR = targetRadius * (0.6 + n * 0.5); // irregular coastline
      if (dist <= adjustedR) {
        land[ny][nx] = true;
      }
    }
  }

  // Pre-set the kingdom center to the island center
  kingdom.centerX = bestX;
  kingdom.centerY = bestY;
}

// ═══════════════════════════════════════════════════════════════
// STEP 3: Place kingdom seeds on land, then flood-fill grow
// ═══════════════════════════════════════════════════════════════
function placeAndGrowKingdoms(
  kingdoms: WorldKingdom[],
  land: boolean[][],
  elev: number[][],
  W: number, H: number
): number[][] {
  const ownership: number[][] = Array.from({ length: H }, () => Array(W).fill(-1));
  const rand = mulberry32(5555);

  const landTiles: [number, number][] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (land[y][x]) landTiles.push([x, y]);

  if (landTiles.length === 0) return ownership;

  // Separate pre-placed island kingdoms (Uncharted) from continent kingdoms
  const isPrePlaced = (k: WorldKingdom) => k.language === 'Uncharted';
  const toPlace = kingdoms.filter(k => !isPrePlaced(k));
  const prePlaced = kingdoms.filter(k => isPrePlaced(k));

  // Place continent kingdom seeds via farthest-point sampling
  if (toPlace.length > 0) {
    const cx = W / 2, cy = H / 2;
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < landTiles.length; i++) {
      const [lx, ly] = landTiles[i];
      const d = Math.abs(lx - cx) + Math.abs(ly - cy);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    toPlace[0].centerX = landTiles[bestIdx][0];
    toPlace[0].centerY = landTiles[bestIdx][1];

    for (let ki = 1; ki < toPlace.length; ki++) {
      let farthestIdx = 0, farthestMin = 0;
      // Consider both already-placed continent kingdoms AND pre-placed island kingdoms
      const allPlaced = [...toPlace.slice(0, ki), ...prePlaced];
      for (let i = 0; i < landTiles.length; i++) {
        const [lx, ly] = landTiles[i];
        let minDist = Infinity;
        for (const pk of allPlaced) {
          const dx = lx - pk.centerX;
          const dy = ly - pk.centerY;
          minDist = Math.min(minDist, dx * dx + dy * dy);
        }
        const jitter = rand() * 200;
        if (minDist + jitter > farthestMin) {
          farthestMin = minDist + jitter;
          farthestIdx = i;
        }
      }
      toPlace[ki].centerX = landTiles[farthestIdx][0];
      toPlace[ki].centerY = landTiles[farthestIdx][1];
    }
  }

  // Seed ownership
  for (const k of kingdoms) {
    ownership[k.centerY][k.centerX] = k.index;
  }

  // Flood-fill growth
  const queues: [number, number][][] = kingdoms.map(() => []);
  for (const k of kingdoms) {
    queues[k.index].push([k.centerX, k.centerY]);
  }

  const tileCounts = new Int32Array(kingdoms.length);
  const targetTiles = kingdoms.map(k => k.targetArea);

  const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  let changed = true;
  let maxIter = W * H;

  while (changed && maxIter-- > 0) {
    changed = false;

    for (const k of kingdoms) {
      if (tileCounts[k.index] >= targetTiles[k.index]) continue;
      if (queues[k.index].length === 0) continue;

      // Grow proportionally but cap batch size so small kingdoms aren't starved
      const batch = Math.max(1, Math.min(5, Math.ceil(targetTiles[k.index] / 50)));
      for (let b = 0; b < batch && queues[k.index].length > 0; b++) {
        const [fx, fy] = queues[k.index].shift()!;

        for (const [dx, dy] of dirs) {
          const nx = fx + dx, ny = fy + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          if (!land[ny][nx]) continue;
          if (ownership[ny][nx] >= 0) continue;

          const elevCost = elev[ny][nx] > 0.7 ? 3 : 1;
          if (rand() < 0.3 / elevCost) continue;

          ownership[ny][nx] = k.index;
          tileCounts[k.index]++;
          queues[k.index].push([nx, ny]);
          changed = true;
        }
      }
    }
  }

  // Assign remaining unclaimed land
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!land[y][x] || ownership[y][x] >= 0) continue;
      let bestK = 0, bestD = Infinity;
      for (const k of kingdoms) {
        const dx = x - k.centerX, dy = y - k.centerY;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bestK = k.index; }
      }
      ownership[y][x] = bestK;
    }
  }

  return ownership;
}

// ═══════════════════════════════════════════════════════════════
// STEP 4: Generate terrain tiles from elevation + biome
// ═══════════════════════════════════════════════════════════════
function generateTerrain(
  kingdoms: WorldKingdom[],
  own: number[][],
  land: boolean[][],
  elev: number[][],
  W: number, H: number
): number[][] {
  const moisture = createNoise(6666);
  const terrain: number[][] = [];

  for (let y = 0; y < H; y++) {
    const row: number[] = [];
    for (let x = 0; x < W; x++) {
      if (!land[y][x]) {
        row.push(TILES.WATER_DEEP);
        continue;
      }

      const k = own[y][x];
      const e = elev[y][x];
      const m = moisture(x * 0.04, y * 0.04, 3);

      if (k >= 0) {
        row.push(biomeTerrainTile(kingdoms[k].biome, e, m));
      } else {
        row.push(elevationTile(e, m));
      }
    }
    terrain.push(row);
  }

  // Coastline gradient
  const isLand = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H && land[y][x];
  const isOcean = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H && !land[y][x];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (land[y][x]) {
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          if (isOcean(x + dx, y + dy)) { terrain[y][x] = TILES.SAND; break; }
        }
      } else {
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          if (isLand(x + dx, y + dy)) { terrain[y][x] = TILES.WATER; break; }
        }
      }
    }
  }

  return terrain;
}

function biomeTerrainTile(biome: Biome, e: number, m: number): number {
  // Only show mountain peaks at very high elevation, no "snow" for most biomes
  if (e > 0.82) return TILES.MOUNTAIN;

  switch (biome) {
    case 'grassland':
      if (e > 0.72) return TILES.GRASS_DARK;
      return m > 0.7 ? TILES.FOREST : m > 0.55 ? TILES.GRASS_DARK : TILES.GRASS;
    case 'forest':
      if (e > 0.72) return TILES.GRASS_DARK;
      return m > 0.45 ? TILES.FOREST : m > 0.3 ? TILES.GRASS_DARK : TILES.GRASS;
    case 'mountain':
      if (e > 0.72) return TILES.MOUNTAIN;
      return e > 0.5 ? TILES.GRASS_DARK : TILES.GRASS;
    case 'volcanic':
      return e > 0.55 ? TILES.LAVA : e > 0.4 ? TILES.MOUNTAIN : TILES.GRASS_DARK;
    case 'crystal':
      return m > 0.55 ? TILES.CRYSTAL : TILES.GRASS_DARK;
    case 'desert':
      return m > 0.65 ? TILES.MOUNTAIN : TILES.SAND;
    case 'tundra':
      if (e > 0.72) return TILES.MOUNTAIN;
      return m > 0.5 ? TILES.SNOW : TILES.GRASS_DARK;
    case 'mist':
      // Foggy, dark terrain — mostly dark grass with patches of forest
      return m > 0.6 ? TILES.FOREST : TILES.GRASS_DARK;
    default:
      return TILES.GRASS;
  }
}

function elevationTile(e: number, m: number): number {
  if (e > 0.7) return TILES.MOUNTAIN;
  if (e > 0.55) return TILES.GRASS_DARK;
  return m > 0.5 ? TILES.FOREST : TILES.GRASS;
}

// ═══════════════════════════════════════════════════════════════
// STEP 5: Place settlements within kingdom territories
// ═══════════════════════════════════════════════════════════════
function computeCentroids(kingdoms: WorldKingdom[], own: number[][], W: number, H: number) {
  const sums = kingdoms.map(() => ({ sx: 0, sy: 0, count: 0 }));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = own[y][x];
      if (k >= 0) { sums[k].sx += x; sums[k].sy += y; sums[k].count++; }
    }
  for (const k of kingdoms) {
    const s = sums[k.index];
    if (s.count > 0) {
      k.centroidX = Math.round(s.sx / s.count);
      k.centroidY = Math.round(s.sy / s.count);
    } else {
      k.centroidX = k.centerX;
      k.centroidY = k.centerY;
    }
  }
}

function isBuilding(tile: number): boolean {
  return tile >= TILES.ROAD;
}

// Place the settlement's castle/buildings at a given location
function placeSettlementBuildings(
  terrain: number[][], own: number[][],
  s: WorldSettlement, W: number, H: number
) {
  const safe = (x: number, y: number) =>
    x >= 0 && x < W && y >= 0 && y < H && own[y][x] === s.kingdomIndex && !isBuilding(terrain[y][x]);
  const set = (x: number, y: number, tile: number) => {
    if (safe(x, y)) terrain[y][x] = tile;
  };

  const cx = s.x, cy = s.y;

  if (s.tier === 'capital') {
    // Large castle complex — represents a major language city
    // 5×5 castle core with towers, walls, courtyard
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const isCorner = Math.abs(dx) === 2 && Math.abs(dy) === 2;
        const isEdge = Math.abs(dx) === 2 || Math.abs(dy) === 2;
        const isGate = dx === 0 && dy === 2;
        if (isGate) set(cx + dx, cy + dy, TILES.CASTLE_GATE);
        else if (isCorner) set(cx + dx, cy + dy, TILES.CASTLE_TOWER);
        else if (isEdge) set(cx + dx, cy + dy, TILES.CASTLE_WALL);
        else set(cx + dx, cy + dy, TILES.CASTLE_ROOF);
      }
    }
    set(cx, cy - 3, TILES.BANNER);
    set(cx + 3, cy + 1, TILES.MARKET);
    set(cx - 3, cy - 1, TILES.CHURCH);
    set(cx, cy + 3, TILES.ROAD);
    // Surrounding houses — the "city" around the castle
    for (const [dx, dy] of [[-3, 1], [3, -1], [-1, 3], [1, 3], [4, 0], [-4, 0],
      [-3, -2], [3, 2], [-2, 4], [2, 4], [4, -2], [-4, 2]]) {
      set(cx + dx, cy + dy, TILES.HOUSE);
    }
    for (const [dx, dy] of [[-3, 3], [3, 3], [-4, -1], [4, 1]]) {
      set(cx + dx, cy + dy, TILES.HOUSE_LARGE);
    }
    set(cx, cy + 4, TILES.MONUMENT);
  } else if (s.tier === 'city') {
    // Medium castle complex
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const isCorner = Math.abs(dx) === 1 && Math.abs(dy) === 1;
        if (isCorner) set(cx + dx, cy + dy, TILES.CASTLE_TOWER);
        else if (dx === 0 && dy === 0) set(cx, cy, TILES.CASTLE_ROOF);
        else set(cx + dx, cy + dy, TILES.CASTLE_WALL);
      }
    }
    set(cx, cy + 2, TILES.CASTLE_GATE);
    set(cx + 2, cy, TILES.MARKET);
    set(cx - 2, cy, TILES.CHURCH);
    for (const [dx, dy] of [[-2, 1], [2, -1], [-1, 2], [1, 2], [3, 0], [-3, 0]]) {
      set(cx + dx, cy + dy, TILES.HOUSE);
    }
    for (const [dx, dy] of [[-2, 2], [2, 2]]) {
      set(cx + dx, cy + dy, TILES.HOUSE_LARGE);
    }
  } else if (s.tier === 'town') {
    set(cx, cy, TILES.CASTLE_TOWER);
    set(cx, cy + 1, TILES.CASTLE_GATE);
    set(cx + 1, cy, TILES.CASTLE_WALL);
    set(cx - 1, cy, TILES.CASTLE_WALL);
    set(cx + 2, cy + 1, TILES.MARKET);
    for (const [dx, dy] of [[-1, -1], [1, -1], [2, 0], [-2, 0]]) {
      set(cx + dx, cy + dy, TILES.HOUSE);
    }
  } else if (s.tier === 'village') {
    set(cx, cy, TILES.HOUSE_LARGE);
    set(cx + 1, cy, TILES.HOUSE);
    set(cx - 1, cy + 1, TILES.HOUSE);
  } else if (s.tier === 'hamlet') {
    set(cx, cy, TILES.HOUSE_LARGE);
    set(cx + 1, cy, TILES.HOUSE);
  } else {
    // Camp — small language with few repos
    set(cx, cy, TILES.HOUSE);
    set(cx, cy - 1, TILES.BANNER);
  }
}

// Find a valid placement spot near target within kingdom territory
function findPlacementSpot(
  own: number[][], terrain: number[][],
  targetX: number, targetY: number, kingdomIdx: number,
  W: number, H: number, minDist: number
): [number, number] | null {
  // Spiral search from target
  for (let r = 0; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // only perimeter
        const nx = targetX + dx, ny = targetY + dy;
        if (nx < 2 || nx >= W - 2 || ny < 2 || ny >= H - 2) continue;
        if (own[ny][nx] !== kingdomIdx) continue;
        if (isBuilding(terrain[ny][nx])) continue;
        // Check minimum distance from other buildings
        let tooClose = false;
        for (let cy = -minDist; cy <= minDist && !tooClose; cy++) {
          for (let cx = -minDist; cx <= minDist && !tooClose; cx++) {
            const bx = nx + cx, by = ny + cy;
            if (bx >= 0 && bx < W && by >= 0 && by < H && isBuilding(terrain[by][bx])) {
              tooClose = true;
            }
          }
        }
        if (!tooClose) return [nx, ny];
      }
    }
  }
  return null;
}

function placeSettlements(
  kingdoms: WorldKingdom[], own: number[][], terrain: number[][], W: number, H: number
): WorldSettlement[] {
  const allSettlements: WorldSettlement[] = [];
  const noise = createNoise(8888);

  for (const k of kingdoms) {
    // Capital settlement goes at the centroid (or nearby)
    // Other settlements spread out from there

    for (let si = 0; si < k.settlements.length; si++) {
      const s = k.settlements[si];
      const minDist = s.tier === 'capital' ? 4 : s.tier === 'city' ? 3 : 2;

      if (si === 0) {
        // First (biggest) settlement near centroid
        const spot = findPlacementSpot(own, terrain, k.centroidX, k.centroidY, k.index, W, H, minDist);
        if (spot) {
          s.x = spot[0];
          s.y = spot[1];
        } else {
          s.x = k.centroidX;
          s.y = k.centroidY;
        }
      } else {
        // Other settlements spread around the kingdom
        const angle = (si * 2.4 + k.index * 1.3); // golden angle spread
        const dist = 8 + si * 4;
        const targetX = Math.round(k.centroidX + Math.cos(angle) * dist);
        const targetY = Math.round(k.centroidY + Math.sin(angle) * dist);
        const spot = findPlacementSpot(own, terrain, targetX, targetY, k.index, W, H, minDist);
        if (spot) {
          s.x = spot[0];
          s.y = spot[1];
        } else {
          // Fallback: try near centroid
          const fallback = findPlacementSpot(own, terrain, k.centroidX, k.centroidY, k.index, W, H, 2);
          if (fallback) {
            s.x = fallback[0];
            s.y = fallback[1];
          } else {
            s.x = k.centroidX;
            s.y = k.centroidY;
          }
        }
      }

      placeSettlementBuildings(terrain, own, s, W, H);
      allSettlements.push(s);
    }

    // Draw roads between settlements in this kingdom
    if (k.settlements.length > 1) {
      const cap = k.settlements[0];
      for (let si = 1; si < k.settlements.length; si++) {
        const s = k.settlements[si];
        drawWindingRoad(terrain, own, cap.x, cap.y + 1, s.x, s.y, k.index, noise, W, H);
      }
    }
  }

  return allSettlements;
}

function drawWindingRoad(
  terrain: number[][], own: number[][],
  fromX: number, fromY: number, toX: number, toY: number,
  kIdx: number, noise: (x: number, y: number, o?: number) => number,
  W: number, H: number
) {
  let x = fromX, y = fromY;
  const maxSteps = Math.abs(toX - fromX) + Math.abs(toY - fromY) + 30;
  for (let step = 0; step < maxSteps; step++) {
    if (Math.abs(x - toX) <= 1 && Math.abs(y - toY) <= 1) break;
    if (x < 0 || x >= W || y < 0 || y >= H) break;
    if (own[y][x] !== kIdx) break;
    if (!isBuilding(terrain[y][x])) terrain[y][x] = TILES.ROAD;
    const dx = toX - x, dy = toY - y;
    const n = noise(x * 0.25 + kIdx * 50, y * 0.25 + kIdx * 50, 2);
    if (Math.abs(dx) > Math.abs(dy)) {
      if (n > 0.62 && dy !== 0) y += Math.sign(dy);
      else x += Math.sign(dx);
    } else {
      if (n > 0.62 && dx !== 0) x += Math.sign(dx);
      else y += Math.sign(dy);
    }
    x = Math.max(0, Math.min(W - 1, x));
    y = Math.max(0, Math.min(H - 1, y));
  }
}

// ─── Auto-tiling pass ─────────────────────────────────────────
function autoTileCoastline(terrain: number[][], W: number, H: number) {
  const snap = terrain.map(r => [...r]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (snap[y][x] === TILES.SAND) {
        let mask = 0;
        if (y > 0 && isWaterTile(snap[y - 1][x])) mask |= 1;
        if (x < W - 1 && isWaterTile(snap[y][x + 1])) mask |= 2;
        if (y < H - 1 && isWaterTile(snap[y + 1][x])) mask |= 4;
        if (x > 0 && isWaterTile(snap[y][x - 1])) mask |= 8;
        if (mask > 0 && COAST_BITMASK[mask] !== undefined) terrain[y][x] = COAST_BITMASK[mask];
      }
      if (snap[y][x] === TILES.GRASS || snap[y][x] === TILES.GRASS_DARK) {
        let mask = 0;
        if (y > 0 && isSandTile(snap[y - 1][x])) mask |= 1;
        if (x < W - 1 && isSandTile(snap[y][x + 1])) mask |= 2;
        if (y < H - 1 && isSandTile(snap[y + 1][x])) mask |= 4;
        if (x > 0 && isSandTile(snap[y][x - 1])) mask |= 8;
        if (mask > 0 && SHORE_BITMASK[mask] !== undefined) terrain[y][x] = SHORE_BITMASK[mask];
      }
    }
  }
}

function generateCollisionMap(terrain: number[][], W: number, H: number): boolean[][] {
  return terrain.map(row => row.map(t => isWalkable(t)));
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Geology-first world generation with language kingdoms
// ═══════════════════════════════════════════════════════════════
export function generateWorld(languageKingdoms: LanguageKingdom[]): WorldData {
  const n = languageKingdoms.length;
  const numContinents = Math.max(1, Math.ceil(n / MAX_PER_CONTINENT));

  // Build WorldKingdom objects — ONE city settlement per language
  // (individual repos are now buildings inside CityScene, not world-map settlements)
  const kingdoms: WorldKingdom[] = languageKingdoms.map((lk, i) => {
    // Use the top repo (most stars) as the representative for the city
    const topRepo = [...lk.repos].sort(
      (a, b) => b.repo.stargazers_count - a.repo.stargazers_count
    )[0];

    // City tier based on aggregate total stars
    const totalStars = lk.totalStars;
    const cityTier: SettlementTier =
      totalStars >= 500000 ? 'capital' :
      totalStars >= 200000 ? 'city' :
      totalStars >= 100000 ? 'town' :
      totalStars >= 50000 ? 'village' :
      totalStars >= 10000 ? 'hamlet' : 'camp';

    // Single settlement representing the whole language city
    const settlements: WorldSettlement[] = [{
      repoMetrics: topRepo,
      tier: cityTier,
      mayor: lk.king,
      x: 0,
      y: 0,
      kingdomIndex: i,
    }];

    // Territory scales with total repo count (each repo "contributes" space)
    const repoArea = lk.repos.length * 80;
    const tierArea = settlementArea[cityTier];
    // Ensure every kingdom is at least a visible island (3000 tiles min)
    const MIN_KINGDOM_AREA = 3000;

    return {
      index: i,
      language: lk.language,
      biome: lk.biome,
      king: lk.king,
      totalCommits: lk.totalCommits,
      totalStars: lk.totalStars,
      settlements,
      centerX: 0,
      centerY: 0,
      centroidX: 0,
      centroidY: 0,
      targetArea: Math.max(MIN_KINGDOM_AREA, (repoArea + tierArea) * KINGDOM_AREA_MULTIPLIER),
    };
  });

  // Sort biggest first for seed placement priority
  kingdoms.sort((a, b) => b.targetArea - a.targetArea);
  kingdoms.forEach((k, i) => {
    k.index = i;
    k.settlements.forEach(s => (s.kingdomIndex = i));
  });

  // World size scales with total kingdom area — generous sizing prevents label overlap
  const totalArea = kingdoms.reduce((sum, k) => sum + k.targetArea, 0);
  const targetArea = totalArea * 3.5; // bigger map → more spacing between kingdoms
  const aspect = 1.4;
  const rawW = Math.sqrt(targetArea * aspect);
  const W = Math.max(140, Math.min(500, Math.round(rawW)));
  const H = Math.max(100, Math.min(380, Math.round(rawW / aspect)));

  // Pipeline
  const land = generateLandmass(W, H, numContinents);

  // Stamp a separate island for the Uncharted kingdom (null-language repos)
  const unchartedK = kingdoms.find(k => k.language === 'Uncharted');
  if (unchartedK) {
    stampUnchartedIsland(land, W, H, unchartedK);
  }

  const elev = generateElevation(land, W, H);
  const ownership = placeAndGrowKingdoms(kingdoms, land, elev, W, H);
  computeCentroids(kingdoms, ownership, W, H);
  const terrain = generateTerrain(kingdoms, ownership, land, elev, W, H);
  autoTileCoastline(terrain, W, H);
  const allSettlements = placeSettlements(kingdoms, ownership, terrain, W, H);
  const collision = generateCollisionMap(terrain, W, H);

  return { width: W, height: H, terrain, ownership, kingdoms, settlements: allSettlements, collision };
}
