import Phaser from 'phaser';
import { LanguageKingdom, TILES, CityBuilding, CityInterior } from '../types';
import { generateTileset, TILE_SIZE, TILESET_MARGIN, TILESET_SPACING, SpritePacks, GRASS_B_FRAMES, GRASS_FLOWER_FRAMES, TOWN_B_DECO, TREE_DEFS, loadTemplateLibrary, createTemplateVariantTextures, pickBuildingTextureKey, createBuildingTextures, getBuildingTextureKey } from '../generators/TilesetGenerator';
import { generateCityInterior, placePublicBuildings } from '../generators/CityGenerator';
import { expandTemplateVariations } from '../editor/VariationEngine';
import { generateTestRepos } from '../testdata';

// Citizen sprite definitions (reused from CityScene)
const CITIZEN_SPRITE_DEFS = [
  { key: 'citizen-queen', file: '/assets/citizens/MiniQueen.png' },
  { key: 'citizen-noble-m', file: '/assets/citizens/MiniNobleMan.png' },
  { key: 'citizen-noble-w', file: '/assets/citizens/MiniNobleWoman.png' },
  { key: 'citizen-princess', file: '/assets/citizens/MiniPrincess.png' },
  { key: 'citizen-villager-m', file: '/assets/citizens/MiniVillagerMan.png' },
  { key: 'citizen-villager-w', file: '/assets/citizens/MiniVillagerWoman.png' },
  { key: 'citizen-peasant', file: '/assets/citizens/MiniPeasant.png' },
  { key: 'citizen-worker', file: '/assets/citizens/MiniWorker.png' },
  { key: 'citizen-old-m', file: '/assets/citizens/MiniOldMan.png' },
  { key: 'citizen-old-w', file: '/assets/citizens/MiniOldWoman.png' },
];

interface TitleCitizen {
  sprite: Phaser.GameObjects.Sprite;
  key: string;
  currentTile: [number, number];
  targetTile: [number, number] | null;
  speed: number;
  waitTimer: number;
}

interface BuildingSpriteRef {
  sprite: Phaser.GameObjects.Image;
  rank: string;
  seed: number;
}

function seededRandom(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * TitleScene — A decorative demo city that runs behind the entry modal.
 * Renders a fake city with editor-created building templates and walking citizens.
 * No interaction, no labels, no UI — purely visual ambiance.
 */
export class TitleScene extends Phaser.Scene {
  private citizens: TitleCitizen[] = [];
  private terrain: number[][] = [];
  private cityW = 0;
  private cityH = 0;
  private buildingSpriteRefs: BuildingSpriteRef[] = [];

  constructor() {
    super({ key: 'TitleScene' });
  }

  create() {
    try {
      const data = this.scene.settings.data as { spritePacks?: SpritePacks };
      const spritePacks = data?.spritePacks;

      // Generate a demo kingdom from synthetic data
      const testMetrics = generateTestRepos(25);
      const kingdom: LanguageKingdom = {
        language: 'TypeScript',
        biome: 'grassland',
        repos: testMetrics,
        king: testMetrics[0].king,
        totalCommits: testMetrics.reduce((s, r) => s + r.totalCommits, 0),
        totalStars: testMetrics.reduce((s, r) => s + r.repo.stargazers_count, 0),
      };

      const city = generateCityInterior(kingdom);
      const { width: W, height: H, terrain, buildings } = city;
      this.terrain = terrain;
      this.cityW = W;
      this.cityH = H;

      // Generate tileset
      if (!this.textures.exists('tileset')) {
        const tilesetCanvas = generateTileset(spritePacks);
        this.textures.addCanvas('tileset', tilesetCanvas);
      }

      // Register deco spritesheets
      if (spritePacks?.grassBImg && spritePacks.grassBImg.width > 0) {
        if (!this.textures.exists('grass-b')) {
          try {
            this.textures.addSpriteSheet('grass-b', spritePacks.grassBImg, {
              frameWidth: 16, frameHeight: 16,
            });
          } catch (e) { /* ignore */ }
        }
      }
      if (spritePacks?.grassTreesImg && spritePacks.grassTreesImg.width > 0) {
        for (const def of TREE_DEFS) {
          const key = `tree-${def.name}`;
          if (!this.textures.exists(key)) {
            const tc = document.createElement('canvas');
            tc.width = 32; tc.height = 32;
            const tctx = tc.getContext('2d')!;
            tctx.imageSmoothingEnabled = false;
            const img = spritePacks.grassTreesImg;
            tctx.drawImage(img, def.col * 16, 0, 16, 16, 0, 0, 16, 16);
            tctx.drawImage(img, (def.col + 1) * 16, 0, 16, 16, 16, 0, 16, 16);
            tctx.drawImage(img, def.col * 16, 16, 16, 16, 0, 16, 16, 16);
            tctx.drawImage(img, (def.col + 1) * 16, 16, 16, 16, 16, 16, 16, 16);
            this.textures.addCanvas(key, tc);
          }
        }
      }
      if (spritePacks?.grassFlowersImg && spritePacks.grassFlowersImg.width > 0) {
        if (!this.textures.exists('grass-flowers')) {
          try {
            this.textures.addSpriteSheet('grass-flowers', spritePacks.grassFlowersImg, {
              frameWidth: 16, frameHeight: 16,
            });
          } catch (e) { /* ignore */ }
        }
      }
      if (spritePacks?.townBImg && spritePacks.townBImg.width > 0) {
        if (!this.textures.exists('town-b')) {
          try {
            this.textures.addSpriteSheet('town-b', spritePacks.townBImg, {
              frameWidth: 16, frameHeight: 16,
            });
          } catch (e) { /* ignore */ }
        }
      }

      // Legacy building textures as fallback (in case templates.json isn't loaded yet)
      if (spritePacks?.townBImg) {
        const bldgTextures = createBuildingTextures(spritePacks.townBImg);
        for (const [key, canvas] of bldgTextures) {
          if (!this.textures.exists(key)) {
            this.textures.addCanvas(key, canvas);
          }
        }
      }

      // Draw a large grass fill behind the tilemap so edges aren't black
      const pad = 600; // pixels of countryside beyond the city edges
      const bgGrass = this.add.graphics();
      bgGrass.fillStyle(0x4a7c3f, 1); // dark grass green
      bgGrass.fillRect(-pad, -pad, W * TILE_SIZE + pad * 2, H * TILE_SIZE + pad * 2);
      bgGrass.setDepth(-2);

      // Scatter trees & bushes in the padding area
      const bgRand = seededRandom(77);
      for (let i = 0; i < 80; i++) {
        const side = Math.floor(bgRand() * 4); // 0=top, 1=bottom, 2=left, 3=right
        let px: number, py: number;
        if (side === 0) { px = bgRand() * (W * TILE_SIZE + pad * 2) - pad; py = -bgRand() * pad; }
        else if (side === 1) { px = bgRand() * (W * TILE_SIZE + pad * 2) - pad; py = H * TILE_SIZE + bgRand() * pad; }
        else if (side === 2) { px = -bgRand() * pad; py = bgRand() * (H * TILE_SIZE + pad * 2) - pad; }
        else { px = W * TILE_SIZE + bgRand() * pad; py = bgRand() * (H * TILE_SIZE + pad * 2) - pad; }

        const treeDef = TREE_DEFS[Math.floor(bgRand() * TREE_DEFS.length)];
        const treeKey = `tree-${treeDef.name}`;
        if (this.textures.exists(treeKey)) {
          const tree = this.add.image(px, py, treeKey);
          tree.setDepth(-1);
          tree.setScale(1 + bgRand() * 0.5);
        }
      }

      // Render tilemap
      const map = this.make.tilemap({
        tileWidth: TILE_SIZE, tileHeight: TILE_SIZE,
        width: W, height: H,
      });
      map.addTilesetImage('tileset', 'tileset', TILE_SIZE, TILE_SIZE, TILESET_MARGIN, TILESET_SPACING)!;
      const layer = map.createBlankLayer('terrain', 'tileset', 0, 0, W, H)!;
      layer.putTilesAt(terrain, 0, 0);

      // Place decorations
      this.placeTitleDecorations(terrain, W, H, buildings);

      // Place building sprites (with legacy textures first, templates swap in async)
      for (const b of buildings) {
        const seed = b.x * 7 + b.y * 3;
        const texKey = getBuildingTextureKey(b.rank, seed);
        if (!this.textures.exists(texKey)) continue;
        const footCenterX = (b.x + b.width / 2) * TILE_SIZE;
        const footBottomY = (b.y + b.height) * TILE_SIZE;
        const sprite = this.add.image(footCenterX, footBottomY, texKey);
        sprite.setOrigin(0.5, 1);
        sprite.setDepth(4 + (b.y + b.height) / H * 2);
        this.buildingSpriteRefs.push({ sprite, rank: b.rank, seed });
      }

      // Async: load editor-created building templates and swap in
      this.loadAndApplyTemplates(spritePacks, city, H).catch(e =>
        console.warn('[TitleScene] Template load error:', e)
      );

      // Disable all input — title screen is non-interactive
      this.input.enabled = false;

      // Camera: zoomed in, centered on densest building cluster
      this.cameras.main.setBounds(-pad, -pad, W * TILE_SIZE + pad * 2, H * TILE_SIZE + pad * 2);
      this.cameras.main.setZoom(1.8);

      // Center on smaller buildings (skip the castle) for more visual variety
      const smallBuildings = buildings.filter(b => b.rank !== 'castle' && b.rank !== 'keep');
      const target = smallBuildings.length > 3 ? smallBuildings : buildings;
      if (target.length > 0) {
        // Weighted centroid — prefer clusters of smaller buildings
        let sumX = 0, sumY = 0;
        for (const b of target) {
          sumX += (b.x + b.width / 2);
          sumY += (b.y + b.height / 2);
        }
        const avgX = (sumX / target.length) * TILE_SIZE;
        const avgY = (sumY / target.length) * TILE_SIZE;
        // Nudge toward bottom-right for more building variety in frame
        const nudgeX = W * TILE_SIZE * 0.12;
        const nudgeY = H * TILE_SIZE * 0.12;
        this.cameras.main.centerOn(avgX + nudgeX, avgY + nudgeY);
      } else {
        this.cameras.main.centerOn((W / 2) * TILE_SIZE, (H / 2) * TILE_SIZE);
      }
      this.cameras.main.setRoundPixels(true);

      // Load citizen sprites
      let needsLoad = false;
      for (const def of CITIZEN_SPRITE_DEFS) {
        if (!this.textures.exists(def.key)) {
          this.load.spritesheet(def.key, def.file, { frameWidth: 32, frameHeight: 32 });
          needsLoad = true;
        }
      }
      if (needsLoad) {
        this.load.once('complete', () => {
          this.createAnimations();
          this.spawnCitizens();
        });
        this.load.start();
      } else {
        this.createAnimations();
        this.spawnCitizens();
      }

      console.log(`[TitleScene] Demo city: ${W}x${H}, ${buildings.length} buildings`);
    } catch (err) {
      console.error('[TitleScene] Error:', err);
    }
  }

  update(_time: number, delta: number) {
    this.updateCitizens(delta);
  }

  // ── Load editor templates and swap building sprites ─────────

  private async loadAndApplyTemplates(
    spritePacks: SpritePacks | undefined,
    city: CityInterior,
    mapHeight: number,
  ) {
    if (!spritePacks?.townBImg) return;

    try {
      const templates = await loadTemplateLibrary();
      if (templates.length === 0) return;

      // Split into repo-buildings vs public/civic
      const repoTemplates = templates.filter(t => !t.tags?.includes('public'));
      const publicTemplates = templates.filter(t => t.tags?.includes('public'));

      // Expand repo templates into all variations (color swaps, mirrors, deco swaps)
      if (repoTemplates.length > 0) {
        const { textures, variantsByRank } = createTemplateVariantTextures(spritePacks, repoTemplates);

        for (const [key, canvas] of textures) {
          if (!this.textures.exists(key)) {
            this.textures.addCanvas(key, canvas);
          }
        }

        // Swap building sprites to use editor template textures
        for (const ref of this.buildingSpriteRefs) {
          const newKey = pickBuildingTextureKey(ref.rank, ref.seed, variantsByRank);
          if (newKey !== ref.sprite.texture.key && this.textures.exists(newKey)) {
            ref.sprite.setTexture(newKey);
          }
        }

        console.log(`[TitleScene] Templates loaded: ${repoTemplates.length} base → ${[...variantsByRank.values()].reduce((n, arr) => n + arr.length, 0)} variants`);
      }

      // Place public/civic buildings (fountains, squares, etc.)
      if (publicTemplates.length > 0) {
        const publicVariants = expandTemplateVariations(publicTemplates);
        const { textures: pubTextures } = createTemplateVariantTextures(spritePacks, publicTemplates);
        for (const [key, canvas] of pubTextures) {
          if (!this.textures.exists(key)) {
            this.textures.addCanvas(key, canvas);
          }
        }

        const newBuildings = placePublicBuildings(city, publicVariants);
        for (const b of newBuildings) {
          const texKey = b.templateKey || '';
          if (texKey && this.textures.exists(texKey)) {
            const footCenterX = (b.x + b.width / 2) * TILE_SIZE;
            const footBottomY = (b.y + b.height) * TILE_SIZE;
            const sprite = this.add.image(footCenterX, footBottomY, texKey);
            sprite.setOrigin(0.5, 1);
            sprite.setDepth(4 + (b.y + b.height) / mapHeight * 2);
          }
        }
      }
    } catch (err) {
      console.warn('[TitleScene] Template loading failed, using legacy buildings:', err);
    }
  }

  // ── Rich decorations (using existing project sprites) ──────

  private placeTitleDecorations(terrain: number[][], W: number, H: number, buildings: CityBuilding[]) {
    const rand = seededRandom(42);
    const hasTownB = this.textures.exists('town-b');
    const hasGrassB = this.textures.exists('grass-b');
    const hasFlowers = this.textures.exists('grass-flowers');

    const isGrass = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const t = terrain[y][x];
      return t === TILES.GRASS || t === TILES.GRASS_DARK ||
        (t >= TILES.CITY_GRASS_1 && t <= TILES.CITY_GRASS_6);
    };
    const isRoad = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      return terrain[y][x] === TILES.ROAD;
    };

    // Build a lookup grid for grass tiles adjacent to roads
    const roadAdjGrass: boolean[][] = Array.from({ length: H }, () => Array(W).fill(false));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!isGrass(x, y)) continue;
        if (isRoad(x - 1, y) || isRoad(x + 1, y) || isRoad(x, y - 1) || isRoad(x, y + 1)) {
          roadAdjGrass[y][x] = true;
        }
      }
    }

    // ── Pass 1: Structured town decorations ──

    if (hasTownB) {
      // Lamp posts along main roads (every 3 tiles)
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!isRoad(x, y)) continue;
          if ((x + y) % 3 !== 0) continue;
          if (!isGrass(x - 1, y) && !isGrass(x + 1, y)) continue;
          if (rand() < 0.4) {
            const frame = TOWN_B_DECO.townLamps[Math.floor(rand() * TOWN_B_DECO.townLamps.length)];
            const lamp = this.add.image(x * TILE_SIZE + 8, y * TILE_SIZE + 8, 'town-b', frame);
            lamp.setOrigin(0.5, 0.5);
            lamp.setDepth(5 + y / H);
          }
        }
      }

      // Potted trees along road-adjacent grass
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!roadAdjGrass[y][x]) continue;
          if (rand() < 0.10) {
            const frame = TOWN_B_DECO.townTrees[Math.floor(rand() * TOWN_B_DECO.townTrees.length)];
            const tree = this.add.image(x * TILE_SIZE + 8, y * TILE_SIZE + 8, 'town-b', frame);
            tree.setOrigin(0.5, 0.5);
            tree.setDepth(5 + y / H);
          }
        }
      }

      // Benches near center of city
      const centerX = Math.floor(W / 2);
      const centerY = Math.floor(H / 2);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!isRoad(x, y)) continue;
          const distToCenter = Math.abs(x - centerX) + Math.abs(y - centerY);
          if (distToCenter > 6) continue;
          if (rand() < 0.04) {
            const frame = TOWN_B_DECO.townBenches[Math.floor(rand() * TOWN_B_DECO.townBenches.length)];
            const bench = this.add.image(x * TILE_SIZE + 8, y * TILE_SIZE + 8, 'town-b', frame);
            bench.setOrigin(0.5, 0.5);
            bench.setDepth(5 + y / H);
          }
        }
      }

      // Flower pots near buildings (1-3 per building)
      if (buildings && buildings.length > 0) {
        for (const b of buildings) {
          const potCount = 1 + Math.floor(rand() * 3);
          for (let p = 0; p < potCount; p++) {
            const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
            const [dx, dy] = dirs[Math.floor(rand() * dirs.length)];
            const fx = b.x + Math.floor(rand() * b.width) + dx;
            const fy = b.y + Math.floor(rand() * b.height) + dy;
            if (isGrass(fx, fy)) {
              const frame = TOWN_B_DECO.townFlowers[Math.floor(rand() * TOWN_B_DECO.townFlowers.length)];
              const pot = this.add.image(fx * TILE_SIZE + 8, fy * TILE_SIZE + 8, 'town-b', frame);
              pot.setOrigin(0.5, 0.5);
              pot.setDepth(5 + fy / H);
            }
          }
        }

        // Signs in front of smaller buildings
        for (const b of buildings) {
          if (b.rank !== 'guild' && b.rank !== 'cottage' && b.rank !== 'hovel') continue;
          if (rand() < 0.6) {
            const sx = b.x + Math.floor(b.width / 2);
            const sy = b.y + b.height;
            if (sx >= 0 && sx < W && sy >= 0 && sy < H) {
              const frame = TOWN_B_DECO.townSigns[Math.floor(rand() * TOWN_B_DECO.townSigns.length)];
              const sign = this.add.image(sx * TILE_SIZE + 8, sy * TILE_SIZE + 8, 'town-b', frame);
              sign.setOrigin(0.5, 0.5);
              sign.setDepth(5 + sy / H);
            }
          }
        }
      }
    }

    // ── Pass 2: Natural scatter decorations ──

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = terrain[y][x];
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;

        if (t === TILES.FOREST) {
          const r = rand();
          if (r < 0.25) {
            const treeDef = TREE_DEFS[Math.floor(rand() * TREE_DEFS.length)];
            const key = `tree-${treeDef.name}`;
            if (this.textures.exists(key)) {
              const tree = this.add.image(px + 8, py + 8, key);
              tree.setDepth(3 + y / H);
            }
          } else if (r < 0.35 && hasGrassB) {
            const frame = GRASS_B_FRAMES.bushes[Math.floor(rand() * GRASS_B_FRAMES.bushes.length)];
            const bush = this.add.image(px + 8, py + 8, 'grass-b', frame);
            bush.setDepth(3 + y / H);
          } else if (r < 0.42 && hasFlowers) {
            const frame = GRASS_FLOWER_FRAMES.allSmall[Math.floor(rand() * GRASS_FLOWER_FRAMES.allSmall.length)];
            const flower = this.add.image(px + 8, py + 12, 'grass-flowers', frame);
            flower.setOrigin(0.5, 0.5);
            flower.setDepth(3 + y / H);
          }
        } else if (t === TILES.GRASS_DARK) {
          const r = rand();
          if (r < 0.06) {
            const treeDef = TREE_DEFS[Math.floor(rand() * TREE_DEFS.length)];
            const key = `tree-${treeDef.name}`;
            if (this.textures.exists(key)) {
              const tree = this.add.image(px + 8, py + 8, key);
              tree.setDepth(3 + y / H);
            }
          } else if (r < 0.10 && hasGrassB) {
            const frame = GRASS_B_FRAMES.bushes[Math.floor(rand() * GRASS_B_FRAMES.bushes.length)];
            const bush = this.add.image(px + 8, py + 8, 'grass-b', frame);
            bush.setDepth(3 + y / H);
          } else if (r < 0.14 && hasFlowers) {
            const frame = GRASS_FLOWER_FRAMES.allSmall[Math.floor(rand() * GRASS_FLOWER_FRAMES.allSmall.length)];
            const flower = this.add.image(px + 8, py + 12, 'grass-flowers', frame);
            flower.setOrigin(0.5, 0.5);
            flower.setDepth(3 + y / H);
          }
        } else if (isGrass(x, y)) {
          const r = rand();
          if (r < 0.04 && hasFlowers) {
            const frame = GRASS_FLOWER_FRAMES.allSmall[Math.floor(rand() * GRASS_FLOWER_FRAMES.allSmall.length)];
            const flower = this.add.image(px + 8, py + 12, 'grass-flowers', frame);
            flower.setOrigin(0.5, 0.5);
            flower.setDepth(3 + y / H);
          } else if (r < 0.06 && hasGrassB) {
            const frame = GRASS_B_FRAMES.stonesSmall[Math.floor(rand() * GRASS_B_FRAMES.stonesSmall.length)];
            const stone = this.add.image(px + 8, py + 8, 'grass-b', frame);
            stone.setDepth(3 + y / H);
          }
        }
      }
    }
  }

  // ── Citizen animation & spawning ─────────────────────────────

  private createAnimations() {
    for (const def of CITIZEN_SPRITE_DEFS) {
      if (!this.textures.exists(def.key)) continue;
      const prefix = def.key;
      if (this.anims.exists(`${prefix}-idle`)) continue;
      this.anims.create({
        key: `${prefix}-idle`,
        frames: this.anims.generateFrameNumbers(def.key, { frames: [0, 1, 2] }),
        frameRate: 3, repeat: -1,
      });
      this.anims.create({
        key: `${prefix}-walk-down`,
        frames: this.anims.generateFrameNumbers(def.key, { frames: [6, 7, 8, 9] }),
        frameRate: 6, repeat: -1,
      });
      this.anims.create({
        key: `${prefix}-walk-right`,
        frames: this.anims.generateFrameNumbers(def.key, { frames: [12, 13, 14, 15] }),
        frameRate: 6, repeat: -1,
      });
      this.anims.create({
        key: `${prefix}-walk-up`,
        frames: this.anims.generateFrameNumbers(def.key, { frames: [18, 19, 20] }),
        frameRate: 6, repeat: -1,
      });
    }
  }

  private spawnCitizens() {
    const roads: [number, number][] = [];
    for (let y = 0; y < this.cityH; y++) {
      for (let x = 0; x < this.cityW; x++) {
        if (this.terrain[y][x] === TILES.ROAD) roads.push([x, y]);
      }
    }
    if (roads.length === 0) return;

    const rand = seededRandom(999);
    const spriteKeys = CITIZEN_SPRITE_DEFS.filter(d => this.textures.exists(d.key));
    const count = Math.min(12, roads.length);

    for (let i = 0; i < count; i++) {
      const [tx, ty] = roads[Math.floor(rand() * roads.length)];
      const def = spriteKeys[i % spriteKeys.length];
      if (!def) continue;

      const sprite = this.add.sprite(
        tx * TILE_SIZE + TILE_SIZE / 2,
        ty * TILE_SIZE + TILE_SIZE / 2,
        def.key
      );
      sprite.setDepth(8 + ty / this.cityH);
      sprite.play(`${def.key}-idle`);

      this.citizens.push({
        sprite,
        key: def.key,
        currentTile: [tx, ty],
        targetTile: null,
        speed: 18 + rand() * 14,
        waitTimer: rand() * 2000,
      });
    }
  }

  private updateCitizens(delta: number) {
    const rand = seededRandom(Date.now() & 0xffff);
    for (const c of this.citizens) {
      if (c.waitTimer > 0) {
        c.waitTimer -= delta;
        continue;
      }

      if (!c.targetTile) {
        const [cx, cy] = c.currentTile;
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        const valid: [number, number][] = [];
        for (const [dx, dy] of dirs) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && ny >= 0 && nx < this.cityW && ny < this.cityH &&
            this.terrain[ny][nx] === TILES.ROAD) {
            valid.push([nx, ny]);
          }
        }
        if (valid.length === 0) { c.waitTimer = 1000; continue; }
        c.targetTile = valid[Math.floor(rand() * valid.length)];

        const [tx, ty] = c.targetTile;
        if (tx < cx) { c.sprite.play(`${c.key}-walk-right`, true); c.sprite.setFlipX(true); }
        else if (tx > cx) { c.sprite.play(`${c.key}-walk-right`, true); c.sprite.setFlipX(false); }
        else if (ty < cy) { c.sprite.play(`${c.key}-walk-up`, true); }
        else { c.sprite.play(`${c.key}-walk-down`, true); }
      }

      const [tx, ty] = c.targetTile;
      const goalX = tx * TILE_SIZE + TILE_SIZE / 2;
      const goalY = ty * TILE_SIZE + TILE_SIZE / 2;
      const dx = goalX - c.sprite.x;
      const dy = goalY - c.sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const step = c.speed * (delta / 1000);

      if (dist <= step) {
        c.sprite.x = goalX;
        c.sprite.y = goalY;
        c.currentTile = [tx, ty];
        c.targetTile = null;
        c.sprite.setDepth(8 + ty / this.cityH);
        if (rand() < 0.3) {
          c.waitTimer = 500 + rand() * 2500;
          c.sprite.play(`${c.key}-idle`, true);
        }
      } else {
        c.sprite.x += (dx / dist) * step;
        c.sprite.y += (dy / dist) * step;
      }
    }
  }
}
