export interface RepoData {
  name: string;
  full_name: string;
  description: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  created_at: string;
  pushed_at: string;
  size: number;
  default_branch: string;
  has_wiki: boolean;
  license: { spdx_id: string } | null;
  topics: string[];
}

export interface ContributorData {
  login: string;
  contributions: number;
  avatar_url: string;
}

export interface KingdomMetrics {
  repo: RepoData;
  contributors: ContributorData[];
  totalCommits: number;
  mergedPRs: number;
  king: ContributorData | null;
}

// Settlement tier — individual repo size within a kingdom
export type SettlementTier = 'camp' | 'hamlet' | 'village' | 'town' | 'city' | 'capital';

export type Biome = 'grassland' | 'forest' | 'mountain' | 'volcanic' | 'crystal' | 'desert' | 'tundra';

// ─── City-Builder Model Types ────────────────────────────────

// Building rank within a city — determines visual size (9 tiers, city-builder style)
export type BuildingRank = 'citadel' | 'castle' | 'palace' | 'keep' | 'manor' | 'guild' | 'cottage' | 'hovel' | 'camp';

// What the building "does" based on repo topics
export type BuildingPurpose = 'web' | 'arcane' | 'forge' | 'market' | 'general';

// A building inside a city (represents one repo, or a public civic structure)
export interface CityBuilding {
  repoMetrics?: KingdomMetrics;       // undefined for public buildings
  rank: BuildingRank;                  // castle / keep / guild / cottage / hovel
  purpose: BuildingPurpose;            // based on repo topics
  x: number;                           // tile position within city
  y: number;
  width: number;                       // footprint in tiles
  height: number;
  templateKey?: string;                // texture key for template-based buildings
  isPublic?: boolean;                  // true for civic buildings (fountains, squares, etc.)
  publicName?: string;                 // display name for civic buildings
}

// A citizen (GitHub user) who may own property in multiple cities
export interface CitizenData {
  login: string;
  avatar_url: string;
  totalContributions: number;
  repos: string[];           // repo full_names they contribute to
  cities: string[];          // language names they appear in
}

// Generated city interior data
export interface CityInterior {
  language: string;
  biome: Biome;
  width: number;             // tilemap width
  height: number;            // tilemap height
  terrain: number[][];       // tile IDs
  buildings: CityBuilding[];
  citizens: CitizenData[];
  king: ContributorData | null;
  totalStars: number;
  totalRepos: number;
}

// A language kingdom — groups repos that share a language
export interface LanguageKingdom {
  language: string;        // e.g. "JavaScript", "Python"
  biome: Biome;
  repos: KingdomMetrics[]; // all repos in this language
  king: ContributorData | null; // most commits across ALL repos in this language
  totalCommits: number;    // sum across all repos
  totalStars: number;      // sum across all repos
}

// TODO: Remove deprecated Kingdom type once all references are cleaned up
export interface Kingdom {
  metrics: KingdomMetrics;
  tier: SettlementTier;
  biome: Biome;
  x: number;
  y: number;
  width: number;
  height: number;
  tiles: number[][];
}

// Tile IDs
export const TILES = {
  WATER_DEEP: 0,
  WATER: 1,
  SAND: 2,
  GRASS: 3,
  GRASS_DARK: 4,
  FOREST: 5,
  MOUNTAIN: 6,
  SNOW: 7,
  ROAD: 8,
  HOUSE: 9,
  HOUSE_LARGE: 10,
  CASTLE_WALL: 11,
  CASTLE_TOWER: 12,
  CASTLE_GATE: 13,
  CASTLE_ROOF: 14,
  BANNER: 15,
  MARKET: 16,
  CHURCH: 17,
  MONSTER_DEN: 18,
  QUEST_BOARD: 19,
  BRIDGE: 20,
  DOCK: 21,
  RUINS: 22,
  MONUMENT: 23,
  LAVA: 24,
  CRYSTAL: 25,

  // ── Coastline auto-tiles ──
  // Sand base with water bleeding in from indicated edges
  // Bitmask: N=1, E=2, S=4, W=8
  COAST_1: 26,   // water N
  COAST_2: 27,   // water E
  COAST_3: 28,   // water N+E
  COAST_4: 29,   // water S
  COAST_5: 30,   // water N+S
  COAST_6: 31,   // water E+S
  COAST_7: 32,   // water N+E+S
  COAST_8: 33,   // water W
  COAST_9: 34,   // water N+W
  COAST_10: 35,  // water E+W
  COAST_11: 36,  // water N+E+W
  COAST_12: 37,  // water S+W
  COAST_13: 38,  // water N+S+W
  COAST_14: 39,  // water E+S+W
  COAST_15: 40,  // water N+E+S+W

  // ── Shore auto-tiles ──
  // Grass base with sand bleeding in from indicated edges
  // Same bitmask convention
  SHORE_1: 41,
  SHORE_2: 42,
  SHORE_3: 43,
  SHORE_4: 44,
  SHORE_5: 45,
  SHORE_6: 46,
  SHORE_7: 47,
  SHORE_8: 48,
  SHORE_9: 49,
  SHORE_10: 50,
  SHORE_11: 51,
  SHORE_12: 52,
  SHORE_13: 53,
  SHORE_14: 54,
  SHORE_15: 55,

  // ── City grass tiles (town_A spritesheet) ──
  // Detailed grass textures for town/city areas
  CITY_GRASS_1: 56,  // town_A frame 50
  CITY_GRASS_2: 57,  // town_A frame 51
  CITY_GRASS_3: 58,  // town_A frame 89
  CITY_GRASS_4: 59,  // town_A frame 90
  CITY_GRASS_5: 60,  // town_A frame 102
  CITY_GRASS_6: 61,  // town_A frame 103
} as const;

export type TileId = (typeof TILES)[keyof typeof TILES];

// Bitmask → tile ID lookup for coastline (sand→water transitions)
export const COAST_BITMASK: Record<number, number> = {};
for (let mask = 1; mask <= 15; mask++) {
  COAST_BITMASK[mask] = TILES.COAST_1 + (mask - 1);
}

// Bitmask → tile ID lookup for shore (grass→sand transitions)
export const SHORE_BITMASK: Record<number, number> = {};
for (let mask = 1; mask <= 15; mask++) {
  SHORE_BITMASK[mask] = TILES.SHORE_1 + (mask - 1);
}

// Terrain classification helpers
export function isWaterTile(t: number): boolean {
  return t === TILES.WATER || t === TILES.WATER_DEEP;
}

export function isSandTile(t: number): boolean {
  return t === TILES.SAND || (t >= TILES.COAST_1 && t <= TILES.COAST_15);
}

export function isLandTile(t: number): boolean {
  return !isWaterTile(t) && t !== TILES.WATER_DEEP;
}

// Walkability for collision map
const WALKABLE = new Set<number>([
  TILES.SAND, TILES.GRASS, TILES.GRASS_DARK, TILES.ROAD, TILES.SNOW,
  TILES.CASTLE_GATE, TILES.BRIDGE,
]);
// Add all coast and shore tiles as walkable
for (let i = TILES.COAST_1; i <= TILES.SHORE_15; i++) WALKABLE.add(i);
// Add city grass tiles as walkable
for (let i = TILES.CITY_GRASS_1; i <= TILES.CITY_GRASS_6; i++) WALKABLE.add(i);

export function isWalkable(t: number): boolean {
  return WALKABLE.has(t);
}
