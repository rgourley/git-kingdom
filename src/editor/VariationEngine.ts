import { BuildingTemplate, TileRef, LAYER_ORDER, LayerName, TemplateLayers, emptyLayerGrid, migrateTemplate } from './types';
import { BuildingRank } from '../types';

// ─── Color Block Mapping ─────────────────────────────────────────
// town_B.png uses 5-row blocks per building color, starting at these rows.
// Each block contains 3 rows of roof tiles + 2 rows of matching wall tiles.
// The entire 5-row block is swapped together so walls match the new roof color.
const COLOR_BLOCK_ROWS: Record<string, number> = {
  red:   0,    // rows 0-4 (roofs 0-2, walls 3-4)
  blue:  5,    // rows 5-9 (roofs 5-7, walls 8-9)
  green: 10,   // rows 10-14 (roofs 10-12, walls 13-14)
  brown: 15,   // rows 15-19 (roofs 15-17, walls 18-19)
};

const TOWN_B_COLS = 16;
const COLOR_BLOCK_SIZE = 5; // full 5-row block: roofs + matching walls

/**
 * Detect which color block a template uses by scanning all layers
 * for town_B tiles in any of the 5-row color block ranges.
 */
export function detectRoofColor(template: BuildingTemplate): string | null {
  const tmpl = migrateTemplate(template);
  for (const layerName of LAYER_ORDER) {
    const grid = tmpl.layers[layerName];
    for (const row of grid) {
      for (const cell of row) {
        if (!cell || cell.sheet !== 'town_B') continue;
        const r = Math.floor(cell.frame / TOWN_B_COLS);
        for (const [color, startRow] of Object.entries(COLOR_BLOCK_ROWS)) {
          if (r >= startRow && r < startRow + COLOR_BLOCK_SIZE) {
            return color;
          }
        }
      }
    }
  }
  return null;
}

/** Swap color block tile frames (roofs + walls) in a single layer grid */
function swapLayerRoof(
  grid: (TileRef | null)[][],
  fromRow: number,
  delta: number,
): (TileRef | null)[][] {
  return grid.map(row =>
    row.map(cell => {
      if (!cell || cell.sheet !== 'town_B') return cell;
      const cellRow = Math.floor(cell.frame / TOWN_B_COLS);
      if (cellRow >= fromRow && cellRow < fromRow + COLOR_BLOCK_SIZE) {
        return { ...cell, frame: cell.frame + delta };
      }
      return cell;
    }),
  );
}

/**
 * Swap the entire color block (roof + wall tiles) in a template across all layers.
 */
export function swapRoofColor(
  template: BuildingTemplate,
  fromColor: string,
  toColor: string,
): BuildingTemplate {
  const tmpl = migrateTemplate(template);
  const fromRow = COLOR_BLOCK_ROWS[fromColor];
  const toRow = COLOR_BLOCK_ROWS[toColor];
  if (fromRow === undefined || toRow === undefined) return tmpl;
  if (fromRow === toRow) return tmpl;

  const delta = (toRow - fromRow) * TOWN_B_COLS;

  const newLayers: TemplateLayers = {
    base:   swapLayerRoof(tmpl.layers.base, fromRow, delta),
    main:   swapLayerRoof(tmpl.layers.main, fromRow, delta),
    detail: swapLayerRoof(tmpl.layers.detail, fromRow, delta),
  };

  return { ...tmpl, id: tmpl.id + `-${toColor}`, layers: newLayers };
}

/**
 * Mirror a template horizontally.
 * Sets a `mirrored` flag so the renderer flips the entire canvas,
 * which correctly mirrors directional tiles (roof slopes, decorations, etc.).
 */
export function mirrorHorizontal(template: BuildingTemplate): BuildingTemplate {
  const tmpl = migrateTemplate(template);
  return { ...tmpl, id: tmpl.id + '-mirror', mirrored: true };
}

/**
 * Generate up to `count` color variations of a template.
 */
export function generateVariations(
  template: BuildingTemplate,
  count: number = 4,
): BuildingTemplate[] {
  const tmpl = migrateTemplate(template);
  const baseColor = detectRoofColor(tmpl);
  if (!baseColor) return [tmpl];

  const colors = Object.keys(COLOR_BLOCK_ROWS);
  const variations: BuildingTemplate[] = [tmpl];

  for (const color of colors) {
    if (color === baseColor) continue;
    if (variations.length >= count) break;
    variations.push(swapRoofColor(tmpl, baseColor, color));
  }

  return variations;
}

// ─── Decoration Families ─────────────────────────────────────

/** Groups of interchangeable decoration tiles */
interface DecoFamily {
  sheet: string;
  frames: number[];
}

const DECO_FAMILIES: DecoFamily[] = [
  // Town B flower pots (yellow, red, pink, blue, white variants)
  { sheet: 'town_B', frames: [353, 354, 355, 369, 370, 371, 385, 386, 401, 402] },
  // Town B signs
  { sheet: 'town_B', frames: [360, 361, 375, 376] },
  // Town B potted trees/bushes
  { sheet: 'town_B', frames: [337, 338, 339, 340, 341, 342] },
  // Town B benches
  { sheet: 'town_B', frames: [379, 380] },
  // Grass flowers (all small flower variants)
  { sheet: 'grass_Flowers', frames: [0, 1, 2, 3, 12, 13, 14, 15, 24, 25, 26, 27, 36, 37, 38, 39, 48, 49, 50, 51] },
];

function findDecoFamily(ref: TileRef): DecoFamily | null {
  for (const fam of DECO_FAMILIES) {
    if (ref.sheet === fam.sheet && fam.frames.includes(ref.frame)) return fam;
  }
  return null;
}

/** Simple string hash for deterministic seeding */
function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Seeded PRNG */
function seededRng(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Swap decoration tiles in the detail layer with alternatives
 * from the same family (flowers → different flowers, signs → different signs).
 */
export function swapDecorations(
  template: BuildingTemplate,
  seed: number = 42,
): BuildingTemplate {
  const tmpl = migrateTemplate(template);
  const rand = seededRng(seed);

  const newDetail = tmpl.layers.detail.map(row =>
    row.map(cell => {
      if (!cell) return null;
      const family = findDecoFamily(cell);
      if (!family) return { ...cell };
      const others = family.frames.filter(f => f !== cell.frame);
      if (others.length === 0) return { ...cell };
      return { sheet: family.sheet, frame: others[Math.floor(rand() * others.length)] };
    }),
  );

  return {
    ...tmpl,
    id: tmpl.id + `-deco${seed}`,
    layers: { ...tmpl.layers, detail: newDetail },
  };
}

// ─── Footprint → Rank Mapping ────────────────────────────────

/**
 * Map a template's footprint to a building rank (8 tiers).
 * Uses the average of both dimensions so that rectangular templates
 * classify intuitively (e.g. 3×5 → avg 4 → guild, not manor).
 * Square templates match sizeToRank() exactly since avg(n,n) = n.
 *
 *   citadel — avg side ≥ 14
 *   castle  — avg side ≥ 10
 *   palace  — avg side ≥ 8
 *   keep    — avg side ≥ 6
 *   manor   — avg side ≥ 5
 *   guild   — avg side ≥ 4
 *   cottage — avg side ≥ 3
 *   hovel   — avg side < 3
 */
export function footprintToRank(w: number, h: number): BuildingRank {
  const side = Math.round((w + h) / 2);
  if (side >= 14) return 'citadel';
  if (side >= 10) return 'castle';
  if (side >= 8)  return 'palace';
  if (side >= 6)  return 'keep';
  if (side >= 5)  return 'manor';
  if (side >= 4)  return 'guild';
  if (side >= 3)  return 'cottage';
  return 'hovel';
}

// ─── Template Variation Expansion ────────────────────────────

/** A generated variation with metadata for the game engine */
export interface TemplateVariant {
  textureKey: string;
  rank: BuildingRank;
  width: number;
  height: number;
  template: BuildingTemplate;
}

/**
 * Expand a list of templates into all visual variations:
 * - Roof color swaps (red, blue, green, brown) if roof tiles detected
 * - Mirrored version of each color swap (with decoration swaps for extra variety)
 */
export function expandTemplateVariations(templates: BuildingTemplate[]): TemplateVariant[] {
  const variants: TemplateVariant[] = [];

  for (const raw of templates) {
    const tmpl = migrateTemplate(raw);
    const rank = footprintToRank(tmpl.width, tmpl.height);
    const baseColor = detectRoofColor(tmpl);
    const roofColors = ['red', 'blue', 'green', 'brown'];

    // Collect color variants (including original)
    const colorVariants: BuildingTemplate[] = [tmpl];
    if (baseColor) {
      for (const c of roofColors) {
        if (c === baseColor) continue;
        colorVariants.push(swapRoofColor(tmpl, baseColor, c));
      }
    }

    // For each color: add original + mirrored with decoration swaps for variety
    for (const cv of colorVariants) {
      // Normal orientation (keep original decorations)
      variants.push({
        textureKey: `tmpl-${cv.id}`,
        rank,
        width: tmpl.width,
        height: tmpl.height,
        template: cv,
      });

      // Mirrored with swapped decorations (flowers, signs, etc.) for extra variety
      const mirrored = mirrorHorizontal(cv);
      const decoSwapped = swapDecorations(mirrored, simpleHash(mirrored.id));
      variants.push({
        textureKey: `tmpl-${decoSwapped.id}`,
        rank,
        width: tmpl.width,
        height: tmpl.height,
        template: decoSwapped,
      });
    }
  }

  return variants;
}
