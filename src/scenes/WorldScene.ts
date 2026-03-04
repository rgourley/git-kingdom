import Phaser from 'phaser';
import { LanguageKingdom, TILES } from '../types';
import { generateTileset, TILE_SIZE, TILESET_MARGIN, TILESET_SPACING, SpritePacks, GRASS_B_COLS, GRASS_B_FRAMES, GRASS_FLOWERS_COLS, GRASS_FLOWER_FRAMES, TREE_DEFS, GRASS_TREES_COLS, DESERT_B_COLS, DESERT_B_DECO, CAVE_B_COLS, CAVE_B_DECO, createBuildingTextures, getBuildingTextureKey } from '../generators/TilesetGenerator';
import { generateWorld, WorldData, WorldKingdom, WorldSettlement } from '../generators/WorldGenerator';
import { trackCityEntered, trackWorldSearch, trackPageView } from '../analytics';

// Stepped zoom levels for crisp pixel-art rendering (retro style)
const WORLD_ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

// Track zoom by index to avoid float comparison issues
let worldZoomIndex = 3; // start at 1x
let worldZoomCooldown = 0; // ms timestamp of last zoom change

function stepZoom(direction: number): number {
  const now = Date.now();
  // 200ms cooldown prevents trackpad momentum from skipping levels
  if (now - worldZoomCooldown < 200) return WORLD_ZOOM_LEVELS[worldZoomIndex];
  worldZoomCooldown = now;

  if (direction > 0) {
    // Zoom out
    worldZoomIndex = Math.max(0, worldZoomIndex - 1);
  } else {
    // Zoom in
    worldZoomIndex = Math.min(WORLD_ZOOM_LEVELS.length - 1, worldZoomIndex + 1);
  }
  return WORLD_ZOOM_LEVELS[worldZoomIndex];
}

function nearestZoomIndex(target: number): number {
  let bestIdx = 0;
  let bestDist = Math.abs(target - WORLD_ZOOM_LEVELS[0]);
  for (let i = 1; i < WORLD_ZOOM_LEVELS.length; i++) {
    const d = Math.abs(target - WORLD_ZOOM_LEVELS[i]);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx;
}

// Kingdom border colors — muted earth tones that look game-like
const KINGDOM_COLORS = [
  0xaa2222, 0x2255aa, 0x228844, 0xaa7722, 0x772299,
  0xaa5522, 0x227788, 0x882255, 0x558822, 0x552288,
  0xcc4444, 0x4477cc, 0x44aa66, 0xccaa44, 0x9955aa,
  0xcc7744, 0x449999, 0xaa4477, 0x77aa44, 0x7744aa,
];

// Simple seeded PRNG for decoration placement (must be deterministic)
function seededRandom(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WorldScene extends Phaser.Scene {
  private world!: WorldData;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  // Scale-aware labels: stored so update() can adjust their scale with zoom
  private kingdomLabels: Phaser.GameObjects.Text[] = [];
  private lastZoom = -1;
  // Glow rings for highlighted (user's) settlements
  private glowRings: Phaser.GameObjects.Arc[] = [];
  private glowTime = 0;
  // Highlighted username (for "find my repos" feature)
  private highlightUser: string | null = null;
  // All kingdoms data for stat bar scaling
  private allKingdoms: WorldKingdom[] = [];
  // Track DOM event listeners for cleanup on scene switch
  private domListeners: { el: HTMLElement; event: string; handler: EventListener }[] = [];

  constructor() {
    super({ key: 'WorldScene' });
  }

  /** Track a DOM event listener for automatic cleanup on scene shutdown */
  private trackListener(el: HTMLElement | null, event: string, handler: EventListener) {
    if (!el) return;
    el.addEventListener(event, handler);
    this.domListeners.push({ el, event, handler });
  }

  init(_data: { kingdoms: LanguageKingdom[] }) {
    // Data is passed but we store it via generateWorld
    // Clean up any lingering DOM listeners from previous lifecycle
    this.cleanupListeners();
    this.events.once('shutdown', () => this.cleanupListeners());
  }

  private cleanupListeners() {
    for (const { el, event, handler } of this.domListeners) {
      el.removeEventListener(event, handler);
    }
    this.domListeners = [];
  }

  preload() {
    // Sprite pack images are pre-loaded in main.ts and passed via scene data
    // Load UI banner texture for city name labels
    if (!this.textures.exists('ui-banner-dark')) {
      this.load.image('ui-banner-dark', '/assets/ui/window_dark.png');
    }
    if (!this.textures.exists('ui-banner-grey')) {
      this.load.image('ui-banner-grey', '/assets/ui/window_grey.png');
    }
  }

  create() {
   try {
    // Get the language kingdoms and sprite packs from scene data
    const data = this.scene.settings.data as {
      kingdoms: LanguageKingdom[];
      spritePacks?: SpritePacks;
      highlightUser?: string;
    };
    const languageKingdoms = data.kingdoms;
    const spritePacks = data.spritePacks;
    this.highlightUser = data.highlightUser?.toLowerCase() || null;

    // Reset arrays (scene may be restarted after returning from CityScene)
    this.kingdomLabels = [];
    this.glowRings = [];
    this.lastZoom = -1;

    // ── Generate tileset from 7Soul sprite packs ──
    if (!this.textures.exists('tileset')) {
      const tilesetCanvas = generateTileset(spritePacks);
      this.textures.addCanvas('tileset', tilesetCanvas);
    }

    // ── Register decoration spritesheets ──
    let hasDecoSprites = false;
    if (spritePacks?.grassBImg && spritePacks.grassBImg.width > 0) {
      if (!this.textures.exists('grass-b')) {
        try {
          this.textures.addSpriteSheet('grass-b', spritePacks.grassBImg, {
            frameWidth: 16, frameHeight: 16, spacing: 0, margin: 0,
          });
        } catch (e) { console.error('[WorldScene] Failed to register grass-b:', e); }
      }
      hasDecoSprites = true;
    }
    if (spritePacks?.grassFlowersImg && spritePacks.grassFlowersImg.width > 0) {
      if (!this.textures.exists('grass-flowers')) {
        try {
          this.textures.addSpriteSheet('grass-flowers', spritePacks.grassFlowersImg, {
            frameWidth: 16, frameHeight: 16, spacing: 0, margin: 0,
          });
        } catch (e) { console.error('[WorldScene] Failed to register grass-flowers:', e); }
      }
    }
    // Create 2x2 tree textures from Trees.png
    if (spritePacks?.grassTreesImg && spritePacks.grassTreesImg.width > 0) {
      for (const def of TREE_DEFS) {
        const key = `tree-${def.name}`;
        if (!this.textures.exists(key)) {
          const tc = document.createElement('canvas');
          tc.width = 32; tc.height = 32;
          const tctx = tc.getContext('2d')!;
          tctx.imageSmoothingEnabled = false;
          const img = spritePacks.grassTreesImg;
          // Top row of tree
          tctx.drawImage(img, def.col * 16, 0, 16, 16, 0, 0, 16, 16);
          tctx.drawImage(img, (def.col + 1) * 16, 0, 16, 16, 16, 0, 16, 16);
          // Bottom row of tree
          tctx.drawImage(img, def.col * 16, 16, 16, 16, 0, 16, 16, 16);
          tctx.drawImage(img, (def.col + 1) * 16, 16, 16, 16, 16, 16, 16, 16);
          this.textures.addCanvas(key, tc);
        }
      }
    }
    // Desert decorations
    if (spritePacks?.desertBImg && spritePacks.desertBImg.width > 0) {
      if (!this.textures.exists('desert-b')) {
        try {
          this.textures.addSpriteSheet('desert-b', spritePacks.desertBImg, {
            frameWidth: 16, frameHeight: 16, spacing: 0, margin: 0,
          });
        } catch (e) { console.error('[WorldScene] Failed to register desert-b:', e); }
      }
    }
    // Cave decorations
    if (spritePacks?.caveBImg && spritePacks.caveBImg.width > 0) {
      if (!this.textures.exists('cave-b')) {
        try {
          this.textures.addSpriteSheet('cave-b', spritePacks.caveBImg, {
            frameWidth: 16, frameHeight: 16, spacing: 0, margin: 0,
          });
        } catch (e) { console.error('[WorldScene] Failed to register cave-b:', e); }
      }
    }

    // ── Generate world ──
    this.world = generateWorld(languageKingdoms);
    const { width: W, height: H, terrain, ownership, kingdoms, settlements } = this.world;
    this.allKingdoms = kingdoms;

    // ── Replace building tiles with ROAD for clean tilemap ──
    // Building sprites will be overlaid separately for a proper town look
    const BUILDING_TILES = new Set<number>([
      TILES.HOUSE, TILES.HOUSE_LARGE, TILES.CASTLE_WALL, TILES.CASTLE_TOWER,
      TILES.CASTLE_GATE, TILES.CASTLE_ROOF, TILES.BANNER, TILES.MARKET,
      TILES.CHURCH, TILES.MONSTER_DEN, TILES.QUEST_BOARD, TILES.MONUMENT,
      TILES.RUINS,
    ]);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (BUILDING_TILES.has(terrain[y][x])) {
          terrain[y][x] = TILES.ROAD;
        }
      }
    }

    // ── Tilemap (base terrain layer) ──
    const map = this.make.tilemap({
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      width: W,
      height: H,
    });
    const ts = map.addTilesetImage('tileset', 'tileset', TILE_SIZE, TILE_SIZE, TILESET_MARGIN, TILESET_SPACING)!;
    const layer = map.createBlankLayer('terrain', ts, 0, 0, W, H)!;
    layer.putTilesAt(terrain, 0, 0);

    // ── Register building textures + place building sprites at settlements ──
    if (spritePacks?.townBImg && spritePacks.townBImg.width > 0) {
      const buildingTextures = createBuildingTextures(spritePacks.townBImg);
      for (const [key, canvas] of buildingTextures) {
        if (!this.textures.exists(key)) {
          this.textures.addCanvas(key, canvas);
        }
      }
      this.placeSettlementSprites(settlements, kingdoms);
    }

    // ── Decoration layer: trees, bushes, flowers ──
    if (hasDecoSprites) {
      this.placeDecorations(terrain, ownership, W, H, settlements);
    }

    // ── Kingdom border lines (thick + colored, rendered ABOVE trees) ──
    const borderGfx = this.add.graphics();
    borderGfx.setDepth(8); // above decorations (depth 3) and tilemap

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = ownership[y][x];
        if (k < 0) continue;
        const color = KINGDOM_COLORS[k % KINGDOM_COLORS.length];

        const kr = x + 1 < W ? ownership[y][x + 1] : -1;
        const kb = y + 1 < H ? ownership[y + 1][x] : -1;

        if (kr >= 0 && kr !== k) {
          const bx = (x + 1) * TILE_SIZE;
          const y0 = y * TILE_SIZE, y1 = (y + 1) * TILE_SIZE;
          borderGfx.lineStyle(5, 0x000000, 0.7);
          borderGfx.beginPath();
          borderGfx.moveTo(bx, y0);
          borderGfx.lineTo(bx, y1);
          borderGfx.strokePath();
          borderGfx.lineStyle(2.5, color, 1.0);
          borderGfx.beginPath();
          borderGfx.moveTo(bx, y0);
          borderGfx.lineTo(bx, y1);
          borderGfx.strokePath();
        }
        if (kb >= 0 && kb !== k) {
          const by = (y + 1) * TILE_SIZE;
          const x0 = x * TILE_SIZE, x1 = (x + 1) * TILE_SIZE;
          borderGfx.lineStyle(5, 0x000000, 0.7);
          borderGfx.beginPath();
          borderGfx.moveTo(x0, by);
          borderGfx.lineTo(x1, by);
          borderGfx.strokePath();
          borderGfx.lineStyle(2.5, color, 1.0);
          borderGfx.beginPath();
          borderGfx.moveTo(x0, by);
          borderGfx.lineTo(x1, by);
          borderGfx.strokePath();
        }
      }
    }

    // ── City labels with dark RPG banner for name only ──
    // Stats and king name go underneath the banner with stroke outlines
    // First, compute label positions and nudge apart any that overlap
    const labelPositions: { x: number; y: number }[] = kingdoms.map(k => ({
      x: k.settlements[0].x * TILE_SIZE,
      y: k.settlements[0].y * TILE_SIZE - 16,
    }));
    // Push overlapping labels apart vertically (minimum gap in world pixels)
    const MIN_LABEL_GAP = 52;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < labelPositions.length; i++) {
        for (let j = i + 1; j < labelPositions.length; j++) {
          const a = labelPositions[i], b = labelPositions[j];
          const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
          if (dx < 100 && dy < MIN_LABEL_GAP) {
            const nudge = Math.ceil((MIN_LABEL_GAP - dy) / 2) + 4;
            if (a.y <= b.y) { a.y -= nudge; b.y += nudge; }
            else { b.y -= nudge; a.y += nudge; }
          }
        }
      }
    }

    const hasBannerTex = this.textures.exists('ui-banner-grey') || this.textures.exists('ui-banner-dark');
    for (let ki = 0; ki < kingdoms.length; ki++) {
      const k = kingdoms[ki];
      const labelX = labelPositions[ki].x;
      const labelY = labelPositions[ki].y;

      // Format star count
      const starsStr = k.totalStars >= 1000000
        ? (k.totalStars / 1000000).toFixed(1) + 'M★'
        : k.totalStars >= 1000
        ? Math.round(k.totalStars / 1000) + 'k★'
        : k.totalStars + '★';

      const tierIcon = k.settlements[0].tier === 'capital' ? '👑' : '🏰';

      // ── City name inside dark banner ──
      const nameLabel = this.add.text(0, 0,
        k.language, {
        fontFamily: "'Press Start 2P', monospace",
        fontSize: '9px',
        color: '#ffd700',
        align: 'center',
      });
      nameLabel.setOrigin(0.5, 0.5);

      // Size the banner to fit the name text
      const bannerW = nameLabel.width + 20;
      const bannerH = 22;

      // Create the container for the banner group
      const container = this.add.container(labelX, labelY);
      container.setDepth(12);

      // NineSlice grey banner background for kingdom name labels
      // Clicking the banner enters the city directly
      if (hasBannerTex) {
        const bannerTex = this.textures.exists('ui-banner-grey') ? 'ui-banner-grey' : 'ui-banner-dark';
        const banner = this.add.nineslice(
          0, 0,
          bannerTex, undefined,
          bannerW, bannerH,
          16, 16, 16, 16
        );
        banner.setOrigin(0.5, 0.5);
        banner.setInteractive({ useHandCursor: true });
        const kRef = k; // capture for closure
        banner.on('pointerup', () => {
          this.enterCity(kRef);
        });
        container.add(banner);
      }
      container.add(nameLabel);

      // ── Stats line below banner — with stroke, no banner ──
      const statsLabel = this.add.text(0, 16,
        `${tierIcon} ${starsStr} · ${k.totalCommits.toLocaleString()} commits`, {
        fontFamily: "'Silkscreen', monospace",
        fontSize: '8px',
        color: '#e8d5a3',
        stroke: '#000000',
        strokeThickness: 3,
        align: 'center',
      });
      statsLabel.setOrigin(0.5, 0);
      container.add(statsLabel);

      // ── King name below stats ──
      if (k.king) {
        const kingLabel = this.add.text(0, 28,
          `👑 ${k.king.login}`, {
          fontFamily: "'Silkscreen', monospace",
          fontSize: '7px',
          color: '#c8a853',
          stroke: '#000000',
          strokeThickness: 2,
          align: 'center',
        });
        kingLabel.setOrigin(0.5, 0);
        container.add(kingLabel);
      }

      // Store container — scaling it scales all children
      this.kingdomLabels.push(container as any);
    }

    // ── Camera ──
    this.cameras.main.setBounds(0, 0, W * TILE_SIZE, H * TILE_SIZE);
    this.cameras.main.centerOn((W / 2) * TILE_SIZE, (H / 2) * TILE_SIZE);
    this.cameras.main.setRoundPixels(true);
    const fitZoomX = window.innerWidth / (W * TILE_SIZE);
    const fitZoomY = window.innerHeight / (H * TILE_SIZE);
    const fitZoom = Math.max(0.25, Math.min(fitZoomX, fitZoomY) * 0.9);
    worldZoomIndex = nearestZoomIndex(fitZoom);
    this.cameras.main.setZoom(WORLD_ZOOM_LEVELS[worldZoomIndex]);

    // ── Input ──
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      W: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    this.input.on('wheel', (_p: any, _g: any, _dx: number, deltaY: number) => {
      this.cameras.main.setZoom(stepZoom(deltaY));
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (isDragging) { isDragging = false; return; }
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const tx = Math.floor(wp.x / TILE_SIZE);
      const ty = Math.floor(wp.y / TILE_SIZE);

      // Click anywhere in a kingdom territory → show kingdom info with "Enter City"
      if (tx >= 0 && tx < W && ty >= 0 && ty < H && ownership[ty][tx] >= 0) {
        this.showKingdomInfo(kingdoms[ownership[ty][tx]]);
      } else {
        this.hideInfoPanel();
      }
    });

    let dragStartX = 0, dragStartY = 0;
    let camStartX = 0, camStartY = 0;
    let isDragging = false;

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      dragStartX = p.x; dragStartY = p.y;
      camStartX = this.cameras.main.scrollX;
      camStartY = this.cameras.main.scrollY;
      isDragging = false;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      const dx = p.x - dragStartX, dy = p.y - dragStartY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) isDragging = true;
      if (isDragging) {
        this.cameras.main.scrollX = camStartX - dx / this.cameras.main.zoom;
        this.cameras.main.scrollY = camStartY - dy / this.cameras.main.zoom;
      }
    });

    this.buildLegend(kingdoms, settlements);

    const el = document.getElementById('loading');
    if (el) el.style.display = 'none';

    // Hide back button (in case we came back from CityScene)
    const backBtn = document.getElementById('back-to-world');
    if (backBtn) backBtn.style.display = 'none';

    // ── Populate the RPG header bar for World Map ──
    this.setupWorldHeader(kingdoms);

    // Restore controls hint (now at bottom)
    const hint = document.getElementById('controls-hint');
    if (hint) hint.textContent = 'WASD/Arrows: scroll · Mouse wheel: zoom · Click kingdom: inspect';
   } catch (err) {
    console.error('[WorldScene] create() error:', err);
   }
  }


  // ── Place tree/bush/flower sprites on forest + grass tiles ──
  private placeDecorations(
    terrain: number[][], ownership: number[][],
    W: number, H: number,
    settlements: WorldSettlement[]
  ) {
    const rand = seededRandom(42424);
    const decoContainer = this.add.container(0, 0);
    decoContainer.setDepth(3);

    const buildingZone = new Set<string>();
    for (const s of settlements) {
      const radius = s.tier === 'capital' ? 5 : s.tier === 'city' ? 4 : s.tier === 'town' ? 3 : 2;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          buildingZone.add(`${s.x + dx},${s.y + dy}`);
        }
      }
    }

    const hasGrassB = this.textures.exists('grass-b');
    const hasFlowers = this.textures.exists('grass-flowers');
    const hasTrees = TREE_DEFS.some(d => this.textures.exists(`tree-${d.name}`));
    const hasDesertB = this.textures.exists('desert-b');
    const hasCaveB = this.textures.exists('cave-b');

    const greenTreeKeys = TREE_DEFS.filter(d => !d.name.startsWith('dead') && d.name !== 'palm')
      .map(d => `tree-${d.name}`).filter(k => this.textures.exists(k));
    const deadTreeKeys = TREE_DEFS.filter(d => d.name.startsWith('dead'))
      .map(d => `tree-${d.name}`).filter(k => this.textures.exists(k));
    const palmKey = this.textures.exists('tree-palm') ? 'tree-palm' : null;

    const allFlowers = GRASS_FLOWER_FRAMES.allSmall;
    const bushFrames = GRASS_B_FRAMES.bushes;
    const rockFrames = GRASS_B_FRAMES.boulders;
    const smallRocks = GRASS_B_FRAMES.stonesSmall;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const tile = terrain[y][x];
        if (buildingZone.has(`${x},${y}`)) continue;
        if (ownership[y][x] < 0) continue;

        const r = rand();
        const px = x * TILE_SIZE + rand() * 4 - 2;
        const py = y * TILE_SIZE + rand() * 4 - 2;

        if (tile === TILES.FOREST) {
          if (r < 0.40 && hasTrees && greenTreeKeys.length > 0) {
            const key = greenTreeKeys[Math.floor(rand() * greenTreeKeys.length)];
            const sprite = this.add.sprite(px + 8, py + 8, key);
            sprite.setOrigin(0.5, 0.5);
            sprite.setDepth(3 + (y / H) * 2);
            decoContainer.add(sprite);
          } else if (r < 0.50 && hasGrassB) {
            const frame = bushFrames[Math.floor(rand() * bushFrames.length)];
            const sprite = this.add.sprite(px + 8, py + 8, 'grass-b', frame);
            sprite.setOrigin(0.5, 0.5);
            decoContainer.add(sprite);
          } else if (r < 0.55 && hasFlowers) {
            const frame = allFlowers[Math.floor(rand() * allFlowers.length)];
            const sprite = this.add.sprite(px + 8, py + 12, 'grass-flowers', frame);
            sprite.setOrigin(0.5, 0.5);
            sprite.setScale(0.8);
            decoContainer.add(sprite);
          }
        } else if (tile === TILES.GRASS_DARK) {
          if (r < 0.08 && hasTrees && greenTreeKeys.length > 0) {
            const key = greenTreeKeys[Math.floor(rand() * greenTreeKeys.length)];
            const sprite = this.add.sprite(px + 8, py + 8, key);
            sprite.setOrigin(0.5, 0.5);
            sprite.setDepth(3 + (y / H) * 2);
            decoContainer.add(sprite);
          } else if (r < 0.12 && hasGrassB) {
            const frame = bushFrames[Math.floor(rand() * bushFrames.length)];
            const sprite = this.add.sprite(px + 8, py + 8, 'grass-b', frame);
            sprite.setOrigin(0.5, 0.5);
            sprite.setScale(0.8);
            decoContainer.add(sprite);
          } else if (r < 0.15 && hasFlowers) {
            const frame = allFlowers[Math.floor(rand() * allFlowers.length)];
            const sprite = this.add.sprite(px + 8, py + 12, 'grass-flowers', frame);
            sprite.setOrigin(0.5, 0.5);
            sprite.setScale(0.7);
            decoContainer.add(sprite);
          }
        } else if (tile === TILES.GRASS) {
          if (r < 0.03 && hasFlowers) {
            const frame = allFlowers[Math.floor(rand() * allFlowers.length)];
            const sprite = this.add.sprite(px + 8, py + 12, 'grass-flowers', frame);
            sprite.setOrigin(0.5, 0.5);
            sprite.setScale(0.7);
            decoContainer.add(sprite);
          } else if (r < 0.05 && hasGrassB) {
            const frame = smallRocks[Math.floor(rand() * smallRocks.length)];
            const sprite = this.add.sprite(px + 8, py + 8, 'grass-b', frame);
            sprite.setOrigin(0.5, 0.5);
            sprite.setScale(0.6);
            decoContainer.add(sprite);
          }
        } else if (tile === TILES.MOUNTAIN) {
          if (r < 0.10 && hasGrassB) {
            const frame = rockFrames[Math.floor(rand() * rockFrames.length)];
            const sprite = this.add.sprite(px + 8, py + 8, 'grass-b', frame);
            sprite.setOrigin(0.5, 0.5);
            decoContainer.add(sprite);
          } else if (r < 0.14 && hasCaveB) {
            const frame = CAVE_B_DECO.crystals[Math.floor(rand() * CAVE_B_DECO.crystals.length)];
            const sprite = this.add.sprite(px + 8, py + 8, 'cave-b', frame);
            sprite.setOrigin(0.5, 0.5);
            decoContainer.add(sprite);
          }
        } else if (tile === TILES.SAND) {
          if (r < 0.015 && palmKey) {
            const sprite = this.add.sprite(px + 8, py + 8, palmKey);
            sprite.setOrigin(0.5, 0.5);
            sprite.setDepth(3 + (y / H) * 2);
            decoContainer.add(sprite);
          } else if (r < 0.03 && hasDesertB) {
            const frames = [...DESERT_B_DECO.cacti, ...DESERT_B_DECO.rocks];
            const frame = frames[Math.floor(rand() * frames.length)];
            const sprite = this.add.sprite(px + 8, py + 8, 'desert-b', frame);
            sprite.setOrigin(0.5, 0.5);
            sprite.setScale(0.8);
            decoContainer.add(sprite);
          }
        } else if (tile === TILES.SNOW) {
          if (r < 0.03 && hasTrees && deadTreeKeys.length > 0) {
            const key = deadTreeKeys[Math.floor(rand() * deadTreeKeys.length)];
            const sprite = this.add.sprite(px + 8, py + 8, key);
            sprite.setOrigin(0.5, 0.5);
            sprite.setDepth(3 + (y / H) * 2);
            decoContainer.add(sprite);
          } else if (r < 0.05 && hasGrassB) {
            const frame = smallRocks[Math.floor(rand() * smallRocks.length)];
            const sprite = this.add.sprite(px + 8, py + 8, 'grass-b', frame);
            sprite.setOrigin(0.5, 0.5);
            sprite.setScale(0.7);
            decoContainer.add(sprite);
          }
        } else if (tile === TILES.LAVA || tile === TILES.CRYSTAL) {
          if (r < 0.08 && hasCaveB) {
            const frame = CAVE_B_DECO.crystals[Math.floor(rand() * CAVE_B_DECO.crystals.length)];
            const sprite = this.add.sprite(px + 8, py + 8, 'cave-b', frame);
            sprite.setOrigin(0.5, 0.5);
            decoContainer.add(sprite);
          }
        }
      }
    }

    console.log(`Placed ${decoContainer.length} decoration sprites`);
  }

  // ── Place composed building sprites at world settlements ──
  private placeSettlementSprites(
    settlements: WorldSettlement[],
    kingdoms: WorldKingdom[]
  ) {
    for (const s of settlements) {
      // Map settlement tier to building rank for texture selection
      const rankMap: Record<string, string> = {
        capital: 'castle',
        city: 'keep',
        town: 'keep',
        village: 'guild',
        hamlet: 'cottage',
        camp: 'hovel',
      };
      const rank = rankMap[s.tier] || 'cottage';
      const seed = s.x * 7 + s.y * 3 + s.kingdomIndex;
      const texKey = getBuildingTextureKey(rank, seed);

      if (!this.textures.exists(texKey)) continue;

      const px = s.x * TILE_SIZE + TILE_SIZE / 2;
      const py = s.y * TILE_SIZE + TILE_SIZE;

      // Main building sprite
      const sprite = this.add.image(px, py, texKey);
      sprite.setOrigin(0.5, 1);
      sprite.setDepth(5 + s.y / 1000); // Y-sorted depth, above decorations

      // For capitals & cities, add flanking houses
      if (s.tier === 'capital' || s.tier === 'city') {
        const houseSeed = seed + 100;
        const houseKey = getBuildingTextureKey('cottage', houseSeed);
        if (this.textures.exists(houseKey)) {
          // Left house
          const leftHouse = this.add.image(px - TILE_SIZE * 3, py + TILE_SIZE * 0.5, houseKey);
          leftHouse.setOrigin(0.5, 1);
          leftHouse.setDepth(5 + (s.y + 0.5) / 1000);

          // Right house
          const rightHouse = this.add.image(px + TILE_SIZE * 3, py + TILE_SIZE * 0.5, houseKey);
          rightHouse.setOrigin(0.5, 1);
          rightHouse.setDepth(5 + (s.y + 0.5) / 1000);
        }

        // Additional houses for capitals
        if (s.tier === 'capital') {
          const hovelKey = getBuildingTextureKey('hovel', houseSeed + 50);
          const guildKey = getBuildingTextureKey('guild', houseSeed + 25);
          if (this.textures.exists(hovelKey)) {
            const farLeft = this.add.image(px - TILE_SIZE * 2, py + TILE_SIZE * 2, hovelKey);
            farLeft.setOrigin(0.5, 1);
            farLeft.setDepth(5 + (s.y + 2) / 1000);

            const farRight = this.add.image(px + TILE_SIZE * 2, py + TILE_SIZE * 2, hovelKey);
            farRight.setOrigin(0.5, 1);
            farRight.setDepth(5 + (s.y + 2) / 1000);
          }
          if (this.textures.exists(guildKey)) {
            const backLeft = this.add.image(px - TILE_SIZE * 2.5, py - TILE_SIZE * 1.5, guildKey);
            backLeft.setOrigin(0.5, 1);
            backLeft.setDepth(5 + (s.y - 1.5) / 1000);

            const backRight = this.add.image(px + TILE_SIZE * 2.5, py - TILE_SIZE * 1.5, guildKey);
            backRight.setOrigin(0.5, 1);
            backRight.setDepth(5 + (s.y - 1.5) / 1000);
          }
        }
      }
    }
  }

  update(_time: number, delta: number) {
    const cam = this.cameras.main;
    const speed = 4 / cam.zoom;
    if (this.cursors.left.isDown || this.wasd.A.isDown) cam.scrollX -= speed;
    if (this.cursors.right.isDown || this.wasd.D.isDown) cam.scrollX += speed;
    if (this.cursors.up.isDown || this.wasd.W.isDown) cam.scrollY -= speed;
    if (this.cursors.down.isDown || this.wasd.S.isDown) cam.scrollY += speed;

    // ── Animate gold glow rings (pulse) ──
    this.glowTime += delta;
    const pulse = 0.5 + 0.5 * Math.sin(this.glowTime * 0.003);
    for (const ring of this.glowRings) {
      ring.setStrokeStyle(2 + pulse, 0xffd700, 0.4 + pulse * 0.5);
      ring.setScale(0.9 + pulse * 0.3);
    }

    // ── Scale-aware labels: clamp so they stay readable at all zoom levels ──
    const zoom = cam.zoom;
    if (Math.abs(zoom - this.lastZoom) > 0.01) {
      this.lastZoom = zoom;
      // Scale inversely with zoom so labels stay approximately constant screen size
      // Clamp to prevent them from being too tiny (at max zoom-in) or too huge (at max zoom-out)
      const effectiveScale = Phaser.Math.Clamp(1 / zoom, 0.3, 4.0);

      for (const label of this.kingdomLabels) {
        label.setScale(effectiveScale);
      }
    }
  }

  // Show info for a kingdom (language city) — with "Enter City" button
  private showKingdomInfo(k: WorldKingdom) {
    const panel = document.getElementById('info-panel')!;
    const shared = (window as any).__gitworld;
    const lk = shared?.kingdoms?.find((lk: any) => lk.language === k.language);

    // Show king's avatar if available
    const avatarEl = document.getElementById('info-avatar') as HTMLImageElement;
    if (k.king?.avatar_url) {
      avatarEl.src = k.king.avatar_url + (k.king.avatar_url.includes('?') ? '&' : '?') + 's=128';
      avatarEl.alt = k.king.login;
      avatarEl.style.display = 'block';
      avatarEl.onerror = () => { avatarEl.style.display = 'none'; };
    } else {
      avatarEl.style.display = 'none';
      avatarEl.src = '';
    }

    // Get top repos from the full LanguageKingdom data
    const topRepoData = lk
      ? [...lk.repos]
          .sort((a: any, b: any) => b.repo.stargazers_count - a.repo.stargazers_count)
          .slice(0, 5)
      : [];
    const topRepoLinks = topRepoData.map((r: any) =>
      ghLink(r.repo.full_name, r.repo.name)
    ).join(', ');
    const repoCount = lk ? lk.repos.length : 1;

    const tierLabel = k.settlements[0]?.tier || 'city';
    document.getElementById('info-name')!.textContent = `City of ${k.language}`;
    document.getElementById('info-tier')!.textContent =
      `${tierLabel} · ${k.biome} realm · ${repoCount} repos`;
    // Find max values for bar scaling
    const maxStars = Math.max(...this.allKingdoms.map(kk => kk.totalStars), 1);
    const maxCommits = Math.max(...this.allKingdoms.map(kk => kk.totalCommits), 1);

    document.getElementById('info-stats')!.innerHTML = [
      '<hr class="golden">',
      statBar('Stars', k.totalStars, maxStars, 'orange'),
      statBar('Commits', k.totalCommits, maxCommits, 'green'),
      stat('Repos', repoCount.toString()),
      `<div class="stat"><span class="stat-label">Top Repos</span><span class="stat-value">${topRepoLinks}</span></div>`,
      `<button id="enter-city-btn" class="rpgui-button golden" style="width:100%;margin-top:8px">
        <p>🏰 Enter the City of ${esc(k.language)}</p>
      </button>`,
    ].join('');

    // RPGUI buttons are styled via CSS class alone — no RPGUI.create needed

    const kingEl = document.getElementById('info-king')!;
    kingEl.innerHTML = k.king
      ? `👑 Ruler: ${ghLink(k.king.login)} (${k.king.contributions.toLocaleString()} commits)`
      : 'No ruler';

    if ((window as any).__resetPanelPos) (window as any).__resetPanelPos(panel);
    panel.style.display = 'block';

    // Wire up "Enter City" button
    const enterBtn = document.getElementById('enter-city-btn');
    if (enterBtn) {
      enterBtn.onclick = () => this.enterCity(k);
    }
  }

  // Transition to the CityScene for a given kingdom
  private enterCity(k: WorldKingdom) {
    const shared = (window as any).__gitworld;
    if (!shared) return;

    // Find the matching LanguageKingdom
    const kingdom = shared.kingdoms.find(
      (lk: any) => lk.language === k.language
    );
    if (!kingdom) return;

    // Hide world UI
    this.hideInfoPanel();
    document.getElementById('legend')!.style.display = 'none';

    // Analytics
    trackCityEntered({
      language: kingdom.language,
      repo_count: kingdom.repos.length,
      total_stars: kingdom.totalStars,
    });
    trackPageView(`/city/${kingdom.language.toLowerCase()}`, `Git Kingdom | ${kingdom.language}`);

    // Transition to CityScene
    this.scene.start('CityScene', {
      kingdom,
      spritePacks: shared.spritePacks,
      highlightUser: shared.highlightUser,
      returnData: {
        kingdoms: shared.kingdoms,
        spritePacks: shared.spritePacks,
        highlightUser: shared.highlightUser,
      },
    });
  }

  private hideInfoPanel() {
    document.getElementById('info-panel')!.style.display = 'none';
    const avatarEl = document.getElementById('info-avatar') as HTMLImageElement;
    if (avatarEl) { avatarEl.style.display = 'none'; avatarEl.src = ''; }
  }

  private setupWorldHeader(kingdoms: WorldKingdom[]) {
    const header = document.getElementById('game-header');
    if (!header) return;

    // Calculate aggregate stats
    const totalKingdoms = kingdoms.length;
    const totalStars = kingdoms.reduce((s, k) => s + k.totalStars, 0);
    const totalCommits = kingdoms.reduce((s, k) => s + k.totalCommits, 0);

    // Count unique citizens across all kingdoms
    const shared = (window as any).__gitworld;
    let totalCitizens = 0;
    if (shared?.kingdoms) {
      const allContribs = new Set<string>();
      for (const lk of shared.kingdoms) {
        for (const r of lk.repos) {
          for (const c of r.contributors) {
            allContribs.add(c.login);
          }
        }
      }
      totalCitizens = allContribs.size;
    }

    // Format numbers
    const fmt = (n: number) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M'
      : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);

    // Remove any city-mode back button
    const existingBack = header.querySelector('.header-back');
    if (existingBack) existingBack.remove();

    // Fully restore header HTML for world mode
    const leftEl = header.querySelector('.header-left') as HTMLElement;
    if (leftEl) {
      leftEl.innerHTML =
        `<span class="header-stat"><span class="stat-icon">⚔</span> <span id="hdr-kingdoms">${totalKingdoms}</span> Kingdoms</span>` +
        `<span class="header-stat"><span class="stat-icon">★</span> <span id="hdr-stars">${fmt(totalStars)}</span></span>` +
        `<span class="header-stat"><span class="stat-icon">📝</span> <span id="hdr-commits">${fmt(totalCommits)}</span></span>` +
        `<span class="header-stat"><span class="stat-icon">👥</span> <span id="hdr-citizens">${fmt(totalCitizens)}</span></span>`;
    }

    const hdrTitle = document.getElementById('hdr-title');
    if (hdrTitle) hdrTitle.textContent = 'GIT KINGDOM';

    const rightEl = header.querySelector('.header-right') as HTMLElement;
    if (rightEl) {
      rightEl.innerHTML =
        `<input type="text" id="hdr-search" placeholder="Search world..." />` +
        `<span id="hdr-auth"><a href="/api/auth/login" class="hdr-auth-link" id="hdr-signin">Sign in</a></span>`;

      // Restore auth state if user is already signed in
      const gkUser = (window as any).__gkUser;
      const authEl = document.getElementById('hdr-auth');
      if (gkUser && authEl) {
        authEl.textContent = '';
        const avatar = document.createElement('img');
        avatar.className = 'hdr-auth-avatar';
        avatar.src = gkUser.avatar_url;
        avatar.alt = gkUser.login;
        avatar.title = gkUser.login;
        const nameSpan = document.createElement('span');
        nameSpan.className = 'hdr-auth-name';
        nameSpan.title = 'View your kingdom';
        nameSpan.textContent = gkUser.login;
        authEl.appendChild(avatar);
        authEl.appendChild(document.createTextNode(' '));
        authEl.appendChild(nameSpan);
        authEl.style.cursor = 'pointer';
        authEl.addEventListener('click', () => { window.location.href = `/${gkUser.login}`; });
      }

    }

    // Wire up the search input
    this.setupHeaderSearch();

    // Show the header
    header.style.display = 'flex';
  }

  private setupHeaderSearch() {
    const searchInput = document.getElementById('hdr-search') as HTMLInputElement;
    if (!searchInput) return;

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = searchInput.value.trim().toLowerCase();
        if (!query) return;

        // Search within the loaded universal world for this user's repos
        const shared = (window as any).__gitworld;
        if (!shared?.kingdoms) return;

        // Find language kingdoms matching by owner name OR repo name
        const matchKingdom = (shared.kingdoms as any[]).find((lk: any) =>
          lk.repos.some((r: any) => {
            const fullName = r.repo.full_name.toLowerCase();
            const repoName = r.repo.name.toLowerCase();
            return fullName.startsWith(query + '/') || repoName === query || fullName === query;
          })
        );

        if (matchKingdom) {
          trackWorldSearch({ query, found: true });
          // Find the world kingdom for this language and pan to it
          const wk = this.allKingdoms.find(k => k.language === matchKingdom.language);
          if (wk) {
            const px = wk.centroidX * 16; // TILE_SIZE
            const py = wk.centroidY * 16;
            this.cameras.main.pan(px, py, 600, 'Sine.easeInOut');
            // Show the kingdom info panel after pan
            setTimeout(() => this.showKingdomInfo(wk), 650);
            // Update URL without reload
            window.history.pushState({}, '', `/${query}`);
          }
        } else {
          trackWorldSearch({ query, found: false });
          // User not found in world — show a brief flash on the search input
          searchInput.style.borderColor = '#ff4444';
          searchInput.placeholder = 'Not found in world';
          setTimeout(() => {
            searchInput.style.borderColor = '';
            searchInput.placeholder = 'Search world...';
          }, 1500);
        }

        searchInput.value = '';
        searchInput.blur();
      }
      // Prevent game from receiving WASD/arrow keys while typing
      e.stopPropagation();
    });

    // Prevent Phaser from receiving keyboard events while search is focused
    searchInput.addEventListener('focus', () => {
      if (this.input?.keyboard) {
        this.input.keyboard.enabled = false;
      }
    });
    searchInput.addEventListener('blur', () => {
      if (this.input?.keyboard) {
        this.input.keyboard.enabled = true;
      }
    });
  }

  private buildLegend(kingdoms: WorldKingdom[], _settlements: WorldSettlement[]) {
    const legend = document.getElementById('legend')!;
    const shared = (window as any).__gitworld;

    // Search input at the top (RPGUI auto-styles inputs inside rpgui-content)
    let html = '<div style="margin-bottom:8px">' +
      '<input type="text" id="legend-search" placeholder="Search cities..." />' +
      '</div>';

    html += '<h3>Cities of Git Kingdom</h3>';

    for (const k of kingdoms) {
      const color = KINGDOM_COLORS[k.index % KINGDOM_COLORS.length];
      const hex = '#' + color.toString(16).padStart(6, '0');

      // Get full LanguageKingdom data for top repos preview
      const lk = shared?.kingdoms?.find((lk: any) => lk.language === k.language);
      const repoCount = lk ? lk.repos.length : 1;
      const topRepos = lk
        ? [...lk.repos]
            .sort((a: any, b: any) => b.repo.stargazers_count - a.repo.stargazers_count)
            .slice(0, 3)
            .map((r: any) => r.repo.name)
        : [];

      const starsStr = k.totalStars >= 1000000
        ? (k.totalStars / 1000000).toFixed(1) + 'M★'
        : k.totalStars >= 1000
        ? Math.round(k.totalStars / 1000) + 'k★'
        : k.totalStars + '★';

      const tierIcon =
        k.settlements[0]?.tier === 'capital' ? '👑' :
        k.settlements[0]?.tier === 'city' ? '🏰' :
        k.settlements[0]?.tier === 'town' ? '🏛' : '🏠';

      html += `<div class="legend-item legend-kingdom" data-kingdom="${k.index}">` +
        `<span class="legend-swatch" style="background:${hex}"></span>` +
        `<span class="legend-name">${tierIcon} ${k.language}</span>` +
        `<span class="legend-tier">${repoCount} repos · ${starsStr}</span>` +
        `</div>`;

      // Top repos preview (compact, not clickable sub-items)
      if (topRepos.length > 0) {
        html += `<div class="legend-item" data-kingdom="${k.index}" style="padding-left:22px;font-size:9px;opacity:0.7;cursor:pointer;">` +
          `${topRepos.join(', ')}${repoCount > 3 ? '...' : ''}` +
          `</div>`;
      }
    }
    legend.innerHTML = '<button id="legend-close" class="rpgui-button" title="Close"><p>✕</p></button>' + html;
    legend.style.display = 'none';

    // Show the toggle button
    const toggleBtn = document.getElementById('legend-toggle');
    if (toggleBtn) toggleBtn.style.display = 'block';

    // Re-wire close button (legend innerHTML was replaced)
    const closeBtn = legend.querySelector('#legend-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        legend.style.display = 'none';
      });
    }

    // ── Search functionality ──
    const searchInput = document.getElementById('legend-search') as HTMLInputElement;
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase().trim();
        const items = legend.querySelectorAll('.legend-item') as NodeListOf<HTMLElement>;

        if (!query) {
          items.forEach(el => el.style.display = '');
          return;
        }

        // Filter by language name or top repo names
        const matchingKingdoms = new Set<string>();
        for (const k of kingdoms) {
          const lk = shared?.kingdoms?.find((lk: any) => lk.language === k.language);
          const langMatch = k.language.toLowerCase().includes(query);
          const repoMatch = lk?.repos?.some((r: any) =>
            r.repo.name.toLowerCase().includes(query) ||
            r.repo.full_name.toLowerCase().includes(query)
          );
          if (langMatch || repoMatch) matchingKingdoms.add(String(k.index));
        }

        items.forEach(el => {
          const kidx = el.dataset.kingdom;
          if (kidx !== undefined) {
            el.style.display = matchingKingdoms.has(kidx) ? '' : 'none';
          }
        });
      });

      // Enter key in search → pan to first matching kingdom
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const query = searchInput.value.toLowerCase().trim();
          if (!query) return;
          const match = kingdoms.find(k => {
            if (k.language.toLowerCase().includes(query)) return true;
            const lk = shared?.kingdoms?.find((lk: any) => lk.language === k.language);
            return lk?.repos?.some((r: any) =>
              r.repo.name.toLowerCase().includes(query) ||
              r.repo.full_name.toLowerCase().includes(query)
            );
          });
          if (match) {
            const s = match.settlements[0];
            this.cameras.main.pan(s.x * TILE_SIZE, s.y * TILE_SIZE, 500, 'Power2');
            worldZoomIndex = WORLD_ZOOM_LEVELS.indexOf(2);
            this.cameras.main.zoomTo(2, 500);
            this.showKingdomInfo(match);
          }
        }
      });
    }

    // ── Click handlers — click any kingdom item to pan & show info ──
    legend.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.legend-item') as HTMLElement;
      if (!item) return;

      const idx = parseInt(item.dataset.kingdom!, 10);
      if (isNaN(idx)) return;
      const kk = kingdoms[idx];
      const s = kk.settlements[0];
      this.cameras.main.pan(s.x * TILE_SIZE, s.y * TILE_SIZE, 500, 'Power2');
      this.cameras.main.zoomTo(2, 500);
      this.showKingdomInfo(kk);
    });
  }
}

/** Escape HTML special characters to prevent XSS */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Build a safe GitHub link (username/repo names are validated by GitHub, but escape anyway) */
function ghLink(fullName: string, label?: string): string {
  return `<a class="gh-link" href="https://github.com/${encodeURI(fullName)}" target="_blank" rel="noopener">${esc(label || fullName)}</a>`;
}

function stat(label: string, value: string): string {
  return `<div class="stat"><span class="stat-label">${esc(label)}</span><span class="stat-value">${value}</span></div>`;
}

function statBar(label: string, value: number, max: number, color: string): string {
  const pct = Math.min(100, Math.round((value / max) * 100));
  const fmt = value >= 1000000 ? (value / 1000000).toFixed(1) + 'M'
    : value >= 1000 ? Math.round(value / 1000).toLocaleString() + 'k'
    : value.toLocaleString();
  return `<div class="stat-bar-row">` +
    `<span class="stat-bar-label">${label}</span>` +
    `<div class="stat-bar-track"><div class="stat-bar-fill bar-${color}" style="width:${pct}%"></div></div>` +
    `<span class="stat-bar-value">${fmt}</span>` +
    `</div>`;
}
