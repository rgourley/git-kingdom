import { KingdomMetrics, Kingdom, SettlementTier, Biome, TILES } from '../types';

function getTier(totalCommits: number): SettlementTier {
  if (totalCommits >= 5000) return 'capital';
  if (totalCommits >= 1000) return 'city';
  if (totalCommits >= 200) return 'town';
  if (totalCommits >= 50) return 'village';
  if (totalCommits >= 10) return 'hamlet';
  return 'camp';
}

function getBiome(language: string | null): Biome {
  const biomes: Record<string, Biome> = {
    JavaScript: 'grassland',
    TypeScript: 'grassland',
    Python: 'forest',
    Rust: 'volcanic',
    Go: 'mountain',
    Ruby: 'crystal',
    Java: 'desert',
    'C++': 'mountain',
    C: 'mountain',
    'C#': 'tundra',
    PHP: 'forest',
    Swift: 'grassland',
    Kotlin: 'desert',
  };
  return biomes[language || ''] || 'grassland';
}

const tierSizes: Record<SettlementTier, { w: number; h: number }> = {
  camp: { w: 5, h: 5 },
  hamlet: { w: 7, h: 7 },
  village: { w: 10, h: 10 },
  town: { w: 14, h: 14 },
  city: { w: 18, h: 18 },
  capital: { w: 22, h: 22 },
};

function generateKingdomTiles(kingdom: Kingdom): number[][] {
  const { width, height, tier, biome, metrics } = kingdom;
  const tiles: number[][] = [];

  // base biome tile
  const baseTile =
    biome === 'forest' ? TILES.GRASS_DARK :
    biome === 'volcanic' ? TILES.GRASS_DARK :
    biome === 'mountain' ? TILES.GRASS :
    biome === 'crystal' ? TILES.GRASS_DARK :
    biome === 'desert' ? TILES.SAND :
    biome === 'tundra' ? TILES.SNOW :
    TILES.GRASS;

  // fill with base
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      row.push(baseTile);
    }
    tiles.push(row);
  }

  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);

  // --- Border wall (city+ tier) ---
  if (tier === 'city' || tier === 'capital') {
    for (let x = 2; x < width - 2; x++) {
      tiles[2][x] = TILES.CASTLE_WALL;
      tiles[height - 3][x] = TILES.CASTLE_WALL;
    }
    for (let y = 2; y < height - 2; y++) {
      tiles[y][2] = TILES.CASTLE_WALL;
      tiles[y][width - 3] = TILES.CASTLE_WALL;
    }
    // corner towers
    tiles[2][2] = TILES.CASTLE_TOWER;
    tiles[2][width - 3] = TILES.CASTLE_TOWER;
    tiles[height - 3][2] = TILES.CASTLE_TOWER;
    tiles[height - 3][width - 3] = TILES.CASTLE_TOWER;
    // gate at bottom
    tiles[height - 3][cx] = TILES.CASTLE_GATE;
  }

  // --- Castle in center ---
  const castleSize =
    tier === 'capital' ? 3 :
    tier === 'city' ? 2 :
    1;

  for (let dy = -castleSize; dy <= castleSize; dy++) {
    for (let dx = -castleSize; dx <= castleSize; dx++) {
      const tx = cx + dx;
      const ty = cy + dy;
      if (ty >= 0 && ty < height && tx >= 0 && tx < width) {
        if (Math.abs(dx) === castleSize && Math.abs(dy) === castleSize) {
          tiles[ty][tx] = TILES.CASTLE_TOWER;
        } else if (Math.abs(dx) === castleSize || Math.abs(dy) === castleSize) {
          tiles[ty][tx] = TILES.CASTLE_WALL;
        } else {
          tiles[ty][tx] = TILES.CASTLE_ROOF;
        }
      }
    }
  }
  // gate at the bottom of castle
  tiles[cy + castleSize][cx] = TILES.CASTLE_GATE;

  // --- Roads from castle to edges ---
  // vertical road down from gate
  for (let y = cy + castleSize + 1; y < height - 1; y++) {
    if (tiles[y][cx] === baseTile) tiles[y][cx] = TILES.ROAD;
  }
  // horizontal road
  for (let x = 3; x < width - 3; x++) {
    const roadY = cy + castleSize + 2;
    if (roadY < height - 3 && tiles[roadY][x] === baseTile) {
      tiles[roadY][x] = TILES.ROAD;
    }
  }

  // --- Towns (merged PRs) ---
  const townCount = Math.min(
    tier === 'capital' ? 6 : tier === 'city' ? 4 : tier === 'town' ? 2 : tier === 'village' ? 1 : 0,
    Math.floor(metrics.mergedPRs / 50)
  );
  const townPositions = [
    [cx - 3, cy - 3], [cx + 3, cy - 3],
    [cx - 4, cy + 3], [cx + 4, cy + 3],
    [cx - 2, cy - 5], [cx + 2, cy + 5],
  ];
  for (let i = 0; i < townCount && i < townPositions.length; i++) {
    const [tx, ty] = townPositions[i];
    if (ty >= 1 && ty < height - 1 && tx >= 1 && tx < width - 1) {
      if (tiles[ty][tx] === baseTile) {
        tiles[ty][tx] = TILES.HOUSE_LARGE;
        // small houses around
        if (tx + 1 < width - 1 && tiles[ty][tx + 1] === baseTile) tiles[ty][tx + 1] = TILES.HOUSE;
        if (ty + 1 < height - 1 && tiles[ty + 1][tx] === baseTile) tiles[ty + 1][tx] = TILES.HOUSE;
      }
    }
  }

  // --- Market (if stars > 100) ---
  if (metrics.repo.stargazers_count > 100) {
    const mx = cx + 2;
    const my = cy + castleSize + 2;
    if (my < height - 3 && mx < width - 3 && tiles[my][mx] === TILES.ROAD) {
      tiles[my][mx + 1] = TILES.MARKET;
    }
  }

  // --- Church (if town+) ---
  if (tier !== 'hamlet' && tier !== 'village') {
    const chx = cx - 2;
    const chy = cy - castleSize - 2;
    if (chy >= 1 && tiles[chy][chx] === baseTile) {
      tiles[chy][chx] = TILES.CHURCH;
    }
  }

  // --- Monster dens (open issues, 1 per 50 issues) ---
  const monsterCount = Math.min(3, Math.floor(metrics.repo.open_issues_count / 50));
  const monsterPos = [
    [1, 1], [width - 2, 1], [1, height - 2],
  ];
  for (let i = 0; i < monsterCount; i++) {
    const [mx, my] = monsterPos[i];
    if (tiles[my][mx] === baseTile) {
      tiles[my][mx] = TILES.MONSTER_DEN;
    }
  }

  // --- Quest board (if open issues > 10) ---
  if (metrics.repo.open_issues_count > 10) {
    const qx = cx + 1;
    const qy = cy + castleSize + 1;
    if (qy < height - 2 && tiles[qy][qx] === baseTile) {
      tiles[qy][qx] = TILES.QUEST_BOARD;
    }
  }

  // --- Banners (stars > 1000) ---
  if (metrics.repo.stargazers_count > 1000) {
    const bannerSpots = [[cx - 1, cy - castleSize - 1], [cx + 1, cy - castleSize - 1]];
    for (const [bx, by] of bannerSpots) {
      if (by >= 0 && tiles[by][bx] === baseTile) {
        tiles[by][bx] = TILES.BANNER;
      }
    }
  }

  // --- Monuments (forks > 500) ---
  if (metrics.repo.forks_count > 500) {
    const monX = cx;
    const monY = cy - castleSize - 1;
    if (monY >= 1 && tiles[monY][monX] === baseTile) {
      tiles[monY][monX] = TILES.MONUMENT;
    }
  }

  // --- Biome decorations ---
  if (biome === 'volcanic') {
    tiles[0][0] = TILES.LAVA;
    tiles[0][width - 1] = TILES.LAVA;
    if (height > 5) tiles[height - 1][0] = TILES.LAVA;
  }
  if (biome === 'crystal') {
    tiles[1][1] = TILES.CRYSTAL;
    if (width > 5) tiles[1][width - 2] = TILES.CRYSTAL;
  }
  if (biome === 'forest') {
    // scatter some forest tiles
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (tiles[y][x] === baseTile && ((x + y * 3) % 7 === 0)) {
          tiles[y][x] = TILES.FOREST;
        }
      }
    }
  }

  // --- Ruins if repo is old and inactive ---
  const lastPush = new Date(metrics.repo.pushed_at).getTime();
  const oneYear = 365 * 24 * 60 * 60 * 1000;
  if (Date.now() - lastPush > oneYear) {
    // scatter some ruins
    tiles[cy - castleSize - 3] && tiles[cy - castleSize - 3][cx + 3] !== undefined &&
      (tiles[cy - castleSize - 3][cx + 3] = TILES.RUINS);
  }

  return tiles;
}

export function createKingdom(metrics: KingdomMetrics, x: number, y: number): Kingdom {
  const tier = getTier(metrics.totalCommits);
  const biome = getBiome(metrics.repo.language);
  const { w, h } = tierSizes[tier];

  const kingdom: Kingdom = {
    metrics,
    tier,
    biome,
    x,
    y,
    width: w,
    height: h,
    tiles: [],
  };

  kingdom.tiles = generateKingdomTiles(kingdom);
  return kingdom;
}

// Place kingdoms on the world map with spacing
export function placeKingdoms(
  allMetrics: KingdomMetrics[],
  worldWidth: number,
  worldHeight: number
): Kingdom[] {
  const kingdoms: Kingdom[] = [];

  // Sort by size descending so big kingdoms get placed first
  const sorted = [...allMetrics].sort((a, b) => b.totalCommits - a.totalCommits);

  // Simple grid layout with some spacing
  const margin = 4; // tiles between kingdoms
  let curX = 8;
  let curY = 8;
  let rowMaxH = 0;

  for (const metrics of sorted) {
    const tier = getTier(metrics.totalCommits);
    const { w, h } = tierSizes[tier];

    // wrap to next row if we'd go off edge
    if (curX + w + margin > worldWidth - 8) {
      curX = 8;
      curY += rowMaxH + margin;
      rowMaxH = 0;
    }

    // don't go off bottom
    if (curY + h + margin > worldHeight - 8) break;

    const kingdom = createKingdom(metrics, curX, curY);
    kingdoms.push(kingdom);

    curX += w + margin;
    rowMaxH = Math.max(rowMaxH, h);
  }

  return kingdoms;
}
