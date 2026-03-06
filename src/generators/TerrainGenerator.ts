import { TILES } from '../types';

// Simple seeded pseudo-random for deterministic generation
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// TODO: Upgrade to Simplex noise for smoother terrain — value noise produces visible grid artifacts
function createNoise(seed: number) {
  const rand = mulberry32(seed);
  const SIZE = 256;
  const grid: number[] = [];
  for (let i = 0; i < SIZE * SIZE; i++) {
    grid.push(rand());
  }

  function smoothNoise(x: number, y: number): number {
    const ix = Math.floor(x) & (SIZE - 1);
    const iy = Math.floor(y) & (SIZE - 1);
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);

    const ix1 = (ix + 1) & (SIZE - 1);
    const iy1 = (iy + 1) & (SIZE - 1);

    const v00 = grid[iy * SIZE + ix];
    const v10 = grid[iy * SIZE + ix1];
    const v01 = grid[iy1 * SIZE + ix];
    const v11 = grid[iy1 * SIZE + ix1];

    // bilinear interpolation with smoothstep
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);

    const top = v00 + sx * (v10 - v00);
    const bot = v01 + sx * (v11 - v01);
    return top + sy * (bot - top);
  }

  return function fractalNoise(x: number, y: number, octaves = 4): number {
    let val = 0;
    let amp = 1;
    let freq = 1;
    let max = 0;
    for (let i = 0; i < octaves; i++) {
      val += smoothNoise(x * freq, y * freq) * amp;
      max += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return val / max;
  };
}

export function generateWorldTerrain(width: number, height: number, seed = 42): number[][] {
  const noise = createNoise(seed);
  const tiles: number[][] = [];

  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      // sample noise at a scale that gives nice terrain features
      const scale = 0.04;
      const n = noise(x * scale, y * scale, 4);

      // also add a secondary noise layer for variation
      const n2 = noise(x * scale * 2 + 100, y * scale * 2 + 100, 2);

      let tile: number;
      if (n < 0.25) {
        tile = TILES.WATER_DEEP;
      } else if (n < 0.32) {
        tile = TILES.WATER;
      } else if (n < 0.36) {
        tile = TILES.SAND;
      } else if (n < 0.6) {
        tile = n2 > 0.6 ? TILES.GRASS_DARK : TILES.GRASS;
      } else if (n < 0.72) {
        tile = n2 > 0.5 ? TILES.FOREST : TILES.GRASS_DARK;
      } else if (n < 0.85) {
        tile = TILES.MOUNTAIN;
      } else {
        tile = TILES.SNOW;
      }

      row.push(tile);
    }
    tiles.push(row);
  }

  return tiles;
}
