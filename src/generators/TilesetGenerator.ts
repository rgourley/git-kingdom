import { TILES } from '../types';
import { BuildingTemplate, TileRef, TemplateLibrary, SHEET_DEFS, LAYER_ORDER, migrateTemplate } from '../editor/types';
import { TemplateVariant, expandTemplateVariations } from '../editor/VariationEngine';

const T = 16; // tile size in pixels

// ─── Sprite Pack type ─────────────────────────────────────────
export interface SpritePacks {
  grassA2Img?: HTMLImageElement;  // Grasslands A2 terrain autotiles (160x3200, 10 cols)
  grassA1Img?: HTMLImageElement;  // Grasslands A1 water autotiles (160x1440, 10 cols)
  grassBImg?: HTMLImageElement;   // Grasslands B objects (256x256, 16 cols)
  grassCImg?: HTMLImageElement;   // Grasslands C objects (256x256, 16 cols)
  grassTreesImg?: HTMLImageElement; // Grasslands Trees (224x128, 14 cols)
  grassFlowersImg?: HTMLImageElement; // Grasslands Flowers (192x128, 12 cols)
  townAImg?: HTMLImageElement;    // Town floors (208x256)
  townBImg?: HTMLImageElement;    // Town buildings/objects (256x592, 16 cols)
  doorsOutsideImg?: HTMLImageElement; // Town doors exterior (48x128, 3 cols)
  doorsInsideImg?: HTMLImageElement;  // Town doors interior (48x128, 3 cols)
  townCImg?: HTMLImageElement;       // Town floors+ (240x480, 15 cols) — wood, carpets, water
  townDImg?: HTMLImageElement;       // Town interiors (256x448, 16 cols) — furniture, shelves, weapons
  desertAImg?: HTMLImageElement;  // Desert terrain (160x320, 10 cols)
  desertBImg?: HTMLImageElement;  // Desert objects (128x224, 8 cols)
  caveBImg?: HTMLImageElement;    // Cave objects (256x224, 16 cols)
}

// ─── Helper: extract 16x16 tile from a spritesheet ───────────
function drawFromSheet(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cols: number,       // columns in the source sheet
  tileIndex: number,  // tile index in the sheet
  ox: number, oy: number, // destination position
  spacing = 0,
) {
  const srcCol = tileIndex % cols;
  const srcRow = Math.floor(tileIndex / cols);
  const step = T + spacing;
  ctx.drawImage(img, srcCol * step, srcRow * step, T, T, ox, oy, T, T);
}

// ─── Grasslands A2 terrain tile mapping ──────────────────────
// VERIFIED via pixel sampling from actual A2_tileset_sheet.png (160×3120, 10 cols, 195 rows)
// Tile indices confirmed by checking center pixel colors at each position
const A2_COLS = 10;

// Map GitWorld TILES → A2 tile index (verified by pixel color)
const TILE_TO_A2: Partial<Record<number, number>> = {
  [TILES.GRASS]:      11,    // Base grass fill — rgb(125,184,61) GREEN ✓
  [TILES.GRASS_DARK]: 511,   // Dead Grass fill — rgb(101,151,21) dark olive GREEN ✓
  [TILES.SAND]:       111,   // Grass-Sand Patch fill — rgb(244,188,99) sand ✓
  [TILES.FOREST]:     1761,  // Forest Top 1 fill — rgb(63,89,0) deep forest GREEN ✓
  // ROAD now drawn from town_A (see TILE_TO_TOWN_A below)
  [TILES.MOUNTAIN]:   1111,  // tile 1111 — rgb(170,161,154) gray stone ✓
  [TILES.SNOW]:       1311,  // tile 1311 — rgb(101,151,21) pale tundra ✓
  [TILES.BRIDGE]:     61,    // Dirt fill (bridge surface)
};

// ─── Town A tile mapping (cobblestone roads, city grass, etc.) ──────────
const TOWN_A_COLS = 13;
const TILE_TO_TOWN_A: Partial<Record<number, number>> = {
  [TILES.ROAD]:   152,  // Cobblestone path — town_A row 11, col 9
  [TILES.BRIDGE]: 152,  // Bridge also uses cobblestone
  // City grass variants — detailed grass textures for town areas
  [TILES.CITY_GRASS_1]: 50,   // town_A row 3, col 11
  [TILES.CITY_GRASS_2]: 51,   // town_A row 3, col 12
  [TILES.CITY_GRASS_3]: 89,   // town_A row 6, col 11
  [TILES.CITY_GRASS_4]: 90,   // town_A row 6, col 12
  [TILES.CITY_GRASS_5]: 102,  // town_A row 7, col 11
  [TILES.CITY_GRASS_6]: 103,  // town_A row 7, col 12
};

// ─── Grasslands A1 water tile mapping ────────────────────────
// From A1.tsx: water terrain blocks
const A1_COLS = 10;
const TILE_TO_A1: Partial<Record<number, number>> = {
  [TILES.WATER]:      11,   // Shallow Water fill (terrain="0,0,0,0")
  [TILES.WATER_DEEP]: 311,  // Deep Water fill (terrain="2,2,2,2")
};

// ─── Coast auto-tile mapping (A1 Beach terrain, index 3) ─────
// Our bitmask: N=1, E=2, S=4, W=8 (which edges have WATER)
// A1 Beach terrain: sand corners vs water background
// terrain="TL,TR,BL,BR" where 3=sand, empty=water
const A1_COAST_MAP: Partial<Record<number, number>> = {
  1:  451,  // water N → sand BL+BR → ",,3,3"
  2:  462,  // water E → sand TL+BL → "3,,3,"
  3:  452,  // water N+E → sand BL only → ",,3,"
  4:  471,  // water S → sand TL+TR → "3,3,,"
  6:  472,  // water E+S → sand TL only → "3,,,"
  8:  460,  // water W → sand TR+BR → ",3,,3"
  9:  450,  // water N+W → sand BR only → ",,,3"
  12: 470,  // water S+W → sand TR only → ",3,,"
  // Inverse corners (3 water edges, 1 sand corner)
  7:  457,  // water N+E+S → sand on W side → "3,3,3," approx
  11: 459,  // water N+E+W → sand on S side → "3,3,,3" approx
  13: 477,  // water N+S+W → sand on E side → "3,,3,3" approx
  14: 479,  // water E+S+W → sand on N side → ",3,3,3" approx
};

// ─── Shore auto-tile mapping (A2 Grass-Sand Patch terrain 1) ─
// Our bitmask: which edges have SAND (bleeding into grass)
// A2 terrain 1: sand corners on grass background
const A2_SHORE_MAP: Partial<Record<number, number>> = {
  1:  121,  // sand N → sand TL+TR → "1,1,,"
  2:  110,  // sand E → sand TR+BR → ",1,,1"
  3:  109,  // sand N+E → sand TL+TR+BR → "1,1,,1"
  4:  101,  // sand S → sand BL+BR → ",,1,1"
  6:  129,  // sand E+S → sand TR+BL+BR → ",1,1,1"
  8:  112,  // sand W → sand TL+BL → "1,,1,"
  9:  107,  // sand N+W → sand TL+TR+BL → "1,1,1,"
  12: 127,  // sand S+W → sand TL+BL+BR → "1,,1,1"
};

// ─── Town B building tile mapping ────────────────────────────
// town_B.png: 16 cols × 37 rows, 16px tiles, no spacing
// Rows 0-7: Roofs (red, blue, green, orange — 2 rows each)
// Rows 8-11: Walls
// Row 12+: Trees, flowers, fences, signs, furniture, fountain
const TOWN_B_COLS = 16;
const TILE_TO_TOWN_B: Partial<Record<number, number>> = {
  [TILES.CASTLE_ROOF]:  3,       // Red roof center (row 0, col 3)
  [TILES.CASTLE_WALL]:  16 * 8 + 1,  // Stone wall (row 8, col 1)
  [TILES.CASTLE_TOWER]: 16 * 8 + 4,  // Stone wall with detail (row 8, col 4)
  [TILES.CASTLE_GATE]:  16 * 9 + 4,  // Arch/gate (row 9, col 4)
  [TILES.HOUSE]:        16 * 1 + 1,  // Red roof left side (row 1, col 1)
  [TILES.HOUSE_LARGE]:  16 * 3 + 1,  // Blue roof (row 3, col 1)
  [TILES.MARKET]:       16 * 19 + 6, // Shop display (row 19, col 6)
  [TILES.BANNER]:       16 * 18 + 8, // Sign on pole (row 18, col 8)
  [TILES.CHURCH]:       16 * 8 + 0,  // Stone building (row 8, col 0)
};

// ─── Color palette matched to Grasslands pack ────────────────
const C = {
  grass: '#5a9e2e',       // Grasslands pack grass green
  grassDark: '#4a8a24',
  sand: '#c4a050',
  sandDark: '#a08030',
  water: '#4da8c8',
  waterDeep: '#3878a8',
  road: '#a07848',
  roadDark: '#886838',
  wood: '#a07040',
  woodDark: '#785030',
  stone: '#b0b0a8',
  stoneDark: '#808078',
  roofRed: '#c85030',
  roofBlue: '#4070a0',
  roofGold: '#c0a020',
  door: '#604020',
  window: '#80b0c8',
  windowLit: '#d0c060',
  banner: '#c05030',
  bannerGold: '#d0a020',
  lava: '#d06020',
  lavaGlow: '#e09030',
  crystal: '#a050b0',
  crystalGlow: '#c070d0',
  black: '#181818',
  white: '#e8e0c8',
};

function drawPixel(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function drawRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

// ─── Procedural tile drawing (fallback for tiles not in sprite packs) ─
const BG = '#5a9e2e'; // Grasslands grass green background for buildings

const tileDraw: Record<number, (ctx: CanvasRenderingContext2D, ox: number, oy: number) => void> = {
  [TILES.LAVA](ctx, ox, oy) {
    drawRect(ctx, ox, oy, T, T, C.lava);
    for (let py = 0; py < T; py += 2) {
      for (let px = 0; px < T; px += 2) {
        if ((px * 3 + py * 7) % 5 === 0) drawPixel(ctx, ox + px, oy + py, C.lavaGlow, 2, 2);
      }
    }
  },

  [TILES.CRYSTAL](ctx, ox, oy) {
    drawRect(ctx, ox, oy, T, T, C.grassDark);
    drawRect(ctx, ox + 3, oy + 4, 4, 10, C.crystal);
    drawRect(ctx, ox + 8, oy + 6, 3, 8, C.crystalGlow);
    drawRect(ctx, ox + 12, oy + 8, 2, 6, C.crystal);
    drawPixel(ctx, ox + 4, oy + 3, C.crystalGlow, 2, 1);
    drawPixel(ctx, ox + 9, oy + 5, C.crystalGlow, 1, 1);
  },

  // Building fallbacks (used when town_B tiles aren't available or for specific building types)
  [TILES.HOUSE](ctx, ox, oy) {
    drawRect(ctx, ox, oy, T, T, BG);
    drawRect(ctx, ox + 3, oy + 7, 10, 7, C.sand);
    drawRect(ctx, ox + 4, oy + 8, 8, 5, '#c4a068');
    drawRect(ctx, ox + 2, oy + 4, 12, 4, C.roofRed);
    drawRect(ctx, ox + 4, oy + 3, 8, 2, C.roofRed);
    drawPixel(ctx, ox + 7, oy + 11, C.door, 2, 3);
    drawPixel(ctx, ox + 4, oy + 9, C.window, 2, 2);
  },

  [TILES.HOUSE_LARGE](ctx, ox, oy) {
    drawRect(ctx, ox, oy, T, T, BG);
    drawRect(ctx, ox + 2, oy + 7, 12, 7, C.stone);
    drawRect(ctx, ox + 3, oy + 8, 10, 5, '#bebebc');
    drawRect(ctx, ox + 1, oy + 4, 14, 4, C.roofBlue);
    drawRect(ctx, ox + 3, oy + 3, 10, 2, C.roofBlue);
    drawPixel(ctx, ox + 7, oy + 11, C.door, 2, 3);
    drawPixel(ctx, ox + 3, oy + 9, C.windowLit, 2, 2);
    drawPixel(ctx, ox + 11, oy + 9, C.windowLit, 2, 2);
  },

  [TILES.CASTLE_WALL](ctx, ox, oy) {
    drawRect(ctx, ox, oy, T, T, C.stone);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        drawPixel(ctx, ox + col * 2 + (row % 2 ? 1 : 0), oy + row * 2, C.stoneDark, 1, 1);
      }
    }
    for (let i = 0; i < 4; i++) drawRect(ctx, ox + i * 4, oy, 2, 3, C.stoneDark);
  },

  [TILES.CASTLE_TOWER](ctx, ox, oy) {
    drawRect(ctx, ox, oy, T, T, BG);
    drawRect(ctx, ox + 3, oy + 5, 10, 9, C.stone);
    drawRect(ctx, ox + 4, oy + 6, 8, 7, C.stoneDark);
    drawPixel(ctx, ox + 3, oy + 4, C.stone, 2, 1);
    drawPixel(ctx, ox + 7, oy + 4, C.stone, 2, 1);
    drawPixel(ctx, ox + 11, oy + 4, C.stone, 2, 1);
    drawPixel(ctx, ox + 7, oy + 1, C.stoneDark, 1, 4);
    drawRect(ctx, ox + 8, oy + 1, 4, 2, C.banner);
    drawPixel(ctx, ox + 9, oy + 2, C.bannerGold, 2, 1);
    drawPixel(ctx, ox + 7, oy + 12, C.black, 2, 2);
  },

  [TILES.CASTLE_GATE](ctx, ox, oy) {
    drawRect(ctx, ox, oy, T, T, BG);
    drawRect(ctx, ox + 2, oy + 3, 12, 11, C.stone);
    drawRect(ctx, ox + 5, oy + 6, 6, 8, C.black);
    drawRect(ctx, ox + 6, oy + 5, 4, 1, C.black);
    drawPixel(ctx, ox + 6, oy + 6, C.stoneDark, 1, 8);
    drawPixel(ctx, ox + 8, oy + 6, C.stoneDark, 1, 8);
    drawPixel(ctx, ox + 10, oy + 6, C.stoneDark, 1, 8);
  },

  [TILES.CASTLE_ROOF](ctx, ox, oy) {
    drawRect(ctx, ox, oy, T, T, C.roofGold);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 4; col++) {
        drawPixel(ctx, ox + col * 4 + (row % 2 ? 2 : 0), oy + row * 2, '#b88a10', 3, 1);
      }
    }
  },

  [TILES.BANNER](ctx, ox, oy) {
    drawRect(ctx, ox, oy, T, T, BG);
    drawPixel(ctx, ox + 7, oy + 3, C.stoneDark, 1, 11);
    drawRect(ctx, ox + 8, oy + 3, 5, 4, C.banner);
    drawPixel(ctx, ox + 9, oy + 5, C.bannerGold, 2, 1);
    drawRect(ctx, ox + 5, oy + 13, 6, 2, C.stoneDark);
  },

  [TILES.MARKET](ctx, ox, oy) {
    drawRect(ctx, ox, oy, T, T, BG);
    drawRect(ctx, ox + 2, oy + 8, 12, 6, C.wood);
    drawRect(ctx, ox + 1, oy + 5, 14, 4, '#dd8833');
    for (let i = 0; i < 7; i++) drawPixel(ctx, ox + 1 + i * 2, oy + 6, C.white, 1, 2);
  },

  [TILES.CHURCH](ctx, ox, oy) {
    drawRect(ctx, ox, oy, T, T, BG);
    drawRect(ctx, ox + 4, oy + 6, 8, 8, C.stone);
    drawRect(ctx, ox + 6, oy + 2, 4, 5, C.stone);
    drawPixel(ctx, ox + 7, oy + 1, C.bannerGold, 2, 1);
    drawPixel(ctx, ox + 7, oy + 0, C.bannerGold, 1, 1);
    drawPixel(ctx, ox + 8, oy + 0, C.bannerGold, 1, 1);
    drawPixel(ctx, ox + 7, oy + 8, '#8844cc', 2, 2);
    drawPixel(ctx, ox + 7, oy + 12, C.door, 2, 2);
  },

  [TILES.MONSTER_DEN](ctx, ox, oy) {
    drawRect(ctx, ox, oy, T, T, C.grassDark);
    drawRect(ctx, ox + 3, oy + 5, 10, 9, C.stoneDark);
    drawRect(ctx, ox + 4, oy + 7, 8, 7, C.black);
    drawRect(ctx, ox + 5, oy + 6, 6, 2, C.black);
    drawPixel(ctx, ox + 6, oy + 9, '#ff3300', 1, 1);
    drawPixel(ctx, ox + 10, oy + 9, '#ff3300', 1, 1);
  },

  [TILES.QUEST_BOARD](ctx, ox, oy) {
    drawRect(ctx, ox, oy, T, T, BG);
    drawPixel(ctx, ox + 7, oy + 5, C.wood, 2, 9);
    drawRect(ctx, ox + 4, oy + 3, 8, 5, C.woodDark);
    drawRect(ctx, ox + 5, oy + 4, 6, 3, C.wood);
    drawPixel(ctx, ox + 6, oy + 4, C.white, 2, 2);
    drawPixel(ctx, ox + 9, oy + 5, C.white, 1, 1);
  },

  [TILES.DOCK](ctx, ox, oy) {
    drawRect(ctx, ox, oy, T, T, C.water);
    drawRect(ctx, ox, oy + 4, 16, 8, C.wood);
    for (let i = 0; i < 4; i++) drawPixel(ctx, ox + i * 4, oy + 4, C.woodDark, 1, 8);
    for (let i = 0; i < 4; i++) drawPixel(ctx, ox, oy + 5 + i * 2, C.woodDark, 16, 1);
  },

  [TILES.RUINS](ctx, ox, oy) {
    drawRect(ctx, ox, oy, T, T, BG);
    drawRect(ctx, ox + 2, oy + 8, 3, 6, C.stoneDark);
    drawRect(ctx, ox + 9, oy + 10, 4, 4, C.stoneDark);
    drawRect(ctx, ox + 11, oy + 6, 3, 8, C.stone);
    drawPixel(ctx, ox + 5, oy + 12, C.stoneDark, 2, 2);
    drawPixel(ctx, ox + 7, oy + 13, C.stone, 1, 1);
  },

  [TILES.MONUMENT](ctx, ox, oy) {
    drawRect(ctx, ox, oy, T, T, BG);
    drawRect(ctx, ox + 5, oy + 12, 6, 3, C.stoneDark);
    drawRect(ctx, ox + 6, oy + 4, 4, 9, C.stone);
    drawRect(ctx, ox + 7, oy + 2, 2, 3, C.stone);
    drawPixel(ctx, ox + 7, oy + 2, C.bannerGold, 2, 1);
  },
};

// ── Procedural coast/shore auto-tiles (updated palette) ──────
function drawCoastTile(ctx: CanvasRenderingContext2D, ox: number, oy: number, mask: number) {
  const FADE = 5;
  const waterColor = [77, 168, 200];
  const waterLight = [90, 180, 210];
  const sandColor = [196, 160, 80];
  const sandDark = [160, 128, 48];
  const foam = [170, 210, 220];

  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const wave = Math.sin(px * 0.7 + py * 0.4) * 1.5 + Math.cos(py * 0.6 - px * 0.3) * 1.0;
      let dist = 99;
      if (mask & 1) dist = Math.min(dist, py + wave);
      if (mask & 2) dist = Math.min(dist, (T - 1 - px) + wave);
      if (mask & 4) dist = Math.min(dist, (T - 1 - py) + wave);
      if (mask & 8) dist = Math.min(dist, px + wave);

      let r: number, g: number, b: number;
      if (dist < 1.5) { [r, g, b] = waterColor; }
      else if (dist < 3) { [r, g, b] = (Math.sin(px * 2.2 + py * 0.4) > 0.2) ? waterLight : waterColor; }
      else if (dist < 3.8) { [r, g, b] = foam; }
      else if (dist < FADE) { [r, g, b] = sandDark; }
      else { [r, g, b] = ((px * 7 + py * 13) % 5 === 0) ? sandDark : sandColor; }

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(ox + px, oy + py, 1, 1);
    }
  }
}

function drawShoreTile(ctx: CanvasRenderingContext2D, ox: number, oy: number, mask: number) {
  const FADE = 5;
  const grassColor = [90, 158, 46];
  const grassLight = [100, 170, 56];
  const grassDark = [74, 138, 36];
  const sandColor = [196, 160, 80];
  const sandDark = [160, 128, 48];

  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      const wave = Math.sin(px * 0.5 + py * 0.7) * 1.2 + Math.cos(py * 0.4 + px * 0.6) * 0.8;
      let dist = 99;
      if (mask & 1) dist = Math.min(dist, py + wave);
      if (mask & 2) dist = Math.min(dist, (T - 1 - px) + wave);
      if (mask & 4) dist = Math.min(dist, (T - 1 - py) + wave);
      if (mask & 8) dist = Math.min(dist, px + wave);

      let r: number, g: number, b: number;
      if (dist < 2) { [r, g, b] = ((px * 5 + py * 11) % 4 === 0) ? sandDark : sandColor; }
      else if (dist < 3.5) { [r, g, b] = sandDark; }
      else if (dist < FADE) { [r, g, b] = grassDark; }
      else { [r, g, b] = ((px * 3 + py * 7) % 6 === 0) ? grassLight : grassColor; }

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(ox + px, oy + py, 1, 1);
    }
  }
}

// Register coast auto-tiles (COAST_1..15 = tiles 26..40)
for (let mask = 1; mask <= 15; mask++) {
  const tileId = TILES.COAST_1 + (mask - 1);
  tileDraw[tileId] = (ctx, ox, oy) => drawCoastTile(ctx, ox, oy, mask);
}

// Register shore auto-tiles (SHORE_1..15 = tiles 41..55)
for (let mask = 1; mask <= 15; mask++) {
  const tileId = TILES.SHORE_1 + (mask - 1);
  tileDraw[tileId] = (ctx, ox, oy) => drawShoreTile(ctx, ox, oy, mask);
}

// ─── Main tileset generator ─────────────────────────────────
// Extrusion: 1px border around each tile prevents seam artifacts at non-integer zoom
const EXTRUDE = 1;
const TILE_STEP = T + EXTRUDE * 2; // each tile slot = 18px (1px border + 16px tile + 1px border)
export const TILESET_MARGIN = EXTRUDE;   // margin from edge to first tile pixel
export const TILESET_SPACING = EXTRUDE * 2; // spacing between adjacent tile pixels

export function generateTileset(spritePacks?: SpritePacks): HTMLCanvasElement {
  const tileCount = Object.keys(TILES).length;
  const cols = 8;
  const rows = Math.ceil(tileCount / cols);

  const canvas = document.createElement('canvas');
  canvas.width = cols * TILE_STEP;
  canvas.height = rows * TILE_STEP;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  const tileIds = Object.values(TILES) as number[];
  for (const id of tileIds) {
    const col = id % cols;
    const row = Math.floor(id / cols);
    const ox = col * TILE_STEP + EXTRUDE;
    const oy = row * TILE_STEP + EXTRUDE;

    let drawn = false;

    // Priority 1: Grasslands A1 water tiles
    const a1Tile = TILE_TO_A1[id];
    if (!drawn && spritePacks?.grassA1Img && spritePacks.grassA1Img.width > 0 && a1Tile !== undefined) {
      drawFromSheet(ctx, spritePacks.grassA1Img, A1_COLS, a1Tile, ox, oy);
      drawn = true;
    }

    // Priority 1.5: Town A tiles (cobblestone roads)
    const townATile = TILE_TO_TOWN_A[id];
    if (!drawn && spritePacks?.townAImg && spritePacks.townAImg.width > 0 && townATile !== undefined) {
      drawFromSheet(ctx, spritePacks.townAImg, TOWN_A_COLS, townATile, ox, oy);
      drawn = true;
    }

    // Priority 2: Grasslands A2 terrain tiles
    const a2Tile = TILE_TO_A2[id];
    if (!drawn && spritePacks?.grassA2Img && spritePacks.grassA2Img.width > 0 && a2Tile !== undefined) {
      drawFromSheet(ctx, spritePacks.grassA2Img, A2_COLS, a2Tile, ox, oy);
      drawn = true;
    }

    // Priority 3: Coast auto-tiles from A1 Beach terrain
    if (!drawn && id >= TILES.COAST_1 && id <= TILES.COAST_15) {
      const mask = id - TILES.COAST_1 + 1;
      const a1CoastTile = A1_COAST_MAP[mask];
      if (spritePacks?.grassA1Img && spritePacks.grassA1Img.width > 0 && a1CoastTile !== undefined) {
        drawFromSheet(ctx, spritePacks.grassA1Img, A1_COLS, a1CoastTile, ox, oy);
        drawn = true;
      }
    }

    // Priority 4: Shore auto-tiles from A2 Grass-Sand transition
    if (!drawn && id >= TILES.SHORE_1 && id <= TILES.SHORE_15) {
      const mask = id - TILES.SHORE_1 + 1;
      const a2ShoreTile = A2_SHORE_MAP[mask];
      if (spritePacks?.grassA2Img && spritePacks.grassA2Img.width > 0 && a2ShoreTile !== undefined) {
        drawFromSheet(ctx, spritePacks.grassA2Img, A2_COLS, a2ShoreTile, ox, oy);
        drawn = true;
      }
    }

    // Priority 5: Town B building tiles
    const townTile = TILE_TO_TOWN_B[id];
    if (!drawn && spritePacks?.townBImg && spritePacks.townBImg.width > 0 && townTile !== undefined) {
      drawFromSheet(ctx, spritePacks.townBImg, TOWN_B_COLS, townTile, ox, oy);
      drawn = true;
    }

    // Priority 6: Procedural fallback
    if (!drawn) {
      const drawFn = tileDraw[id];
      if (drawFn) {
        drawFn(ctx, ox, oy);
      }
    }

    // Extrude edges: copy border pixels outward to prevent seam artifacts
    // Top edge
    ctx.drawImage(canvas, ox, oy, T, 1, ox, oy - EXTRUDE, T, EXTRUDE);
    // Bottom edge
    ctx.drawImage(canvas, ox, oy + T - 1, T, 1, ox, oy + T, T, EXTRUDE);
    // Left edge
    ctx.drawImage(canvas, ox, oy - EXTRUDE, 1, T + EXTRUDE * 2, ox - EXTRUDE, oy - EXTRUDE, EXTRUDE, T + EXTRUDE * 2);
    // Right edge
    ctx.drawImage(canvas, ox + T - 1, oy - EXTRUDE, 1, T + EXTRUDE * 2, ox + T, oy - EXTRUDE, EXTRUDE, T + EXTRUDE * 2);
  }

  return canvas;
}

// ─── Decoration sprite frame definitions ─────────────────────

// B.png (16 cols × 16 rows = 256 frames): trees, rocks, bushes, fences
export const GRASS_B_COLS = 16;
export const GRASS_B_FRAMES = {
  // Row 0: Small evergreen trees
  pineSmall: [0, 1, 2, 3, 4],
  // Row 0 right: Medium deciduous trees
  deciduousSmall: [5, 6, 7, 8],
  // Row 1: More trees + rocks
  rocks: [9, 10, 11],
  // Row 2: Boulders + stones
  boulders: [16 + 0, 16 + 1, 16 + 2, 16 + 3],
  stonesSmall: [16 + 4, 16 + 5, 16 + 6, 16 + 7],
  // Row 3: More rocks + gems
  stumps: [32 + 0, 32 + 1],
  gems: [32 + 8, 32 + 9, 32 + 10, 32 + 11],
  // Row 5+: Fences
  fenceH: [80 + 0, 80 + 1, 80 + 2],
  fenceV: [80 + 3, 80 + 4],
  // Row 6: Bushes
  bushes: [96 + 0, 96 + 1, 96 + 2, 96 + 3, 96 + 4],
};

// Flowers.png (12 cols × 8 rows = 96 frames)
export const GRASS_FLOWERS_COLS = 12;
export const GRASS_FLOWER_FRAMES = {
  yellowFlowers: [0, 1, 2, 3],
  redFlowers: [12, 13, 14, 15],
  pinkFlowers: [24, 25, 26, 27],
  blueFlowers: [36, 37, 38, 39],
  purpleFlowers: [48, 49, 50, 51],
  allSmall: [0, 1, 2, 3, 12, 13, 14, 15, 24, 25, 26, 27, 36, 37, 38, 39, 48, 49, 50, 51],
};

// Trees.png (14 cols × 8 rows): 2x2 multi-tile trees
// Each tree is 2 cols × 2-4 rows. Columns: tree pairs at 0-1, 2-3, 4-5, 6-7, 8-9, 10-11, 12-13
export const GRASS_TREES_COLS = 14;
export const TREE_DEFS = [
  { name: 'deciduous1', col: 0 },   // Green round tree
  { name: 'deciduous2', col: 2 },   // Green variant
  { name: 'evergreen1', col: 4 },   // Pine/fir
  { name: 'evergreen2', col: 6 },   // Pine variant
  { name: 'dead1', col: 8 },        // Leafless
  { name: 'dead2', col: 10 },       // Dead variant
  { name: 'palm', col: 12 },        // Palm tree
];

// Town B decoration frames (verified from visual inspection)
export const TOWN_B_DECO = {
  // Row 21 (tile 336+): Potted bushes/trees
  townTrees: [337, 338, 339, 340, 341, 342],
  // Row 22-25 (tiles 353+): Flowers in pots (yellow, red, pink, blue, white)
  townFlowers: [353, 354, 355, 369, 370, 371, 385, 386, 401, 402],
  // Row 27-28 (tiles 432+): Wooden fences
  townFenceH: [449, 450],
  townFenceV: [451, 452],
  // Row 22: Signs (INN, PUB)
  townSigns: [360, 361, 375, 376],
  // Row 24: Benches
  townBenches: [379, 380],
  // Row 29: Lamp posts
  townLamps: [492, 493, 508, 509, 524, 525],
};

// Desert B decoration frames (8 cols)
export const DESERT_B_COLS = 8;
export const DESERT_B_DECO = {
  palms: [0, 1, 2],
  cacti: [3, 4],
  bones: [8 + 4, 8 + 5],
  rocks: [8 + 0, 8 + 1, 8 + 2],
};

// Cave B decoration frames (16 cols)
export const CAVE_B_COLS = 16;
export const CAVE_B_DECO = {
  crystals: [0, 1, 2, 3],          // Row 0 crystals
  rocks: [16 + 0, 16 + 1, 16 + 2], // Row 1 rocks
};

// ─── Building composition from town_B tiles ─────────────────
// town_B building layout: 4 roof colors × 5 wall styles
// Each building is 3 tiles wide × 5 tiles tall (rows within each color block)
// Roof colors: Red (rows 0-4), Blue (rows 5-9), Green (rows 10-14), Brown (rows 15-19)
// Wall styles per roof: cols 0-2 (white plaster), 3-5 (stone detail), 6-8 (tan/wood), 9-11 (brick), 12-14 (dark brick)

interface BuildingStyle {
  roofRow: number;   // starting row for this roof color (0, 5, 10, 15)
  wallCol: number;   // starting column for wall style (0, 3, 6, 9, 12)
}

// Castle wall tiles from rows 30-32 of town_B
const CASTLE_STONE = {
  battlementTL: 480, battlementTC: 481, battlementTR: 482,
  wallL: 496, wallC: 497, wallR: 498,
  wallBL: 512, wallBC: 513, wallBR: 514,
  pillar: 515, pillarBase: 516,
};

// Predefined building styles per rank (8 tiers)
const BUILDING_STYLES: Record<string, BuildingStyle[]> = {
  citadel: [
    { roofRow: 0, wallCol: 0 },   // Red roof + white walls (grand)
    { roofRow: 0, wallCol: 3 },   // Red roof + stone detail
  ],
  castle: [
    { roofRow: 0, wallCol: 0 },   // Red roof + white walls
    { roofRow: 5, wallCol: 0 },   // Blue roof + white walls
    { roofRow: 0, wallCol: 3 },   // Red roof + stone detail
  ],
  palace: [
    { roofRow: 5, wallCol: 0 },   // Blue roof + white walls
    { roofRow: 5, wallCol: 3 },   // Blue roof + stone detail
    { roofRow: 0, wallCol: 0 },   // Red roof + white walls
  ],
  keep: [
    { roofRow: 5, wallCol: 0 },   // Blue roof + white walls
    { roofRow: 5, wallCol: 3 },   // Blue roof + stone detail
    { roofRow: 0, wallCol: 3 },   // Red roof + stone detail
  ],
  manor: [
    { roofRow: 10, wallCol: 0 },  // Green roof + white walls
    { roofRow: 10, wallCol: 6 },  // Green roof + tan walls
    { roofRow: 0, wallCol: 6 },   // Red roof + tan
  ],
  guild: [
    { roofRow: 10, wallCol: 6 },  // Green roof + tan walls
    { roofRow: 10, wallCol: 9 },  // Green roof + brick
    { roofRow: 0, wallCol: 9 },   // Red roof + brick
    { roofRow: 5, wallCol: 6 },   // Blue roof + tan
  ],
  cottage: [
    { roofRow: 15, wallCol: 6 },  // Brown roof + tan walls
    { roofRow: 15, wallCol: 9 },  // Brown roof + brick
    { roofRow: 10, wallCol: 6 },  // Green roof + tan
    { roofRow: 0, wallCol: 6 },   // Red roof + tan
  ],
  hovel: [
    { roofRow: 15, wallCol: 12 }, // Brown roof + dark brick
    { roofRow: 15, wallCol: 6 },  // Brown roof + tan
    { roofRow: 10, wallCol: 12 }, // Green roof + dark brick
  ],
};

/**
 * Create a composed building canvas from town_B tiles.
 * Returns a canvas with transparent background.
 */
function composeBuildingCanvas(
  townBImg: HTMLImageElement,
  style: BuildingStyle,
  tileRows: number, // how many rows of the 5-row template to use (3-5)
  tileWidth: number, // tiles wide (3 for normal, 5 for castle)
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const rowOffset = 5 - tileRows; // skip top rows for shorter buildings

  if (tileWidth <= 3) {
    // Standard 3-wide building from a single building block
    canvas.width = 3 * T;
    canvas.height = tileRows * T;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    for (let r = 0; r < tileRows; r++) {
      const srcRow = style.roofRow + rowOffset + r;
      for (let c = 0; c < 3; c++) {
        const srcCol = style.wallCol + c;
        ctx.drawImage(townBImg, srcCol * T, srcRow * T, T, T, c * T, r * T, T, T);
      }
    }
  } else {
    // Wide building (castle): 3-wide building in center + stone walls on sides
    canvas.width = tileWidth * T;
    canvas.height = tileRows * T;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    const margin = Math.floor((tileWidth - 3) / 2);

    for (let r = 0; r < tileRows; r++) {
      const srcRow = style.roofRow + rowOffset + r;
      // Center: the 3-wide building
      for (let c = 0; c < 3; c++) {
        const srcCol = style.wallCol + c;
        ctx.drawImage(townBImg, srcCol * T, srcRow * T, T, T, (margin + c) * T, r * T, T, T);
      }
      // Left/right stone walls
      for (let s = 0; s < margin; s++) {
        let stoneTile: number;
        if (r === 0) stoneTile = s === 0 ? CASTLE_STONE.battlementTL : CASTLE_STONE.battlementTC;
        else if (r === tileRows - 1) stoneTile = s === 0 ? CASTLE_STONE.wallBL : CASTLE_STONE.wallL;
        else stoneTile = s === 0 ? CASTLE_STONE.wallL : CASTLE_STONE.wallC;

        const stoneCol = stoneTile % TOWN_B_COLS;
        const stoneRow = Math.floor(stoneTile / TOWN_B_COLS);
        // Left side
        ctx.drawImage(townBImg, stoneCol * T, stoneRow * T, T, T, s * T, r * T, T, T);

        // Right side (mirror: use TR/R/BR variants)
        let rightTile: number;
        if (r === 0) rightTile = s === margin - 1 ? CASTLE_STONE.battlementTR : CASTLE_STONE.battlementTC;
        else if (r === tileRows - 1) rightTile = s === margin - 1 ? CASTLE_STONE.wallBR : CASTLE_STONE.wallR;
        else rightTile = s === margin - 1 ? CASTLE_STONE.wallR : CASTLE_STONE.wallC;

        const rCol = rightTile % TOWN_B_COLS;
        const rRow = Math.floor(rightTile / TOWN_B_COLS);
        ctx.drawImage(townBImg, rCol * T, rRow * T, T, T, (tileWidth - 1 - s) * T, r * T, T, T);
      }
    }
  }

  return canvas;
}

/**
 * Create building textures for the CityScene.
 * Returns a map of texture keys to canvases.
 */
export function createBuildingTextures(townBImg: HTMLImageElement): Map<string, HTMLCanvasElement> {
  const textures = new Map<string, HTMLCanvasElement>();

  for (const [rank, styles] of Object.entries(BUILDING_STYLES)) {
    for (let i = 0; i < styles.length; i++) {
      const style = styles[i];
      const key = `bldg-${rank}-${i}`;

      let tileRows: number;
      let tileWidth: number;

      switch (rank) {
        case 'citadel':
          tileRows = 5; tileWidth = 7;
          break;
        case 'castle':
          tileRows = 5; tileWidth = 7;
          break;
        case 'palace':
          tileRows = 5; tileWidth = 5;
          break;
        case 'keep':
          tileRows = 5; tileWidth = 5;
          break;
        case 'manor':
          tileRows = 5; tileWidth = 3;
          break;
        case 'guild':
          tileRows = 4; tileWidth = 3; // skip topmost roof row
          break;
        case 'cottage':
          tileRows = 3; tileWidth = 3; // gable + 2 wall rows
          break;
        case 'hovel':
          tileRows = 2; tileWidth = 3; // just upper wall + lower wall
          break;
        default:
          tileRows = 3; tileWidth = 3;
      }

      textures.set(key, composeBuildingCanvas(townBImg, style, tileRows, tileWidth));
    }
  }

  return textures;
}

/**
 * Get a building texture key for a given rank and index (for variety).
 */
export function getBuildingTextureKey(rank: string, seed: number): string {
  const styles = BUILDING_STYLES[rank] || BUILDING_STYLES.cottage;
  const idx = Math.abs(seed) % styles.length;
  return `bldg-${rank}-${idx}`;
}

// ─── Template-based building rendering ──────────────────────

/** Map sheet keys to their SpritePacks image + column count */
function getSheetMap(sp: SpritePacks): Record<string, { img: HTMLImageElement; cols: number }> {
  const map: Record<string, { img: HTMLImageElement; cols: number }> = {};
  if (sp.townBImg)          map['town_B']          = { img: sp.townBImg,          cols: 16 };
  if (sp.townAImg)          map['town_A']          = { img: sp.townAImg,          cols: 13 };
  if (sp.grassBImg)         map['grass_B']         = { img: sp.grassBImg,         cols: 16 };
  if (sp.grassFlowersImg)   map['grass_Flowers']   = { img: sp.grassFlowersImg,   cols: 12 };
  if (sp.doorsOutsideImg)   map['doors_outside']   = { img: sp.doorsOutsideImg,   cols: 3 };
  if (sp.doorsInsideImg)    map['doors_inside']    = { img: sp.doorsInsideImg,    cols: 3 };
  if (sp.townCImg)          map['town_C']          = { img: sp.townCImg,          cols: 15 };
  if (sp.townDImg)          map['town_D']          = { img: sp.townDImg,          cols: 16 };
  return map;
}

/**
 * Render a BuildingTemplate onto a new canvas.
 * Composites all layers (base → main → detail) from their source sheets.
 * If the template is mirrored, the entire canvas is flipped horizontally
 * so directional tiles (roof slopes, decorations) face the right way.
 */
export function renderTemplateToCanvas(
  template: BuildingTemplate,
  spritePacks: SpritePacks,
): HTMLCanvasElement {
  const tmpl = migrateTemplate(template);
  const canvas = document.createElement('canvas');
  canvas.width = tmpl.width * T;
  canvas.height = tmpl.height * T;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  const sheetMap = getSheetMap(spritePacks);

  // Draw all layers bottom-to-top
  for (const layerName of LAYER_ORDER) {
    const layerGrid = tmpl.layers[layerName];
    for (let row = 0; row < tmpl.height; row++) {
      for (let col = 0; col < tmpl.width; col++) {
        const ref = layerGrid[row]?.[col];
        if (!ref) continue;
        const def = sheetMap[ref.sheet];
        if (!def || !def.img) continue;

        const srcCol = ref.frame % def.cols;
        const srcRow = Math.floor(ref.frame / def.cols);
        ctx.drawImage(def.img, srcCol * T, srcRow * T, T, T, col * T, row * T, T, T);
      }
    }
  }

  // If mirrored, flip the entire canvas horizontally
  if (tmpl.mirrored) {
    const flipped = document.createElement('canvas');
    flipped.width = canvas.width;
    flipped.height = canvas.height;
    const fCtx = flipped.getContext('2d')!;
    fCtx.imageSmoothingEnabled = false;
    fCtx.translate(canvas.width, 0);
    fCtx.scale(-1, 1);
    fCtx.drawImage(canvas, 0, 0);
    return flipped;
  }

  return canvas;
}

/**
 * Load template library from a JSON URL.
 */
export async function loadTemplateLibrary(
  url: string = '/assets/buildings/templates.json',
): Promise<BuildingTemplate[]> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const lib = (await resp.json()) as TemplateLibrary;
    return lib.templates || [];
  } catch {
    return [];
  }
}

/**
 * Create building textures from both legacy BUILDING_STYLES and template recipes.
 * Legacy textures are keyed as `bldg-{rank}-{idx}`.
 * Template textures are keyed as `tmpl-{id}`.
 */
export function createBuildingTexturesWithTemplates(
  townBImg: HTMLImageElement,
  spritePacks: SpritePacks,
  templates: BuildingTemplate[],
): Map<string, HTMLCanvasElement> {
  // Start with legacy textures (backward compatible)
  const textures = createBuildingTextures(townBImg);

  // Add template-based textures
  for (const tmpl of templates) {
    const canvas = renderTemplateToCanvas(tmpl, spritePacks);
    textures.set(`tmpl-${tmpl.id}`, canvas);
  }

  return textures;
}

/**
 * Generate template variant textures only (no legacy textures).
 * Expands each template into all visual variations: color swaps × mirrors × deco swaps.
 * Returns the rendered canvases + a rank→textureKey[] mapping for the game to pick from.
 */
export interface VariantEntry { key: string; w: number; h: number }

export function createTemplateVariantTextures(
  spritePacks: SpritePacks,
  templates: BuildingTemplate[],
): { textures: Map<string, HTMLCanvasElement>; variantsByRank: Map<string, VariantEntry[]> } {
  const variants = expandTemplateVariations(templates);
  const textures = new Map<string, HTMLCanvasElement>();
  const variantsByRank = new Map<string, VariantEntry[]>();

  for (const v of variants) {
    const canvas = renderTemplateToCanvas(v.template, spritePacks);
    textures.set(v.textureKey, canvas);

    if (!variantsByRank.has(v.rank)) variantsByRank.set(v.rank, []);
    variantsByRank.get(v.rank)!.push({ key: v.textureKey, w: v.width, h: v.height });
  }

  return { textures, variantsByRank };
}

/**
 * Pick a building texture key — editor templates take priority.
 * When buildingW/H are provided, prefers templates matching the exact
 * footprint size (so a 20×20 building gets a 20×20 template, not a 14×14).
 * Falls back to any template of the same rank, then to legacy textures.
 */
export function pickBuildingTextureKey(
  rank: string,
  seed: number,
  variantsByRank?: Map<string, VariantEntry[]>,
  buildingW?: number,
  buildingH?: number,
): string {
  const variants = variantsByRank?.get(rank) || [];
  if (variants.length > 0) {
    // If building dimensions provided, prefer exact-size matches first
    if (buildingW && buildingH) {
      const sizeMatched = variants.filter(v => v.w === buildingW && v.h === buildingH);
      if (sizeMatched.length > 0) {
        return sizeMatched[Math.abs(seed) % sizeMatched.length].key;
      }
      // Fall back to closest size within same rank
      const sorted = [...variants].sort((a, b) => {
        const da = Math.abs(a.w - buildingW) + Math.abs(a.h - buildingH);
        const db = Math.abs(b.w - buildingW) + Math.abs(b.h - buildingH);
        return da - db;
      });
      // Pick from the closest-size group
      const bestDist = Math.abs(sorted[0].w - buildingW) + Math.abs(sorted[0].h - buildingH);
      const closest = sorted.filter(v =>
        Math.abs(v.w - buildingW) + Math.abs(v.h - buildingH) === bestDist
      );
      return closest[Math.abs(seed) % closest.length].key;
    }
    // No dimensions — pick any variant of this rank
    return variants[Math.abs(seed) % variants.length].key;
  }
  // Fallback: legacy procedural textures for ranks with no templates
  const legacyStyles = BUILDING_STYLES[rank] || BUILDING_STYLES.cottage;
  const idx = Math.abs(seed) % legacyStyles.length;
  return `bldg-${rank}-${idx}`;
}

// ─── Exports ─────────────────────────────────────────────────
export const TILE_SIZE = T;
export const TILESET_COLS = 8;
