// ─── Building Editor Shared Types ────────────────────────────────

/** Reference to a single 16×16 tile from a specific spritesheet */
export interface TileRef {
  sheet: string;   // e.g. 'town_B', 'grass_B', 'grass_Flowers'
  frame: number;   // tile index: col + row * cols
}

/** Layer names — painted bottom to top */
export type LayerName = 'base' | 'main' | 'detail';
export const LAYER_ORDER: LayerName[] = ['base', 'main', 'detail'];

/** All layers in a building template */
export interface TemplateLayers {
  base:   (TileRef | null)[][];  // floors, paths, terrain
  main:   (TileRef | null)[][];  // walls, roofs, structure
  detail: (TileRef | null)[][];  // fences, signs, flowers on top
}

/** A complete building template recipe */
export interface BuildingTemplate {
  id: string;                     // unique slug, e.g. 'tavern-01'
  name: string;                   // human-readable display name
  width: number;                  // footprint width in tiles
  height: number;                 // footprint height in tiles
  layers: TemplateLayers;         // multi-layer tile grids
  /** When true, the renderer flips the entire canvas horizontally */
  mirrored?: boolean;
  /** @deprecated — old single-layer format; migrated to layers.main on load */
  tiles?: (TileRef | null)[][];
  tags?: string[];                // optional metadata: ['cottage', 'red']
}

/** A collection of saved templates */
export interface TemplateLibrary {
  version: number;
  templates: BuildingTemplate[];
}

/** Category within a spritesheet (for palette organization) */
export interface SheetCategory {
  name: string;
  startFrame: number;
  endFrame: number;   // inclusive
}

/** Spritesheet metadata for the palette */
export interface SheetDef {
  key: string;           // internal key matching TileRef.sheet
  label: string;         // display name in palette tabs
  src: string;           // asset path
  cols: number;          // columns in the spritesheet
  rows: number;          // rows in the spritesheet
  tileSize: number;      // always 16 for this project
  categories?: SheetCategory[];
}

// ─── Utility: create empty layer grid ────────────────────────────

export function emptyLayerGrid(w: number, h: number): (TileRef | null)[][] {
  const grid: (TileRef | null)[][] = [];
  for (let r = 0; r < h; r++) {
    grid.push(new Array(w).fill(null));
  }
  return grid;
}

export function emptyLayers(w: number, h: number): TemplateLayers {
  return {
    base:   emptyLayerGrid(w, h),
    main:   emptyLayerGrid(w, h),
    detail: emptyLayerGrid(w, h),
  };
}

/** Migrate old single-layer `tiles` format to `layers` */
export function migrateTemplate(tmpl: any): BuildingTemplate {
  if (tmpl.layers) return tmpl as BuildingTemplate;
  // Old format: tiles[][] → layers.main
  const w = tmpl.width || 3;
  const h = tmpl.height || 5;
  return {
    ...tmpl,
    layers: {
      base:   emptyLayerGrid(w, h),
      main:   tmpl.tiles || emptyLayerGrid(w, h),
      detail: emptyLayerGrid(w, h),
    },
  };
}

// ─── Sheet Definitions ──────────────────────────────────────────

export const SHEET_DEFS: SheetDef[] = [
  {
    key: 'town_B',
    label: 'Buildings',
    src: '/assets/town/town_B.png',
    cols: 16,
    rows: 37,
    tileSize: 16,
    categories: [
      { name: 'Red Building',   startFrame: 0,   endFrame: 79  },   // rows 0-4:  red roofs + walls + doors
      { name: 'Blue Building',  startFrame: 80,  endFrame: 159 },   // rows 5-9:  blue roofs + walls + doors
      { name: 'Green Building', startFrame: 160, endFrame: 239 },   // rows 10-14: green roofs + walls + doors
      { name: 'Brown Building', startFrame: 240, endFrame: 319 },   // rows 15-19: brown roofs + walls + doors
      { name: 'Props',          startFrame: 320, endFrame: 399 },   // rows 20-24: trees, planters, signs, chests
      { name: 'Furniture',      startFrame: 400, endFrame: 479 },   // rows 25-29: benches, fences, barrels
      { name: 'Castle',         startFrame: 480, endFrame: 543 },   // rows 30-33: castle stone walls, gates
      { name: 'Town Deco',      startFrame: 544, endFrame: 591 },   // rows 34-36: fountain, lamps, large features
    ],
  },
  {
    key: 'grass_B',
    label: 'Nature',
    src: '/assets/grasslands/B.png',
    cols: 16,
    rows: 16,
    tileSize: 16,
    categories: [
      { name: 'Trees & Rocks', startFrame: 0,   endFrame: 63  },
      { name: 'Fences',        startFrame: 64,  endFrame: 127 },
      { name: 'Bushes & Misc', startFrame: 128, endFrame: 255 },
    ],
  },
  {
    key: 'grass_Flowers',
    label: 'Flowers',
    src: '/assets/grasslands/Flowers.png',
    cols: 12,
    rows: 8,
    tileSize: 16,
  },
  {
    key: 'town_A',
    label: 'Floors',
    src: '/assets/town/town_A.png',
    cols: 13,
    rows: 16,
    tileSize: 16,
    categories: [
      { name: 'Paths & Ground', startFrame: 0,   endFrame: 103 },
      { name: 'Detail',         startFrame: 104, endFrame: 207 },
    ],
  },
  {
    key: 'doors_outside',
    label: 'Doors (Out)',
    src: '/assets/town/doors_outside.png',
    cols: 3,
    rows: 8,
    tileSize: 16,
  },
  {
    key: 'doors_inside',
    label: 'Doors (In)',
    src: '/assets/town/doors_inside.png',
    cols: 3,
    rows: 8,
    tileSize: 16,
  },
  {
    key: 'town_C',
    label: 'Floors+',
    src: '/assets/town/town_C.png',
    cols: 15,
    rows: 30,
    tileSize: 16,
    categories: [
      { name: 'Wood Floors',     startFrame: 0,   endFrame: 59  },   // rows 0-3:  planks, brick
      { name: 'Colored Carpets', startFrame: 60,  endFrame: 179 },   // rows 4-11: purple/red/green patterns & fills
      { name: 'Water & Ponds',   startFrame: 300, endFrame: 449 },   // rows 20-29: light/dark blue water autotiles
    ],
  },
  {
    key: 'town_D',
    label: 'Interiors',
    src: '/assets/town/town_D.png',
    cols: 16,
    rows: 28,
    tileSize: 16,
    categories: [
      { name: 'Castle Walls',    startFrame: 0,   endFrame: 47  },   // rows 0-2:  stone, brick interior walls
      { name: 'Shelves & Storage',startFrame: 48,  endFrame: 143 },   // rows 3-8:  bookshelves, kitchen, beds, chests
      { name: 'Furniture',       startFrame: 144, endFrame: 239 },   // rows 9-14: curtains, desks, windows, doors
      { name: 'Market & Goods',  startFrame: 240, endFrame: 335 },   // rows 15-20: crates, vegetables, market stalls
      { name: 'Weapons & Armor', startFrame: 336, endFrame: 447 },   // rows 21-27: shields, banners, weapons, armor
    ],
  },
];
