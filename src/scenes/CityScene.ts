import Phaser from 'phaser';
import { LanguageKingdom, CityInterior, CityBuilding, TILES } from '../types';
import { generateTileset, TILE_SIZE, TILESET_MARGIN, TILESET_SPACING, SpritePacks, GRASS_B_FRAMES, GRASS_FLOWER_FRAMES, TREE_DEFS, TOWN_B_DECO, createBuildingTextures, getBuildingTextureKey, loadTemplateLibrary, createTemplateVariantTextures, pickBuildingTextureKey, VariantEntry } from '../generators/TilesetGenerator';
import { generateCityInterior, placePublicBuildings } from '../generators/CityGenerator';
import { expandTemplateVariations } from '../editor/VariationEngine';
import { trackBuildingClicked, trackCitizenClicked, trackCityExited, trackPageView } from '../analytics';

// Stepped zoom levels for crisp pixel-art rendering (retro style)
const CITY_ZOOM_LEVELS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 5];
// Minimum zoom index (set dynamically per city to prevent zooming past city edges)
let cityMinZoomIndex = 0;

// Track zoom by index to avoid float comparison issues
let cityZoomIndex = 2; // start at 1x
let cityZoomCooldown = 0; // ms timestamp of last zoom change

function stepCityZoom(direction: number): number {
  const now = Date.now();
  // 200ms cooldown prevents trackpad momentum from skipping levels
  if (now - cityZoomCooldown < 200) return CITY_ZOOM_LEVELS[cityZoomIndex];
  cityZoomCooldown = now;

  if (direction > 0) {
    // Zoom out — clamp to dynamic minimum (city must fill viewport)
    cityZoomIndex = Math.max(cityMinZoomIndex, cityZoomIndex - 1);
  } else {
    // Zoom in
    cityZoomIndex = Math.min(CITY_ZOOM_LEVELS.length - 1, cityZoomIndex + 1);
  }
  return CITY_ZOOM_LEVELS[cityZoomIndex];
}

/**
 * Compute a freshness score (0..0.8) from a repo's pushed_at date.
 * Repos pushed in the last 3 days → 0.8 (brightest)
 * Repos pushed 30+ days ago → 0 (no label, hover-only)
 * Smooth ease-out curve so most repos are faded.
 */
function repoFreshness(pushedAt: string | undefined): number {
  if (!pushedAt) return 0;
  const ageDays = (Date.now() - new Date(pushedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 3) return 0.8;       // very fresh — bright
  if (ageDays >= 30) return 0;         // stale — no label (hover-only)
  // 3..30 days → ease-out from 0.8 to 0
  const t = (ageDays - 3) / 27;        // 0..1 over the 27-day window
  return 0.8 * (1 - t * t);            // quadratic ease-out: fades faster at first
}

// Building rank colors for labels (8 tiers)
const RANK_COLORS: Record<string, string> = {
  citadel: '#ffd700',
  castle: '#e8c252',
  palace: '#d4a856',
  keep: '#c8a853',
  manor: '#b89850',
  guild: '#a89060',
  cottage: '#988068',
  hovel: '#887755',
  camp: '#776644',
};

const RANK_ICONS: Record<string, string> = {
  citadel: '🏰',
  castle: '🏯',
  palace: '🏛',
  keep: '⛪',
  manor: '🏪',
  guild: '🏠',
  cottage: '🛖',
  hovel: '⛺',
  camp: '🪵',
};

// Simple seeded PRNG
function seededRandom(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Citizen sprite definitions — Minifolks villagers pack
// Each spritesheet is 192px wide (6 cols × 32px), 5-7 rows of 32px frames
// Row 0: idle front, Row 1: walk down, Row 2: walk side, Row 3: idle back / walk up
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

interface WalkingCitizen {
  sprite: Phaser.GameObjects.Sprite;
  nameLabel: Phaser.GameObjects.Text;
  key: string;
  currentTile: [number, number];
  targetTile: [number, number] | null;
  speed: number;      // pixels per second
  waitTimer: number;  // ms until next move
  login: string;
}

export class CityScene extends Phaser.Scene {
  private city!: CityInterior;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private buildingLabels: { text: Phaser.GameObjects.Text; rank: string; buildingIndex: number; freshness: number }[] = [];
  private lastZoom = -1;
  private highlightUser: string | null = null;
  // Store data for transitioning back
  private returnData: any = null;
  // Walking citizen NPCs
  private citizenSprites: WalkingCitizen[] = [];
  private cityTerrain: number[][] = [];
  private cityW = 0;
  private cityH = 0;
  // Building sprite refs (for async template texture swapping + hover)
  private buildingSpriteRefs: { sprite: Phaser.GameObjects.Image; rank: string; seed: number; buildingIndex: number }[] = [];
  private templateVariantsByRank: Map<string, VariantEntry[]> | null = null;
  // Hover tooltip
  private hoverTooltip!: Phaser.GameObjects.Container;
  private hoverTooltipBg!: Phaser.GameObjects.Graphics;
  private hoverTooltipText!: Phaser.GameObjects.Text;
  private hoveredBuildingIndex = -1; // track which building's always-on label to hide
  // Bouncing pointer arrow for highlighting buildings
  private pointerArrow: Phaser.GameObjects.Container | null = null;
  private pointerArrowTween: Phaser.Tweens.Tween | null = null;
  // Track DOM event listeners for cleanup on scene switch
  private domListeners: { el: HTMLElement; event: string; handler: EventListener }[] = [];

  constructor() {
    super({ key: 'CityScene' });
  }

  /** Track a DOM event listener for automatic cleanup on scene shutdown */
  private trackListener(el: HTMLElement | null, event: string, handler: EventListener) {
    if (!el) return;
    el.addEventListener(event, handler);
    this.domListeners.push({ el, event, handler });
  }

  private cleanupListeners() {
    for (const { el, event, handler } of this.domListeners) {
      el.removeEventListener(event, handler);
    }
    this.domListeners = [];
  }

  /** Show a bouncing arrow above a building. Click anywhere or Esc dismisses it. */
  private showPointerArrow(x: number, y: number) {
    this.hidePointerArrow();

    // Draw a downward-pointing triangle arrow
    const arrow = this.add.graphics();
    arrow.fillStyle(0xffd700, 1);
    arrow.fillTriangle(-8, -16, 8, -16, 0, 0);
    // Small shadow
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.3);
    shadow.fillEllipse(0, 4, 16, 6);

    const container = this.add.container(x, y, [shadow, arrow]);
    container.setDepth(200);

    this.pointerArrow = container;
    this.pointerArrowTween = this.tweens.add({
      targets: container,
      y: y - 8,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Dismiss on click anywhere or Esc
    const dismissOnClick = () => {
      this.hidePointerArrow();
      this.input.off('pointerdown', dismissOnClick);
    };
    this.input.once('pointerdown', dismissOnClick);

    const dismissOnEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.hidePointerArrow();
        document.removeEventListener('keydown', dismissOnEsc);
      }
    };
    document.addEventListener('keydown', dismissOnEsc);
  }

  private hidePointerArrow() {
    if (this.pointerArrowTween) {
      this.pointerArrowTween.destroy();
      this.pointerArrowTween = null;
    }
    if (this.pointerArrow) {
      this.pointerArrow.destroy();
      this.pointerArrow = null;
    }
  }

  create() {
    try {
      // Clean up listeners from previous lifecycle
      this.cleanupListeners();
      this.events.once('shutdown', () => this.cleanupListeners());

      const data = this.scene.settings.data as {
        kingdom: LanguageKingdom;
        spritePacks?: SpritePacks;
        highlightUser?: string;
        focusRepo?: string; // full_name like "facebook/react" — zoom to this building
        returnData?: any; // data needed to rebuild world scene
        autoShowSheet?: string; // login — auto-open character sheet after load
      };

      this.highlightUser = data.highlightUser?.toLowerCase() || null;
      this.returnData = data.returnData;
      const focusRepo = data.focusRepo?.toLowerCase() || null;
      const autoShowSheet = data.autoShowSheet || null;

      // Reset arrays (scene may be restarted)
      this.buildingLabels = [];
      this.citizenSprites = [];
      this.buildingSpriteRefs = [];
      this.templateVariantsByRank = null;
      this.lastZoom = -1;

      // Generate the city interior
      this.city = generateCityInterior(data.kingdom);
      const { width: W, height: H, terrain, buildings, citizens } = this.city;

      // ── Generate tileset from sprite packs ──
      const spritePacks = data.spritePacks;
      if (!this.textures.exists('tileset')) {
        const tilesetCanvas = generateTileset(spritePacks);
        this.textures.addCanvas('tileset', tilesetCanvas);
      }

      // Register decoration spritesheets from sprite packs
      let hasDecoSprites = false;
      if (spritePacks?.grassBImg && spritePacks.grassBImg.width > 0) {
        if (!this.textures.exists('grass-b')) {
          try {
            this.textures.addSpriteSheet('grass-b', spritePacks.grassBImg, {
              frameWidth: 16, frameHeight: 16, spacing: 0, margin: 0,
            });
          } catch (e) { console.error('[CityScene] Failed to register grass-b:', e); }
        }
        hasDecoSprites = true;
      }
      if (spritePacks?.grassFlowersImg && spritePacks.grassFlowersImg.width > 0) {
        if (!this.textures.exists('grass-flowers')) {
          try {
            this.textures.addSpriteSheet('grass-flowers', spritePacks.grassFlowersImg, {
              frameWidth: 16, frameHeight: 16, spacing: 0, margin: 0,
            });
          } catch (e) { console.error('[CityScene] Failed to register grass-flowers:', e); }
        }
      }
      // Town B decorations (signs, benches, lamps, fences)
      if (spritePacks?.townBImg && spritePacks.townBImg.width > 0) {
        if (!this.textures.exists('town-b')) {
          try {
            this.textures.addSpriteSheet('town-b', spritePacks.townBImg, {
              frameWidth: 16, frameHeight: 16, spacing: 0, margin: 0,
            });
          } catch (e) { console.error('[CityScene] Failed to register town-b:', e); }
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
            tctx.drawImage(img, def.col * 16, 0, 16, 16, 0, 0, 16, 16);
            tctx.drawImage(img, (def.col + 1) * 16, 0, 16, 16, 16, 0, 16, 16);
            tctx.drawImage(img, def.col * 16, 16, 16, 16, 0, 16, 16, 16);
            tctx.drawImage(img, (def.col + 1) * 16, 16, 16, 16, 16, 16, 16, 16);
            this.textures.addCanvas(key, tc);
          }
        }
      }

      // ── Register building textures from town_B ──
      if (spritePacks?.townBImg && spritePacks.townBImg.width > 0) {
        const bldgTextures = createBuildingTextures(spritePacks.townBImg);
        for (const [key, canvas] of bldgTextures) {
          if (!this.textures.exists(key)) {
            this.textures.addCanvas(key, canvas);
          }
        }
      }

      // ── Replace building tiles in terrain with base tile for clean ground ──
      const baseTile = terrain[3]?.[3] ?? TILES.GRASS; // sample a non-border tile
      for (const b of buildings) {
        for (let dy = 0; dy < b.height; dy++) {
          for (let dx = 0; dx < b.width; dx++) {
            const tx = b.x + dx, ty = b.y + dy;
            if (ty >= 0 && ty < H && tx >= 0 && tx < W) {
              terrain[ty][tx] = baseTile;
            }
          }
        }
      }

      // ── Tilemap ──
      const map = this.make.tilemap({
        tileWidth: TILE_SIZE,
        tileHeight: TILE_SIZE,
        width: W,
        height: H,
      });
      const ts = map.addTilesetImage('tileset', 'tileset', TILE_SIZE, TILE_SIZE, TILESET_MARGIN, TILESET_SPACING)!;
      const layer = map.createBlankLayer('terrain', ts, 0, 0, W, H)!;
      layer.putTilesAt(terrain, 0, 0);

      // ── Decorations on forest/grass tiles ──
      if (hasDecoSprites) {
        this.placeDecorations(terrain, W, H, buildings);
      }

      // ── Building sprite overlays (composed multi-tile buildings) ──
      this.placeBuildingSprites(buildings, H);

      // ── Async: load template library → generate variations → swap sprites ──
      this.loadAndApplyTemplates(spritePacks, buildings, H);

      // ── Citizen NPCs walking the streets ──
      this.cityTerrain = terrain;
      this.cityW = W;
      this.cityH = H;

      // Load citizen sprites on-demand (not in preload, to avoid lifecycle issues)
      let needsLoad = false;
      for (const def of CITIZEN_SPRITE_DEFS) {
        if (!this.textures.exists(def.key)) {
          this.load.spritesheet(def.key, def.file, { frameWidth: 32, frameHeight: 32 });
          needsLoad = true;
        }
      }
      if (needsLoad) {
        this.load.once('complete', () => {
          this.createCitizenAnimations();
          this.spawnCitizens(terrain, W, H);
        });
        this.load.start();
      } else {
        this.createCitizenAnimations();
        this.spawnCitizens(terrain, W, H);
      }

      // ── City name label at top (rendered at 4x for crisp text) ──
      const titleLabelScale = 4;
      const titleLabel = this.add.text(
        (W / 2) * TILE_SIZE,
        3 * TILE_SIZE,
        `Kingdom of ${this.city.language}` +
          (this.city.king ? `\n👑 ${this.city.king.login}` : ''),
        {
          fontFamily: "'Press Start 2P', monospace",
          fontSize: `${20 * titleLabelScale}px`,
          color: '#ffd700',
          stroke: '#000000',
          strokeThickness: 7 * titleLabelScale,
          align: 'center',
        }
      );
      titleLabel.setScale(1 / titleLabelScale);
      titleLabel.setOrigin(0.5, 0.5);
      titleLabel.setDepth(12);
      this.buildingLabels.push({ text: titleLabel, rank: 'castle', buildingIndex: -1, freshness: 1.0 });

      // ── Building labels (compact, on-building, only for major buildings) ──
      for (let bi = 0; bi < buildings.length; bi++) {
        const b = buildings[bi];
        const centerX = (b.x + b.width / 2) * TILE_SIZE;
        const bottomY = (b.y + b.height) * TILE_SIZE - 2;

        // Public/civic buildings get a subtle label on the building
        if (b.isPublic) {
          if (b.publicName) {
            const labelScale = 4;
            const label = this.add.text(centerX, bottomY, b.publicName, {
              fontFamily: "'Silkscreen', monospace",
              fontSize: `${10 * labelScale}px`,
              color: '#c8c0a0',
              stroke: '#000000',
              strokeThickness: 3 * labelScale,
              align: 'center',
              backgroundColor: '#00000088',
              padding: { x: 3 * labelScale, y: 2 * labelScale },
            });
            label.setScale(1 / labelScale);
            label.setOrigin(0.5, 1);
            label.setDepth(10);
            this.buildingLabels.push({ text: label, rank: b.rank, buildingIndex: bi, freshness: 1.0 });
          }
          continue;
        }

        if (!b.repoMetrics) continue;

        const isUserRepo = this.isUserBuilding(b);

        // Only show always-on labels for major buildings (castle+ and user repos)
        const isMajor = b.rank === 'citadel' || b.rank === 'castle' || b.rank === 'palace' || b.rank === 'keep';
        if (!isMajor && !isUserRepo) {
          // Gold glow ring for user's buildings
          continue;
        }

        const color = isUserRepo ? '#ffd700' : (RANK_COLORS[b.rank] || '#e8d5a3');
        const displayName = b.repoMetrics.repo.name;

        // Render labels at 4x resolution, positioned on the building body
        const labelScale = 4;
        const label = this.add.text(centerX, bottomY, displayName, {
          fontFamily: "'Silkscreen', monospace",
          fontSize: `${12 * labelScale}px`,
          color,
          stroke: '#000000',
          strokeThickness: 4 * labelScale,
          align: 'center',
          backgroundColor: '#00000088',
          padding: { x: 3 * labelScale, y: 2 * labelScale },
        });
        const fresh = repoFreshness(b.repoMetrics.repo.pushed_at);
        label.setScale(1 / labelScale);
        label.setOrigin(0.5, 1);
        label.setDepth(10);
        label.setAlpha(fresh);
        this.buildingLabels.push({ text: label, rank: b.rank, buildingIndex: bi, freshness: fresh });

        // User's buildings: just the gold label (no circle ring)
      }

      // ── Hover tooltip (shown when mousing over any building) ──
      this.createHoverTooltip();

      // ── Countryside background (grass + trees beyond city walls) ──
      // Calculate padding so countryside fills the viewport even at max zoom-out (0.5x)
      const minZoom = CITY_ZOOM_LEVELS[0]; // 0.5x
      const neededWorldW = window.innerWidth / minZoom;
      const neededWorldH = window.innerHeight / minZoom;
      const extraW = Math.max(0, (neededWorldW - W * TILE_SIZE) / 2);
      const extraH = Math.max(0, (neededWorldH - H * TILE_SIZE) / 2);
      const padPx = Math.ceil(Math.max(extraW, extraH)) + TILE_SIZE * 4; // + a few tiles buffer
      const COUNTRYSIDE_PAD_TILES = Math.ceil(padPx / TILE_SIZE);
      // Solid grass background behind everything
      const bgRect = this.add.rectangle(
        (W * TILE_SIZE) / 2, (H * TILE_SIZE) / 2,
        W * TILE_SIZE + padPx * 2, H * TILE_SIZE + padPx * 2,
        0x4a8c3f, // grass green
      );
      bgRect.setDepth(-2);
      // Scatter countryside trees and bushes in the ring around the city
      this.placeCountryside(W, H, COUNTRYSIDE_PAD_TILES);

      // ── Camera ── total area includes city + countryside ring
      const totalW = W * TILE_SIZE + padPx * 2;
      const totalH = H * TILE_SIZE + padPx * 2;
      this.cameras.main.setBounds(
        -padPx, -padPx,
        totalW, totalH,
      );
      this.cameras.main.centerOn((W / 2) * TILE_SIZE, (H / 2) * TILE_SIZE);
      this.cameras.main.setRoundPixels(true);

      // Allow zooming out to 0.5x — countryside covers everything, no black void
      cityMinZoomIndex = 0;
      // Start at 1x zoom
      cityZoomIndex = 2;
      this.cameras.main.setZoom(CITY_ZOOM_LEVELS[cityZoomIndex]);

      // ── Deep link: focus on a specific repo building ──
      if (focusRepo) {
        const targetBuilding = buildings.find(b =>
          b.repoMetrics?.repo.full_name.toLowerCase() === focusRepo
        );
        if (targetBuilding) {
          // Center camera on the building
          const bx = (targetBuilding.x + targetBuilding.width / 2) * TILE_SIZE;
          const by = (targetBuilding.y + targetBuilding.height / 2) * TILE_SIZE;
          this.cameras.main.centerOn(bx, by);
          // Zoom in close
          cityZoomIndex = 4; // 2x zoom
          this.cameras.main.setZoom(CITY_ZOOM_LEVELS[cityZoomIndex]);
          // Show bouncing arrow above the building
          this.showPointerArrow(bx, targetBuilding.y * TILE_SIZE - 12);
          console.log(`[Deep link] Focused on ${focusRepo} at (${targetBuilding.x}, ${targetBuilding.y})`);
        }
      }

      // ── Input ──
      this.cursors = this.input.keyboard!.createCursorKeys();
      this.wasd = {
        W: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        A: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        S: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        D: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };

      this.input.on('wheel', (_p: any, _g: any, _dx: number, deltaY: number) => {
        this.cameras.main.setZoom(stepCityZoom(deltaY));
      });

      // Click on buildings
      let dragStartX = 0, dragStartY = 0;
      let isDragging = false;
      let camStartX = 0, camStartY = 0;

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
      this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        if (isDragging) { isDragging = false; return; }
        const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const tx = Math.floor(wp.x / TILE_SIZE);
        const ty = Math.floor(wp.y / TILE_SIZE);

        // Check if clicked near a citizen NPC first
        let clickedCitizen: WalkingCitizen | null = null;
        let citizenDist = Infinity;
        for (const c of this.citizenSprites) {
          const dx = c.sprite.x - wp.x;
          const dy = c.sprite.y - wp.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < citizenDist && d < TILE_SIZE * 1.5) {
            citizenDist = d;
            clickedCitizen = c;
          }
        }

        if (clickedCitizen) {
          this.showCharacterSheet(clickedCitizen.login);
          return;
        }

        // Find building whose footprint contains the click
        // Two passes: 1) exact hit (smallest wins), 2) nearest within 1 tile
        let closestBuilding: CityBuilding | null = null;
        let closestDist = Infinity;
        // Pass 1: exact footprint hit — smallest building wins (for overlaps)
        for (const b of buildings) {
          const inside = tx >= b.x && tx < b.x + b.width && ty >= b.y && ty < b.y + b.height;
          if (inside) {
            const area = b.width * b.height;
            if (area < closestDist) { closestDist = area; closestBuilding = b; }
          }
        }
        // Pass 2: no exact hit — find nearest building within 1 tile
        if (!closestBuilding) {
          closestDist = Infinity;
          for (const b of buildings) {
            const dx = Math.max(b.x - tx, 0, tx - (b.x + b.width - 1));
            const dy = Math.max(b.y - ty, 0, ty - (b.y + b.height - 1));
            const d = dx + dy;
            if (d <= 1 && d < closestDist) { closestDist = d; closestBuilding = b; }
          }
        }

        if (closestBuilding) {
          this.showBuildingInfo(closestBuilding);
        } else {
          this.hideInfoPanel();
        }
      });

      // ── Build UI ──
      this.buildCityLegend(buildings);
      this.addBackButton();
      this.updateControlsHint();

      const el = document.getElementById('loading');
      if (el) el.style.display = 'none';

      // Auto-open character sheet if requested (from /<username> URL route)
      if (autoShowSheet) {
        this.time.delayedCall(300, () => {
          this.showCharacterSheet(autoShowSheet);
        });
      }

    } catch (err) {
      console.error('[CityScene] create() error:', err);
    }
  }

  private isUserBuilding(b: CityBuilding): boolean {
    if (!this.highlightUser || !b.repoMetrics) return false;
    const owner = b.repoMetrics.repo.full_name.split('/')[0].toLowerCase();
    return owner === this.highlightUser;
  }

  /** Scale a building sprite to fit within its footprint (prevents overlap) */
  private fitSpriteToFootprint(sprite: Phaser.GameObjects.Image, b: CityBuilding) {
    const footW = b.width * TILE_SIZE;
    const footH = b.height * TILE_SIZE;
    if (sprite.width > footW || sprite.height > footH) {
      const scale = Math.min(footW / sprite.width, footH / sprite.height);
      sprite.setScale(scale);
    } else {
      sprite.setScale(1);
    }
  }

  private placeBuildingSprites(buildings: CityBuilding[], mapHeight: number) {
    this.buildingSpriteRefs = [];
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      // Use building index as seed for variety
      const seed = i * 7 + b.x * 3 + b.y;
      const texKey = this.templateVariantsByRank
        ? pickBuildingTextureKey(b.rank, seed, this.templateVariantsByRank, b.width, b.height)
        : getBuildingTextureKey(b.rank, seed);

      if (!this.textures.exists(texKey)) continue;

      // Position: bottom of sprite aligns with bottom of building footprint
      // Sprite is centered horizontally on the building footprint
      const footCenterX = (b.x + b.width / 2) * TILE_SIZE;
      const footBottomY = (b.y + b.height) * TILE_SIZE;

      const sprite = this.add.image(footCenterX, footBottomY, texKey);
      sprite.setOrigin(0.5, 1); // anchor at bottom-center
      // Scale sprite to fit within footprint — prevents tall sprites from
      // overlapping buildings in the row above
      this.fitSpriteToFootprint(sprite, b);
      // Y-sort depth: buildings further down render on top
      sprite.setDepth(4 + (b.y + b.height) / mapHeight * 2);

      // Make interactive for hover tooltip
      sprite.setInteractive({ useHandCursor: true });
      sprite.on('pointerover', () => this.showHoverTooltip(i));
      sprite.on('pointerout', () => this.hideHoverTooltip());

      this.buildingSpriteRefs.push({ sprite, rank: b.rank, seed, buildingIndex: i });
    }
  }

  // ── Hover tooltip system ─────────────────────────────────────

  private createHoverTooltip() {
    // Reusable tooltip container — hidden by default
    this.hoverTooltipBg = this.add.graphics();
    const labelScale = 4;
    this.hoverTooltipText = this.add.text(0, 0, '', {
      fontFamily: "'Silkscreen', monospace",
      fontSize: `${12 * labelScale}px`,
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3 * labelScale,
      align: 'center',
    });
    this.hoverTooltipText.setScale(1 / labelScale);
    this.hoverTooltipText.setOrigin(0.5, 1);

    this.hoverTooltip = this.add.container(0, 0, [
      this.hoverTooltipBg,
      this.hoverTooltipText,
    ]);
    this.hoverTooltip.setDepth(15);
    this.hoverTooltip.setVisible(false);
  }

  private showHoverTooltip(buildingIndex: number) {
    const b = this.city.buildings[buildingIndex];
    if (!b) return;

    // Hide any always-on label for this building to avoid duplicate text
    this.hoveredBuildingIndex = buildingIndex;
    for (const lbl of this.buildingLabels) {
      if (lbl.buildingIndex === buildingIndex) {
        lbl.text.setVisible(false);
      }
    }

    let name: string;
    let detail = '';
    let nameColor = '#ffffff';

    if (b.isPublic && b.publicName) {
      name = b.publicName;
      nameColor = '#c8c0a0';
    } else if (b.repoMetrics) {
      name = b.repoMetrics.repo.name;
      const stars = b.repoMetrics.repo.stargazers_count;
      if (stars > 0) {
        detail = `  ★ ${stars >= 1000 ? Math.round(stars / 1000) + 'k' : stars}`;
      }
      const isUserRepo = this.isUserBuilding(b);
      nameColor = isUserRepo ? '#ffd700' : (RANK_COLORS[b.rank] || '#e8d5a3');
    } else {
      // Filler building — unnamed commoner home
      name = 'Commoner Home';
      nameColor = '#8a8070';
    }

    const labelScale = 4;
    const displayText = name + detail;
    this.hoverTooltipText.setText(displayText);
    this.hoverTooltipText.setColor(nameColor);

    // Position tooltip at the bottom of the building
    const cx = (b.x + b.width / 2) * TILE_SIZE;
    const cy = (b.y + b.height) * TILE_SIZE + 2;
    this.hoverTooltipText.setPosition(0, 0);

    // Measure text for background (account for 4x scale)
    const textW = this.hoverTooltipText.width / labelScale;
    const textH = this.hoverTooltipText.height / labelScale;
    const padX = 4;
    const padY = 2;

    this.hoverTooltipBg.clear();
    this.hoverTooltipBg.fillStyle(0x000000, 0.75);
    this.hoverTooltipBg.fillRoundedRect(
      -textW / 2 - padX,
      -textH - padY,
      textW + padX * 2,
      textH + padY * 2,
      3
    );

    this.hoverTooltip.setPosition(cx, cy);
    this.hoverTooltip.setVisible(true);

    // Scale with zoom
    const zoom = this.cameras.main.zoom;
    const scale = Phaser.Math.Clamp(1 / zoom, 0.15, 2.0);
    this.hoverTooltip.setScale(scale);
  }

  private hideHoverTooltip() {
    if (this.hoverTooltip) {
      this.hoverTooltip.setVisible(false);
    }
    // Restore always-on label for the previously hovered building
    if (this.hoveredBuildingIndex >= 0) {
      for (const lbl of this.buildingLabels) {
        if (lbl.buildingIndex === this.hoveredBuildingIndex) {
          lbl.text.setVisible(true);
        }
      }
      this.hoveredBuildingIndex = -1;
    }
  }

  /**
   * Async-load template library, generate all visual variations
   * (roof color swaps × mirrors × decoration swaps), register textures,
   * update existing building sprites, and place public/civic buildings.
   */
  private async loadAndApplyTemplates(
    spritePacks: SpritePacks | undefined,
    buildings: CityBuilding[],
    mapHeight: number,
  ) {
    if (!spritePacks?.townBImg) return;

    try {
      const templates = await loadTemplateLibrary();
      if (templates.length === 0) return;

      // Split templates into repo-buildings vs public/civic
      const repoTemplates = templates.filter(t => !t.tags?.includes('public'));
      const publicTemplates = templates.filter(t => t.tags?.includes('public'));

      // Expand repo templates into all variations and render to canvases
      if (repoTemplates.length > 0) {
        const { textures, variantsByRank } = createTemplateVariantTextures(spritePacks, repoTemplates);

        for (const [key, canvas] of textures) {
          if (!this.textures.exists(key)) {
            this.textures.addCanvas(key, canvas);
          }
        }

        this.templateVariantsByRank = variantsByRank;

        // Swap building sprites to use template textures where available
        for (const ref of this.buildingSpriteRefs) {
          const b = buildings[ref.buildingIndex];
          const newKey = pickBuildingTextureKey(ref.rank, ref.seed, variantsByRank, b?.width, b?.height);
          if (newKey !== ref.sprite.texture.key && this.textures.exists(newKey)) {
            ref.sprite.setTexture(newKey);
            // Re-scale after texture swap — new texture may have different dimensions
            if (b) this.fitSpriteToFootprint(ref.sprite, b);
          }
        }

        const totalVariants = [...variantsByRank.values()].reduce((n, arr) => n + arr.length, 0);
        const rankDetail = [...variantsByRank.entries()].map(([r, keys]) => `${r}(${keys.length})`).join(', ');
        console.log(
          `[CityScene] Templates: ${repoTemplates.length} base → ${totalVariants} variants | ${rankDetail}`,
        );

        // Log how many buildings could receive template textures
        let swapped = 0;
        for (const ref of this.buildingSpriteRefs) {
          if (variantsByRank.has(ref.rank)) swapped++;
        }
        console.log(`[CityScene] Buildings eligible for template textures: ${swapped}/${this.buildingSpriteRefs.length}`);
      }

      // ── Place public/civic buildings ──
      if (publicTemplates.length > 0) {
        // Generate all visual variations for public templates
        const publicVariants = expandTemplateVariations(publicTemplates);

        // Render public variant textures
        const { textures: pubTextures } = createTemplateVariantTextures(spritePacks, publicTemplates);
        for (const [key, canvas] of pubTextures) {
          if (!this.textures.exists(key)) {
            this.textures.addCanvas(key, canvas);
          }
        }

        // Place civic buildings into the existing city
        const newBuildings = placePublicBuildings(this.city, publicVariants);

        // Create sprites and labels for new civic buildings
        const civicBuildingStartIndex = this.city.buildings.length - newBuildings.length;
        for (let ni = 0; ni < newBuildings.length; ni++) {
          const b = newBuildings[ni];
          const globalIndex = civicBuildingStartIndex + ni;
          // Use the template's own texture key if assigned
          const texKey = b.templateKey || '';
          if (texKey && this.textures.exists(texKey)) {
            const footCenterX = (b.x + b.width / 2) * TILE_SIZE;
            const footBottomY = (b.y + b.height) * TILE_SIZE;
            const sprite = this.add.image(footCenterX, footBottomY, texKey);
            sprite.setOrigin(0.5, 1);
            this.fitSpriteToFootprint(sprite, b);
            sprite.setDepth(4 + (b.y + b.height) / mapHeight * 2);
            // Make interactive for hover
            sprite.setInteractive({ useHandCursor: true });
            sprite.on('pointerover', () => this.showHoverTooltip(globalIndex));
            sprite.on('pointerout', () => this.hideHoverTooltip());
          }

          // Add civic label on the building
          if (b.publicName) {
            const centerX = (b.x + b.width / 2) * TILE_SIZE;
            const bottomY = (b.y + b.height) * TILE_SIZE - 2;
            const labelScale = 4;
            const label = this.add.text(centerX, bottomY, b.publicName, {
              fontFamily: "'Silkscreen', monospace",
              fontSize: `${10 * labelScale}px`,
              color: '#c8c0a0',
              stroke: '#000000',
              strokeThickness: 3 * labelScale,
              align: 'center',
              backgroundColor: '#00000088',
              padding: { x: 3 * labelScale, y: 2 * labelScale },
            });
            label.setScale(1 / labelScale);
            label.setOrigin(0.5, 1);
            label.setDepth(10);
            this.buildingLabels.push({ text: label, rank: b.rank, buildingIndex: globalIndex, freshness: 1.0 });
          }
        }

        // Rebuild legend to include civic buildings
        if (newBuildings.length > 0) {
          this.buildCityLegend(this.city.buildings);
        }

        console.log(
          `[CityScene] Public templates: ${publicTemplates.length} base → ${newBuildings.length} civic buildings placed`,
        );
      }
    } catch (e) {
      console.warn('[CityScene] Template loading skipped:', e);
    }
  }

  // ── Countryside: grass, trees, bushes beyond city walls ──
  private placeCountryside(W: number, H: number, pad: number) {
    const rand = seededRandom(7777);
    const cityPx = W * TILE_SIZE;
    const cityPy = H * TILE_SIZE;
    const padPx = pad * TILE_SIZE;

    // Scatter trees and bushes in the countryside ring around the city
    const decoCount = Math.min(pad * 10, 600); // cap decorations for perf
    for (let i = 0; i < decoCount; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = (2 + rand() * (pad - 3)) * TILE_SIZE;
      // Pick a random edge: top, bottom, left, right, or corners
      let px: number, py: number;
      const side = Math.floor(rand() * 4);
      if (side === 0) { // top
        px = rand() * (cityPx + padPx * 2) - padPx;
        py = -rand() * padPx;
      } else if (side === 1) { // bottom
        px = rand() * (cityPx + padPx * 2) - padPx;
        py = cityPy + rand() * padPx;
      } else if (side === 2) { // left
        px = -rand() * padPx;
        py = rand() * (cityPy + padPx * 2) - padPx;
      } else { // right
        px = cityPx + rand() * padPx;
        py = rand() * (cityPy + padPx * 2) - padPx;
      }

      const r = rand();
      if (r < 0.5) {
        // Tree
        const treeDef = TREE_DEFS[Math.floor(rand() * TREE_DEFS.length)];
        const key = `tree-${treeDef.name}`;
        if (this.textures.exists(key)) {
          const tree = this.add.image(px, py, key);
          tree.setDepth(-1);
        }
      } else if (r < 0.75 && this.textures.exists('grass-b')) {
        // Bush
        const frame = GRASS_B_FRAMES.bushes[Math.floor(rand() * GRASS_B_FRAMES.bushes.length)];
        const bush = this.add.image(px, py, 'grass-b', frame);
        bush.setDepth(-1);
      } else if (this.textures.exists('grass-flowers')) {
        // Flowers
        const frame = GRASS_FLOWER_FRAMES.allSmall[Math.floor(rand() * GRASS_FLOWER_FRAMES.allSmall.length)];
        const flower = this.add.image(px, py, 'grass-flowers', frame);
        flower.setOrigin(0.5, 0.5);
        flower.setDepth(-1);
      }
    }
  }

  private placeDecorations(terrain: number[][], W: number, H: number, buildings: CityBuilding[]) {
    const rand = seededRandom(12345);

    // PERF: Use flat grid instead of string-keyed Set for building zone checks
    const buildingZone = new Uint8Array(W * H);
    for (const b of buildings) {
      for (let dy = -1; dy <= b.height; dy++) {
        for (let dx = -1; dx <= b.width; dx++) {
          const px = b.x + dx, py = b.y + dy;
          if (px >= 0 && px < W && py >= 0 && py < H) buildingZone[py * W + px] = 1;
        }
      }
    }

    const hasGrassB = this.textures.exists('grass-b');
    const hasFlowers = this.textures.exists('grass-flowers');
    const hasTownB = this.textures.exists('town-b');

    const greenTreeKeys = TREE_DEFS.filter(d => !d.name.startsWith('dead') && d.name !== 'palm')
      .map(d => `tree-${d.name}`).filter(k => this.textures.exists(k));

    // Helper to check if a neighbor tile is of a given type
    const tileAt = (x: number, y: number) =>
      x >= 0 && x < W && y >= 0 && y < H ? terrain[y][x] : -1;
    const isRoad = (x: number, y: number) => tileAt(x, y) === TILES.ROAD;
    const isGrass = (x: number, y: number) => {
      const t = tileAt(x, y);
      return t === TILES.GRASS || t === TILES.GRASS_DARK ||
        (t >= TILES.CITY_GRASS_1 && t <= TILES.CITY_GRASS_6);
    };

    // Identify road-adjacent grass tiles (good for street trees, fences, lamps)
    // PERF: Use flat grid instead of string-keyed Set
    const roadAdjGrass = new Uint8Array(W * H);
    const midX = Math.floor(W / 2);
    const midY = Math.floor(H / 2);

    for (let y = 2; y < H - 2; y++) {
      for (let x = 2; x < W - 2; x++) {
        if (isGrass(x, y) && !buildingZone[y * W + x]) {
          if (isRoad(x - 1, y) || isRoad(x + 1, y) || isRoad(x, y - 1) || isRoad(x, y + 1)) {
            roadAdjGrass[y * W + x] = 1;
          }
        }
      }
    }

    // ── Pass 1: Place structured decorations (lamps at intervals, trees along roads) ──
    // Place lamp posts at regular intervals along main roads
    if (hasTownB) {
      const lampFrames = TOWN_B_DECO.townLamps;
      for (let y = 4; y < H - 4; y += 3) {
        for (let x = 4; x < W - 4; x += 3) {
          if (!isRoad(x, y)) continue;
          // Place lamp if next to grass (roadside lamp)
          if (isGrass(x - 1, y) || isGrass(x + 1, y)) {
            const frame = lampFrames[Math.floor(rand() * lampFrames.length)];
            const s = this.add.sprite(x * TILE_SIZE + 8, y * TILE_SIZE + 8, 'town-b', frame);
            s.setOrigin(0.5, 0.5);
            s.setDepth(3 + y / H);
          }
        }
      }
    }

    // Place potted trees along road-adjacent grass tiles
    if (hasTownB) {
      const treeFrames = TOWN_B_DECO.townTrees;
      for (let y = 2; y < H - 2; y++) {
        for (let x = 2; x < W - 2; x++) {
          if (!roadAdjGrass[y * W + x]) continue;
          if (rand() > 0.12) continue; // ~12% chance
          const frame = treeFrames[Math.floor(rand() * treeFrames.length)];
          const s = this.add.sprite(x * TILE_SIZE + 8, y * TILE_SIZE + 8, 'town-b', frame);
          s.setOrigin(0.5, 0.5);
          s.setDepth(3 + y / H);
        }
      }
    }

    // Place benches near the plaza (within 6 tiles of center)
    if (hasTownB) {
      const benchFrames = TOWN_B_DECO.townBenches;
      for (let y = midY - 6; y <= midY + 6; y++) {
        for (let x = midX - 6; x <= midX + 6; x++) {
          if (!isRoad(x, y) || buildingZone[y * W + x]) continue;
          if (rand() > 0.04) continue;
          const frame = benchFrames[Math.floor(rand() * benchFrames.length)];
          const s = this.add.sprite(x * TILE_SIZE + 8, y * TILE_SIZE + 8, 'town-b', frame);
          s.setOrigin(0.5, 0.5);
          s.setDepth(3 + y / H);
        }
      }
    }

    // Place flower pots near buildings
    if (hasTownB) {
      const flowerFrames = TOWN_B_DECO.townFlowers;
      for (const b of buildings) {
        // Place 1-3 flower pots around each building
        const count = 1 + Math.floor(rand() * 3);
        for (let i = 0; i < count; i++) {
          // Pick a random spot adjacent to building
          const side = Math.floor(rand() * 4);
          let fx: number, fy: number;
          if (side === 0) { fx = b.x + Math.floor(rand() * b.width); fy = b.y - 1; }       // above
          else if (side === 1) { fx = b.x + Math.floor(rand() * b.width); fy = b.y + b.height; } // below
          else if (side === 2) { fx = b.x - 1; fy = b.y + Math.floor(rand() * b.height); }  // left
          else { fx = b.x + b.width; fy = b.y + Math.floor(rand() * b.height); }             // right

          if (fx < 0 || fx >= W || fy < 0 || fy >= H) continue;
          // Only place flower pots on grass, not on roads
          if (!isGrass(fx, fy)) continue;

          const frame = flowerFrames[Math.floor(rand() * flowerFrames.length)];
          const s = this.add.sprite(fx * TILE_SIZE + 8, fy * TILE_SIZE + 8, 'town-b', frame);
          s.setOrigin(0.5, 0.5);
          s.setDepth(3 + fy / H);
        }
      }
    }

    // Place signs near guild/market buildings
    if (hasTownB) {
      const signFrames = TOWN_B_DECO.townSigns;
      for (const b of buildings) {
        if (b.rank !== 'guild' && b.rank !== 'cottage') continue;
        if (rand() > 0.6) continue;
        // Place sign in front of building (below)
        const sx = b.x + Math.floor(b.width / 2);
        const sy = b.y + b.height;
        if (sy < H && isGrass(sx, sy)) {
          const frame = signFrames[Math.floor(rand() * signFrames.length)];
          const s = this.add.sprite(sx * TILE_SIZE + 8, sy * TILE_SIZE + 8, 'town-b', frame);
          s.setOrigin(0.5, 0.5);
          s.setDepth(3 + sy / H);
        }
      }
    }

    // ── Pass 2: Scatter natural decorations on terrain ──
    for (let y = 2; y < H - 2; y++) {
      for (let x = 2; x < W - 2; x++) {
        const tile = terrain[y][x];
        if (buildingZone[y * W + x]) continue;

        const r = rand();
        const px = x * TILE_SIZE + rand() * 4 - 2;
        const py = y * TILE_SIZE + rand() * 4 - 2;

        if (tile === TILES.FOREST) {
          if (r < 0.30 && greenTreeKeys.length > 0) {
            const key = greenTreeKeys[Math.floor(rand() * greenTreeKeys.length)];
            const sprite = this.add.sprite(px + 8, py + 8, key);
            sprite.setOrigin(0.5, 0.5);
            sprite.setDepth(3 + (y / H) * 2);
          } else if (r < 0.42 && hasGrassB) {
            const frame = GRASS_B_FRAMES.bushes[Math.floor(rand() * GRASS_B_FRAMES.bushes.length)];
            const sprite = this.add.sprite(px + 8, py + 8, 'grass-b', frame);
            sprite.setOrigin(0.5, 0.5);
          } else if (r < 0.50 && hasFlowers) {
            const frame = GRASS_FLOWER_FRAMES.allSmall[Math.floor(rand() * GRASS_FLOWER_FRAMES.allSmall.length)];
            const sprite = this.add.sprite(px + 8, py + 12, 'grass-flowers', frame);
            sprite.setOrigin(0.5, 0.5);
          }
        } else if (tile === TILES.GRASS_DARK) {
          if (r < 0.08 && greenTreeKeys.length > 0) {
            const key = greenTreeKeys[Math.floor(rand() * greenTreeKeys.length)];
            const sprite = this.add.sprite(px + 8, py + 8, key);
            sprite.setOrigin(0.5, 0.5);
            sprite.setDepth(3 + (y / H) * 2);
          } else if (r < 0.12 && hasGrassB) {
            const frame = GRASS_B_FRAMES.bushes[Math.floor(rand() * GRASS_B_FRAMES.bushes.length)];
            const sprite = this.add.sprite(px + 8, py + 8, 'grass-b', frame);
            sprite.setOrigin(0.5, 0.5);
          } else if (r < 0.16 && hasFlowers) {
            const frame = GRASS_FLOWER_FRAMES.allSmall[Math.floor(rand() * GRASS_FLOWER_FRAMES.allSmall.length)];
            const sprite = this.add.sprite(px + 8, py + 12, 'grass-flowers', frame);
            sprite.setOrigin(0.5, 0.5);
          }
        } else if (tile === TILES.GRASS || (tile >= TILES.CITY_GRASS_1 && tile <= TILES.CITY_GRASS_6)) {
          if (r < 0.04 && hasFlowers) {
            const frame = GRASS_FLOWER_FRAMES.allSmall[Math.floor(rand() * GRASS_FLOWER_FRAMES.allSmall.length)];
            const sprite = this.add.sprite(px + 8, py + 12, 'grass-flowers', frame);
            sprite.setOrigin(0.5, 0.5);
          } else if (r < 0.06 && hasGrassB) {
            const frame = GRASS_B_FRAMES.stonesSmall[Math.floor(rand() * GRASS_B_FRAMES.stonesSmall.length)];
            const sprite = this.add.sprite(px + 8, py + 8, 'grass-b', frame);
            sprite.setOrigin(0.5, 0.5);
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

    // ── Move citizen NPCs ──
    this.updateCitizens(delta);

    // Scale-aware labels: render at 4x, clamp effective screen size
    const zoom = cam.zoom;
    if (Math.abs(zoom - this.lastZoom) > 0.01) {
      this.lastZoom = zoom;
      const labelScale = 4;
      // Clamp so labels never get too huge (zoomed out) or too tiny (zoomed in)
      const effectiveScale = Phaser.Math.Clamp(1 / zoom, 0.15, 2.0) / labelScale;

      // Simplified LOD: only major building labels exist now, minor are hover-only
      // Alpha is capped by freshness (recently pushed repos = bright, stale = hidden)
      for (const { text, rank, buildingIndex, freshness } of this.buildingLabels) {
        text.setScale(effectiveScale);
        // Don't re-show a label that's hidden because we're hovering that building
        if (buildingIndex === this.hoveredBuildingIndex && buildingIndex >= 0) continue;

        // Stale repos (freshness 0) get no persistent label — hover-only
        if (freshness <= 0) {
          text.setVisible(false);
          continue;
        }

        const isMajor = rank === 'citadel' || rank === 'castle';
        const isUpper = rank === 'palace' || rank === 'keep';

        if (zoom < 0.7) {
          text.setVisible(isMajor);
          text.setAlpha(isMajor ? freshness : 0);
        } else if (zoom < 1.2) {
          text.setVisible(isMajor || isUpper);
          text.setAlpha(isMajor ? freshness : Phaser.Math.Clamp((zoom - 0.7) / 0.5, 0, freshness));
        } else {
          text.setVisible(true);
          text.setAlpha(freshness);
        }
      }

      // Scale hover tooltip with zoom
      if (this.hoverTooltip?.visible) {
        const tooltipScale = Phaser.Math.Clamp(1 / zoom, 0.15, 2.0);
        this.hoverTooltip.setScale(tooltipScale);
      }

      // Scale citizen name labels
      for (const c of this.citizenSprites) {
        c.nameLabel.setScale(effectiveScale);
        // Fade citizen names in from zoom 1.2→1.8
        if (zoom < 1.2) {
          c.nameLabel.setVisible(false);
        } else {
          c.nameLabel.setVisible(true);
          c.nameLabel.setAlpha(Phaser.Math.Clamp((zoom - 1.2) / 0.6, 0, 1));
        }
      }
    }
  }

  // ── Citizen NPC system ──────────────────────────────────────

  private createCitizenAnimations() {
    for (const def of CITIZEN_SPRITE_DEFS) {
      if (!this.textures.exists(def.key)) continue;
      const prefix = def.key;
      if (this.anims.exists(`${prefix}-idle`)) continue;

      // Row 0: idle front (3 frames)
      this.anims.create({
        key: `${prefix}-idle`,
        frames: this.anims.generateFrameNumbers(def.key, { frames: [0, 1, 2] }),
        frameRate: 3,
        repeat: -1,
      });
      // Row 1: walk down (4 frames)
      this.anims.create({
        key: `${prefix}-walk-down`,
        frames: this.anims.generateFrameNumbers(def.key, { frames: [6, 7, 8, 9] }),
        frameRate: 6,
        repeat: -1,
      });
      // Row 2: walk side/right (4 frames)
      this.anims.create({
        key: `${prefix}-walk-right`,
        frames: this.anims.generateFrameNumbers(def.key, { frames: [12, 13, 14, 15] }),
        frameRate: 6,
        repeat: -1,
      });
      // Row 3: walk up (3 frames)
      this.anims.create({
        key: `${prefix}-walk-up`,
        frames: this.anims.generateFrameNumbers(def.key, { frames: [18, 19, 20] }),
        frameRate: 6,
        repeat: -1,
      });
    }
  }

  private spawnCitizens(terrain: number[][], W: number, H: number) {
    // Find all road tiles
    const roadTiles: [number, number][] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (terrain[y][x] === TILES.ROAD) {
          roadTiles.push([x, y]);
        }
      }
    }
    if (roadTiles.length === 0) return;

    // Scale citizen count with city size (more buildings = more citizens)
    const buildingCount = this.city.buildings.length;
    const citizenCap = buildingCount < 10 ? 10 : buildingCount < 50 ? 20 : 30;
    const maxCitizens = Math.min(citizenCap, this.city.citizens.length, roadTiles.length);
    const citizensToSpawn = this.city.citizens.slice(0, maxCitizens);
    const rand = seededRandom(54321);

    for (let i = 0; i < citizensToSpawn.length; i++) {
      const citizen = citizensToSpawn[i];
      const startIdx = Math.floor(rand() * roadTiles.length);
      const [sx, sy] = roadTiles[startIdx];

      const spriteKey = this.getSpriteForCitizen(i, citizensToSpawn.length);
      if (!this.textures.exists(spriteKey)) continue;

      const px = sx * TILE_SIZE + TILE_SIZE / 2;
      const py = sy * TILE_SIZE + TILE_SIZE / 2;

      const sprite = this.add.sprite(px, py, spriteKey, 0);
      sprite.setScale(1.0); // 32px sprite fills ~1 tile (character art fills the frame)
      sprite.setDepth(7);   // above decorations, below building labels
      sprite.play(`${spriteKey}-idle`);

      // Name label (visible when zoomed in) — rendered at 4x for crisp text
      const isKing = i === 0;
      const isUser = this.highlightUser === citizen.login.toLowerCase();
      const citizenLabelScale = 4;
      const nameLabel = this.add.text(px, py - 18,
        citizen.login, {
        fontFamily: "'Silkscreen', monospace",
        fontSize: `${11 * citizenLabelScale}px`,
        color: isKing ? '#ffd700' : isUser ? '#ffd700' : '#e8d5a3',
        stroke: '#000000',
        strokeThickness: 4 * citizenLabelScale,
        align: 'center',
      });
      nameLabel.setScale(1 / citizenLabelScale);
      nameLabel.setOrigin(0.5, 1);
      nameLabel.setDepth(11);
      nameLabel.setVisible(false); // shown on zoom

      this.citizenSprites.push({
        sprite,
        nameLabel,
        key: spriteKey,
        currentTile: [sx, sy],
        targetTile: null,
        speed: 18 + rand() * 14,   // pixels per second (slow wander)
        waitTimer: rand() * 4000,   // stagger initial movement
        login: citizen.login,
      });
    }

    console.log(`Spawned ${this.citizenSprites.length} citizens on ${roadTiles.length} road tiles`);
  }

  private getSpriteForCitizen(index: number, total: number): string {
    if (index === 0) return 'citizen-queen'; // King/ruler → queen sprite

    const ratio = index / total;
    if (ratio < 0.15) {
      // Top contributors → nobles
      return index % 3 === 0 ? 'citizen-noble-m' :
             index % 3 === 1 ? 'citizen-noble-w' : 'citizen-princess';
    } else if (ratio < 0.4) {
      return index % 2 === 0 ? 'citizen-villager-m' : 'citizen-villager-w';
    } else if (ratio < 0.7) {
      return index % 2 === 0 ? 'citizen-peasant' : 'citizen-worker';
    } else {
      return index % 2 === 0 ? 'citizen-old-m' : 'citizen-old-w';
    }
  }

  private updateCitizens(delta: number) {
    for (const c of this.citizenSprites) {
      // Wait timer (idle pause)
      if (c.waitTimer > 0) {
        c.waitTimer -= delta;
        continue;
      }

      // Pick next target tile if needed
      if (!c.targetTile) {
        const [cx, cy] = c.currentTile;
        const neighbors: [number, number][] = [];
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && nx < this.cityW && ny >= 0 && ny < this.cityH &&
              this.cityTerrain[ny][nx] === TILES.ROAD) {
            neighbors.push([nx, ny]);
          }
        }

        if (neighbors.length > 0) {
          c.targetTile = neighbors[Math.floor(Math.random() * neighbors.length)];

          // Set walk animation based on direction
          const dx = c.targetTile[0] - cx;
          const dy = c.targetTile[1] - cy;

          if (dy > 0) {
            c.sprite.play(`${c.key}-walk-down`, true);
            c.sprite.flipX = false;
          } else if (dy < 0) {
            c.sprite.play(`${c.key}-walk-up`, true);
            c.sprite.flipX = false;
          } else if (dx > 0) {
            c.sprite.play(`${c.key}-walk-right`, true);
            c.sprite.flipX = false;
          } else {
            c.sprite.play(`${c.key}-walk-right`, true);
            c.sprite.flipX = true; // mirror for walking left
          }
        } else {
          c.waitTimer = 2000; // stuck, wait
        }
        continue;
      }

      // Move toward target tile
      const targetX = c.targetTile[0] * TILE_SIZE + TILE_SIZE / 2;
      const targetY = c.targetTile[1] * TILE_SIZE + TILE_SIZE / 2;
      const dx = targetX - c.sprite.x;
      const dy = targetY - c.sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 1) {
        // Arrived
        c.sprite.x = targetX;
        c.sprite.y = targetY;
        c.currentTile = c.targetTile;
        c.targetTile = null;

        // Random pause (30% chance)
        if (Math.random() < 0.3) {
          c.waitTimer = 500 + Math.random() * 3000;
          c.sprite.play(`${c.key}-idle`, true);
        }
      } else {
        const step = Math.min(c.speed * delta / 1000, dist);
        c.sprite.x += (dx / dist) * step;
        c.sprite.y += (dy / dist) * step;
      }

      // Update name label position
      c.nameLabel.x = c.sprite.x;
      c.nameLabel.y = c.sprite.y - 18;
    }
  }

  private showCitizenInfo(c: WalkingCitizen) {
    const citizen = this.city.citizens.find(ci => ci.login === c.login);
    if (!citizen) return;

    trackCitizenClicked({
      user_login: citizen.login,
      contributions: citizen.totalContributions,
    });

    // Hide profile panel (they share screen space)
    document.getElementById('profile-panel')!.style.display = 'none';

    const panel = document.getElementById('info-panel')!;
    const isKing = this.city.king?.login === c.login;
    const isUser = this.highlightUser === c.login.toLowerCase();

    // Determine rank and title
    const rank = this.city.citizens.findIndex(ci => ci.login === citizen.login);
    const total = this.city.citizens.length;
    const { icon, title } = citizenTitle(rank, total, isKing, citizen.totalContributions);

    // Show GitHub avatar
    const avatarEl = document.getElementById('info-avatar') as HTMLImageElement;
    avatarEl.src = `https://github.com/${citizen.login}.png?size=128`;
    avatarEl.alt = citizen.login;
    avatarEl.style.display = 'block';
    avatarEl.onerror = () => { avatarEl.style.display = 'none'; };

    document.getElementById('info-name')!.innerHTML =
      (isUser ? '★ ' : '') + icon + ' ' + ghLink(citizen.login);
    document.getElementById('info-tier')!.textContent =
      `${title} of the ${this.city.language} Kingdom`;

    const repoLinks = citizen.repos.map((r: string) =>
      ghLink(r, r.split('/').pop() || r)
    ).join(', ');
    const stats = [
      stat('Contributions', citizen.totalContributions.toLocaleString()),
      `<div class="stat"><span class="stat-label">Repos</span><span class="stat-value">${repoLinks}</span></div>`,
    ];

    document.getElementById('info-stats')!.innerHTML = stats.join('');
    const kingEl = document.getElementById('info-king')!;
    kingEl.innerHTML =
      `<button class="sheet-link" data-login="${esc(citizen.login)}">📜 View Sheet</button>`;
    const sheetBtn = kingEl.querySelector('.sheet-link') as HTMLElement;
    if (sheetBtn) {
      this.trackListener(sheetBtn, 'click', () => {
        this.showCharacterSheet(citizen.login);
      });
    }
    if ((window as any).__resetPanelPos) (window as any).__resetPanelPos(panel);
    panel.style.display = 'block';
  }

  private showBuildingInfo(b: CityBuilding) {
    // Hide profile panel (they share screen space)
    document.getElementById('profile-panel')!.style.display = 'none';

    // Public buildings show a simple info card
    if (b.isPublic || !b.repoMetrics) {
      const panel = document.getElementById('info-panel')!;
      const avatarEl = document.getElementById('info-avatar') as HTMLImageElement;
      avatarEl.style.display = 'none';
      const isFiller = !b.isPublic && !b.repoMetrics;
      document.getElementById('info-name')!.textContent = isFiller
        ? '🏠 Commoner Home'
        : `🏛 ${b.publicName || 'Civic Building'}`;
      document.getElementById('info-tier')!.textContent = isFiller
        ? `Unclaimed plot in the ${this.city.language} Kingdom`
        : `Public building in the ${this.city.language} Kingdom`;
      document.getElementById('info-stats')!.innerHTML = isFiller
        ? stat('Status', 'Available') + stat('Size', `${b.width}×${b.height} tiles`) +
          '<div style="font-size:9px;color:#8a8070;margin-top:6px"><a href="/api/auth/login" class="gh-link">Claim your repos</a> with GitHub to fill this plot! Repos need at least 1 star.</div>'
        : stat('Type', b.publicName || 'Civic') + stat('Size', `${b.width}×${b.height} tiles`);
      document.getElementById('info-king')!.innerHTML = '';
      if ((window as any).__resetPanelPos) (window as any).__resetPanelPos(panel);
      panel.style.display = 'block';
      return;
    }

    const panel = document.getElementById('info-panel')!;
    const repo = b.repoMetrics.repo;
    const isUserRepo = this.isUserBuilding(b);

    trackBuildingClicked({
      repo_full_name: repo.full_name,
      language: this.city.language,
      stars: repo.stargazers_count,
      rank: b.rank,
    });

    // Show repo owner's avatar
    const avatarEl = document.getElementById('info-avatar') as HTMLImageElement;
    const owner = repo.full_name.split('/')[0];
    avatarEl.src = `https://github.com/${owner}.png?size=128`;
    avatarEl.alt = owner;
    avatarEl.style.display = 'block';
    avatarEl.onerror = () => { avatarEl.style.display = 'none'; };

    const rankLabel = b.rank.charAt(0).toUpperCase() + b.rank.slice(1);
    document.getElementById('info-name')!.innerHTML =
      (isUserRepo ? '★ ' : '') + ghLink(repo.full_name);
    document.getElementById('info-tier')!.textContent =
      `${RANK_ICONS[b.rank]} ${rankLabel} in the ${this.city.language} Kingdom`;

    // Find max values for bar scaling across buildings in this city
    const repoBuildings = this.city.buildings.filter(bb => bb.repoMetrics);
    const maxStars = Math.max(...repoBuildings.map(bb => bb.repoMetrics!.repo.stargazers_count), 1);
    const maxForks = Math.max(...repoBuildings.map(bb => bb.repoMetrics!.repo.forks_count), 1);
    const maxIssues = Math.max(...repoBuildings.map(bb => bb.repoMetrics!.repo.open_issues_count), 1);

    const stats = [];
    if (repo.description) stats.push(stat('', esc(repo.description)));
    stats.push('<hr class="golden">');
    stats.push(
      statBar('Stars', repo.stargazers_count, maxStars, 'orange'),
      statBar('Forks', repo.forks_count, maxForks, 'blue'),
      statBar('Issues', repo.open_issues_count, maxIssues, 'red'),
      stat('Contributors', b.repoMetrics.contributors.length.toString()),
      stat('Commits', b.repoMetrics.totalCommits.toLocaleString()),
    );

    if (repo.pushed_at) {
      const pushed = new Date(repo.pushed_at);
      const daysAgo = Math.floor((Date.now() - pushed.getTime()) / (1000 * 60 * 60 * 24));
      const activity = daysAgo < 7 ? '🟢 Active' :
                       daysAgo < 30 ? '🟡 Recent' :
                       daysAgo < 365 ? '🟠 Quiet' : '🔴 Dormant';
      stats.push(stat('Activity', `${activity} (${daysAgo}d ago)`));
    }

    document.getElementById('info-stats')!.innerHTML = stats.join('');

    const kingEl = document.getElementById('info-king')!;
    const mayor = b.repoMetrics.king;
    kingEl.innerHTML = mayor
      ? `🏛 Owner: ${citizenLink(mayor.login)} (${mayor.contributions.toLocaleString()} commits)`
      : '';

    // Wire up citizen links — clicking a user opens their citizen card
    kingEl.querySelectorAll('.citizen-link').forEach((link) => {
      this.trackListener(link as HTMLElement, 'click', (e) => {
        e.preventDefault();
        const login = (link as HTMLElement).dataset.login;
        if (login) this.openCitizenByLogin(login);
      });
    });

    // Remove any previous claim element
    const prevClaim = panel.querySelector('.claim-cta');
    if (prevClaim) prevClaim.remove();

    // Show "Claim this repo" if user is not signed in
    if (!(window as any).__gkUser && !isUserRepo) {
      const claimEl = document.createElement('div');
      claimEl.className = 'claim-cta';
      claimEl.style.cssText = 'margin-top:6px;font-size:8px;text-align:center';
      claimEl.innerHTML = '<a href="/api/auth/login" class="gh-link" style="color:#ffd700">⚔ Claim this repo</a>'
        + '<div style="color:#8a8070;margin-top:2px">Sign in with GitHub to claim repos you own</div>';
      kingEl.after(claimEl);
    }

    if ((window as any).__resetPanelPos) (window as any).__resetPanelPos(panel);
    panel.style.display = 'block';
  }

  /** Open a citizen's character sheet directly by login name */
  private openCitizenByLogin(login: string) {
    this.showCharacterSheet(login);
  }

  private hideInfoPanel() {
    document.getElementById('info-panel')!.style.display = 'none';
    const avatarEl = document.getElementById('info-avatar') as HTMLImageElement;
    if (avatarEl) { avatarEl.style.display = 'none'; avatarEl.src = ''; }
  }

  private async showCharacterSheet(login: string) {
    const panel = document.getElementById('sheet-panel')!;
    const content = document.getElementById('sheet-content')!;

    // Hide other panels
    document.getElementById('info-panel')!.style.display = 'none';
    document.getElementById('profile-panel')!.style.display = 'none';

    // Show loading
    content.innerHTML = '<div style="text-align:center;padding:32px;color:#8a7a58;font-size:12px">Loading character sheet…</div>';
    if ((window as any).__resetPanelPos) (window as any).__resetPanelPos(panel);
    panel.style.display = 'block';

    try {
      const res = await fetch(`/api/citizen?username=${encodeURIComponent(login)}`);
      if (!res.ok) throw new Error('failed');
      const d = await res.json();
      content.innerHTML = buildSheetHTML(d);

      // Wire up share button
      const shareBtn = content.querySelector('.sp-share-btn') as HTMLButtonElement | null;
      if (shareBtn) {
        shareBtn.addEventListener('click', () => {
          const url = shareBtn.getAttribute('data-url') || '';
          navigator.clipboard.writeText(url).then(() => {
            shareBtn.textContent = '✅ Copied!';
            setTimeout(() => { shareBtn.textContent = '📋 Share'; }, 2000);
          }).catch(() => {
            // Fallback: open in new tab
            window.open(url, '_blank');
          });
        });
      }
    } catch {
      content.innerHTML = '<div style="text-align:center;padding:32px;color:#8a7a58;font-size:12px">Failed to load character sheet.</div>';
    }
  }

  private addBackButton() {
    // Now uses the header bar back button — set up city header instead
    this.setupCityHeader();
  }

  private setupCityHeader() {
    const header = document.getElementById('game-header');
    if (!header) return;

    const shared = (window as any).__gitworld;
    const lk = shared?.kingdoms?.find((k: any) => k.language === this.city.language);

    // Count citizens
    let citizenCount = 0;
    if (lk) {
      const allContribs = new Set<string>();
      for (const r of lk.repos) {
        for (const c of r.contributors) {
          allContribs.add(c.login);
        }
      }
      citizenCount = allContribs.size;
    }

    const totalStars = lk ? lk.totalStars : 0;
    const fmt = (n: number) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M'
      : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);

    // Update title for city mode
    const hdrTitle = document.getElementById('hdr-title');
    if (hdrTitle) hdrTitle.textContent = 'City of ' + this.city.language;

    // Fully rebuild left side: Back button + building count + stars
    // Building and Citizen counts are clickable — they open the legend panel
    const leftEl = header.querySelector('.header-left') as HTMLElement;
    if (leftEl) {
      leftEl.innerHTML =
        `<span class="header-stat header-clickable" id="hdr-buildings"><span class="stat-icon">🏰</span> <span>${this.city.buildings.length}</span> Buildings</span>` +
        `<span class="header-stat"><span class="stat-icon">★</span> <span>${fmt(totalStars)}</span></span>`;

      // Prepend back button
      const backBtn = document.createElement('button');
      backBtn.className = 'rpgui-button header-back';
      backBtn.innerHTML = '<p>← Back</p>';
      backBtn.onclick = () => {
        trackCityExited();
        trackPageView('/', 'Git Kingdom | World Map');
        // Hide city panels
        const bp = document.getElementById('buildings-panel');
        const cp = document.getElementById('citizens-panel');
        const bBtn = document.getElementById('buildings-toggle');
        const cBtn = document.getElementById('citizens-toggle');
        if (bp) bp.style.display = 'none';
        if (cp) cp.style.display = 'none';
        if (bBtn) bBtn.style.display = 'none';
        if (cBtn) cBtn.style.display = 'none';
        this.hideInfoPanel();
        this.scene.start('WorldScene', this.returnData);
      };
      leftEl.prepend(backBtn);

      // Click buildings count → open buildings panel
      const buildingsBtn = document.getElementById('hdr-buildings');
      if (buildingsBtn) {
        buildingsBtn.onclick = () => {
          const bp = document.getElementById('buildings-panel');
          const cp = document.getElementById('citizens-panel');
          if (cp) cp.style.display = 'none';
          if (bp) {
            bp.style.display = bp.style.display === 'block' ? 'none' : 'block';
            const searchInput = document.getElementById('buildings-search') as HTMLInputElement;
            if (searchInput) { searchInput.value = ''; searchInput.focus(); searchInput.dispatchEvent(new Event('input')); }
            bp.scrollTop = 0;
          }
        };
      }
    }

    // Fully rebuild right side: search + auth + settings
    const rightEl = header.querySelector('.header-right') as HTMLElement;
    if (rightEl) {
      rightEl.innerHTML =
        `<span class="header-stat header-clickable" id="hdr-citizens-btn"><span class="stat-icon">👥</span> <span>${citizenCount}</span> Citizens</span>` +
        `<span id="hdr-auth"><a href="/api/auth/login" class="hdr-auth-link" id="hdr-signin"><span class="auth-long">Claim your repos</span><span class="auth-short">Claim</span></a></span>`;

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
        nameSpan.title = 'View your repos';
        nameSpan.textContent = gkUser.login;
        authEl.appendChild(avatar);
        authEl.appendChild(document.createTextNode(' '));
        authEl.appendChild(nameSpan);
        authEl.style.cursor = 'pointer';
        this.trackListener(authEl, 'click', () => {
          if ((window as any).__showProfilePanel) (window as any).__showProfilePanel();
        });
      }

      // Click citizens count → open citizens panel
      const citizensBtn = document.getElementById('hdr-citizens-btn');
      if (citizensBtn) {
        citizensBtn.onclick = () => {
          const bp = document.getElementById('buildings-panel');
          const cp = document.getElementById('citizens-panel');
          if (bp) bp.style.display = 'none';
          if (cp) {
            cp.style.display = cp.style.display === 'block' ? 'none' : 'block';
            const searchInput = document.getElementById('citizens-search') as HTMLInputElement;
            if (searchInput) { searchInput.value = ''; searchInput.focus(); searchInput.dispatchEvent(new Event('input')); }
            cp.scrollTop = 0;
          }
        };
      }
    }

    // Hide the old separate back button
    const oldBtn = document.getElementById('back-to-world');
    if (oldBtn) oldBtn.style.display = 'none';

    header.style.display = 'flex';
  }

  private updateControlsHint() {
    const hint = document.getElementById('controls-hint');
    if (hint) {
      hint.textContent = '';  // Header bar now shows this info
    }
  }

  private buildCityLegend(buildings: CityBuilding[]) {
    // Hide the world-map legend toggle (CityScene uses its own buttons)
    const worldToggle = document.getElementById('legend-toggle');
    if (worldToggle) worldToggle.style.display = 'none';

    // ── Buildings Panel ──
    const bPanel = document.getElementById('buildings-panel')!;
    const repoBuildings = buildings.filter(b => !b.isPublic && b.repoMetrics);
    const publicBuildings = buildings.filter(b => b.isPublic);
    const repoCount = buildings.filter(b => b.repoMetrics).length;

    let bHtml = '<div style="margin-bottom:8px">' +
      '<input type="text" id="buildings-search" placeholder="Search buildings..." />' +
      '</div>';
    bHtml += `<h3>${this.city.language} — ${repoCount} Repos · ${buildings.length} Buildings</h3>`;

    const ranks: string[] = ['citadel', 'castle', 'palace', 'keep', 'manor', 'guild', 'cottage', 'hovel', 'camp'];
    for (const rank of ranks) {
      const rankBuildings = repoBuildings.filter(b => b.rank === rank);
      if (rankBuildings.length === 0) continue;

      const icon = RANK_ICONS[rank] || '';
      bHtml += `<div style="color:#7a5a30;font-size:9px;margin-top:6px;border-top:1px solid #a07848;padding-top:4px">${icon} ${rank.toUpperCase()} (${rankBuildings.length})</div>`;

      for (const b of rankBuildings) {
        const isUser = this.isUserBuilding(b);
        const starMarker = isUser ? '★ ' : '';
        const nameStyle = isUser ? 'color:#ffd700' : '';
        const stars = b.repoMetrics!.repo.stargazers_count;
        const starsStr = stars >= 1000 ? Math.round(stars / 1000) + 'k★' : stars + '★';

        bHtml += `<div class="legend-item legend-settlement" data-bx="${b.x}" data-by="${b.y}" ` +
          `data-repo="${esc(b.repoMetrics!.repo.name.toLowerCase())}" style="font-size:9px">` +
          `<span class="legend-name" style="padding-left:4px;${nameStyle}">${starMarker}${esc(b.repoMetrics!.repo.name)}</span>` +
          `<span class="legend-tier">${starsStr}</span>` +
          `</div>`;
      }
    }

    if (publicBuildings.length > 0) {
      bHtml += `<div style="color:#7a5a30;font-size:9px;margin-top:6px;border-top:1px solid #a07848;padding-top:4px">🏛 CIVIC (${publicBuildings.length})</div>`;
      for (const b of publicBuildings) {
        bHtml += `<div class="legend-item legend-settlement" data-bx="${b.x}" data-by="${b.y}" ` +
          `data-repo="${esc((b.publicName || 'civic').toLowerCase())}" style="font-size:9px">` +
          `<span class="legend-name" style="padding-left:4px;color:#8a8a6a">🏛 ${esc(b.publicName || 'Civic')}</span>` +
          `<span class="legend-tier">${b.width}×${b.height}</span>` +
          `</div>`;
      }
    }

    bPanel.innerHTML = '<button class="rpgui-button city-panel-close" title="Close"><p>✕</p></button>' + bHtml;
    bPanel.style.display = 'none';

    // Wire buildings close button
    const bClose = bPanel.querySelector('.city-panel-close');
    if (bClose) {
      this.trackListener(bClose as HTMLElement, 'click', (e) => {
        e.stopPropagation();
        bPanel.style.display = 'none';
      });
    }

    // Buildings search
    const bSearch = document.getElementById('buildings-search') as HTMLInputElement;
    if (bSearch) {
      this.trackListener(bSearch, 'input', () => {
        const query = bSearch.value.toLowerCase().trim();
        const items = bPanel.querySelectorAll('.legend-settlement') as NodeListOf<HTMLElement>;
        items.forEach(el => {
          if (!query) { el.style.display = ''; return; }
          const name = el.dataset.repo || '';
          el.style.display = name.includes(query) ? '' : 'none';
        });
      });

      this.trackListener(bSearch, 'keydown', ((e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Enter') {
          const query = bSearch.value.toLowerCase().trim();
          if (!query) return;
          const match = buildings.find(b =>
            b.repoMetrics?.repo.name.toLowerCase().includes(query) ||
            b.publicName?.toLowerCase().includes(query)
          );
          if (match) {
            this.cameras.main.pan(
              (match.x + match.width / 2) * TILE_SIZE,
              (match.y + match.height / 2) * TILE_SIZE,
              500, 'Power2'
            );
            cityZoomIndex = CITY_ZOOM_LEVELS.indexOf(3);
            this.cameras.main.zoomTo(3, 500);
            this.showBuildingInfo(match);
          }
        }
      }));
    }

    // Buildings click handler
    this.trackListener(bPanel, 'click', (e) => {
      const item = (e.target as HTMLElement).closest('.legend-settlement') as HTMLElement;
      if (!item) return;
      const bx = parseInt(item.dataset.bx!, 10);
      const by = parseInt(item.dataset.by!, 10);
      const b = buildings.find(b => b.x === bx && b.y === by);
      if (b) {
        const bx = (b.x + b.width / 2) * TILE_SIZE;
        const by = (b.y + b.height / 2) * TILE_SIZE;
        this.cameras.main.pan(bx, by, 500, 'Power2');
        this.cameras.main.zoomTo(3, 500);
        this.showBuildingInfo(b);
        // Show bouncing arrow after camera finishes panning
        this.time.delayedCall(550, () => {
          this.showPointerArrow(bx, b.y * TILE_SIZE - 12);
        });
      }
    });

    // ── Citizens Panel ──
    const cPanel = document.getElementById('citizens-panel')!;
    const allCitizens = this.city.citizens;
    const totalCitizens = allCitizens.length;

    let cHtml = '<div style="margin-bottom:8px">' +
      '<input type="text" id="citizens-search" placeholder="Search citizens..." />' +
      '</div>';
    cHtml += `<h3>👥 ${totalCitizens} Citizens</h3>`;

    for (let i = 0; i < allCitizens.length; i++) {
      const c = allCitizens[i];
      const isKing = this.city.king?.login === c.login;
      const isUser = this.highlightUser === c.login.toLowerCase();
      const { icon, title } = citizenTitle(i, totalCitizens, isKing, c.totalContributions);
      const style = isUser ? 'color:#ffd700' : '';
      cHtml += `<div class="legend-item legend-citizen" data-login="${esc(c.login)}" style="font-size:9px">` +
        `<span class="legend-name" style="padding-left:4px;${style}">${isUser ? '★ ' : ''}${icon} ${esc(c.login)}</span>` +
        `<span class="legend-tier">${title} · ${c.totalContributions.toLocaleString()}</span>` +
        `</div>`;
    }

    cPanel.innerHTML = '<button class="rpgui-button city-panel-close" title="Close"><p>✕</p></button>' + cHtml;
    cPanel.style.display = 'none';

    // Wire citizens close button
    const cClose = cPanel.querySelector('.city-panel-close');
    if (cClose) {
      this.trackListener(cClose as HTMLElement, 'click', (e) => {
        e.stopPropagation();
        cPanel.style.display = 'none';
      });
    }

    // Wire citizen clicks → open citizen info card
    cPanel.querySelectorAll('.legend-citizen').forEach((el) => {
      this.trackListener(el as HTMLElement, 'click', (e) => {
        e.stopPropagation();
        const login = (el as HTMLElement).dataset.login;
        if (login) this.showCharacterSheet(login);
      });
    });

    // Citizens search
    const cSearch = document.getElementById('citizens-search') as HTMLInputElement;
    if (cSearch) {
      this.trackListener(cSearch, 'input', () => {
        const query = cSearch.value.toLowerCase().trim();
        const items = cPanel.querySelectorAll('.legend-citizen') as NodeListOf<HTMLElement>;
        items.forEach(el => {
          if (!query) { el.style.display = ''; return; }
          const login = el.dataset.login || '';
          el.style.display = login.toLowerCase().includes(query) ? '' : 'none';
        });
      });

      this.trackListener(cSearch, 'keydown', ((e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Enter') {
          const query = cSearch.value.toLowerCase().trim();
          if (!query) return;
          const citizenMatch = this.city.citizens.find(c =>
            c.login.toLowerCase().includes(query)
          );
          if (citizenMatch) {
            this.openCitizenByLogin(citizenMatch.login);
          }
        }
      }));
    }

    // Show both toggle buttons
    const buildingsBtn = document.getElementById('buildings-toggle');
    const citizensBtn = document.getElementById('citizens-toggle');
    if (buildingsBtn) buildingsBtn.style.display = 'block';
    if (citizensBtn) citizensBtn.style.display = 'block';
  }
}

/**
 * Medieval title hierarchy based on contribution count.
 * All titles are gender-neutral since we don't know developers' identities.
 * Each tier has many name variants — the citizen's rank index selects
 * which variant they get, so adjacent citizens rarely share a title.
 *
 *  Tier         Commits   Titles
 *  ─────────────────────────────────────────────────
 *  Royalty      (ruler)   Sovereign, Monarch
 *  High Noble   5000+     Archduke, Regent, High Chancellor, Sovereign, Grand Protector, Viceroy
 *  Noble        3000+     Marquess, Palatine, Viceroy, Warden, Grand Steward, Emissary
 *  Upper Lord   1500+     Earl, Viscount, Jarl, Overlord, Warden, Castellan, Protector
 *  Lower Lord   750+      Thane, Castellan, Liege, Banneret, Steward, Keeper, Seneschal
 *  Knight       300+      Knight, Paladin, Templar, Sentinel, Champion, Crusader, Defender, Guardian
 *  Gentry       100+      Squire, Esquire, Herald, Reeve, Magistrate, Bailiff, Alderman, Yeoman
 *  Artisan      25+       Artisan, Scribe, Mason, Smith, Alchemist, Herbalist, Tinkerer, Sage
 *  Commoner     0+        Peasant, Villager, Commoner, Serf, Wanderer, Pilgrim, Drifter, Vagabond
 */
const TITLE_TIERS: { min: number; icon: string; names: string[] }[] = [
  { min: 0,    icon: '👑', names: ['Sovereign', 'Monarch'] },  // only isKing gets this
  { min: 5000, icon: '🏰', names: ['Archduke', 'Regent', 'High Chancellor', 'Sovereign', 'Grand Protector', 'Viceroy'] },
  { min: 3000, icon: '🏰', names: ['Marquess', 'Palatine', 'Viceroy', 'Warden', 'Grand Steward', 'Emissary'] },
  { min: 1500, icon: '⚜',  names: ['Earl', 'Viscount', 'Jarl', 'Overlord', 'Warden', 'Castellan', 'Protector'] },
  { min: 750,  icon: '🛡',  names: ['Thane', 'Castellan', 'Liege', 'Banneret', 'Steward', 'Keeper', 'Seneschal'] },
  { min: 300,  icon: '⚔',  names: ['Knight', 'Paladin', 'Templar', 'Sentinel', 'Champion', 'Crusader', 'Defender', 'Guardian'] },
  { min: 100,  icon: '🗡',  names: ['Squire', 'Esquire', 'Herald', 'Reeve', 'Magistrate', 'Bailiff', 'Alderman', 'Yeoman'] },
  { min: 25,   icon: '🔨',  names: ['Artisan', 'Scribe', 'Mason', 'Smith', 'Alchemist', 'Herbalist', 'Tinkerer', 'Sage'] },
  { min: 0,    icon: '🧑',  names: ['Peasant', 'Villager', 'Commoner', 'Serf', 'Wanderer', 'Pilgrim', 'Drifter', 'Vagabond'] },
];

function citizenTitle(rank: number, _total: number, isKing: boolean, contributions: number): { icon: string; title: string } {
  if (isKing) {
    // Top contributor alternates King / Queen using a simple hash of rank
    return { icon: '👑', title: TITLE_TIERS[0].names[rank % 2] };
  }
  // Skip tier 0 (royalty), match by contribution threshold
  for (let i = 1; i < TITLE_TIERS.length; i++) {
    const tier = TITLE_TIERS[i];
    if (contributions >= tier.min) {
      const name = tier.names[rank % tier.names.length];
      return { icon: tier.icon, title: name };
    }
  }
  return { icon: '🧑', title: 'Peasant' };
}

/** Escape HTML special characters to prevent XSS */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Build a safe GitHub link */
function ghLink(fullName: string, label?: string): string {
  return `<a class="gh-link" href="https://github.com/${encodeURI(fullName)}" target="_blank" rel="noopener">${esc(label || fullName)}</a>`;
}

/** Build a safe citizen link (click handler wired separately) */
function citizenLink(login: string, label?: string): string {
  return `<a class="gh-link citizen-link" href="#" data-login="${esc(login)}">${esc(label || login)}</a>`;
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

// ─── Badge tooltip descriptions ──────────────────────────────────
const BADGE_TIPS: Record<string, string> = {
  titan: '1,000+ total contributions',
  centurion: '100+ total contributions',
  crown: 'Top contributor to at least one repo',
  founder: 'Owns a repo in the kingdom',
  on_fire: 'Contributed to a repo pushed in the last 3 days',
  polyglot: 'Contributes across 3+ languages',
  star_bearer: '1,000+ total stars across repos',
  team_player: 'Contributes to 5+ repos',
  lone_wolf: 'Contributes to exactly 1 repo',
};

function repoIcon(stars: number): string {
  if (stars >= 10000) return '🗡';
  if (stars >= 1000) return '🛡';
  if (stars >= 100) return '⚔';
  if (stars >= 10) return '📜';
  return '⚗';
}

function fmtNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildSheetHTML(d: any): string {
  let h = '';

  // Header
  h += `<div class="sp-header">`;
  h += `<img class="sp-avatar" src="https://github.com/${esc(d.login)}.png?size=128" alt="" onerror="this.style.display='none'" />`;
  h += `<div class="sp-identity">`;
  h += `<div class="sp-login">${esc(d.title.icon)} ${esc(d.login)}</div>`;
  h += `<div class="sp-title">${esc(d.title.name)} of ${esc(d.title.kingdom)}</div>`;
  h += `<div class="sp-level">Level ${d.level} · ${fmtNum(d.xp)} XP · ${d.totalContributions.toLocaleString()} contributions</div>`;
  h += `</div></div>`;

  // Badges
  if (d.badges && d.badges.length > 0) {
    h += `<div class="sp-section"><div class="sp-section-title">Badges</div><div class="sp-badges">`;
    for (const b of d.badges) {
      const tip = BADGE_TIPS[b.id] || '';
      h += `<span class="sp-badge" data-tip="${esc(tip)}"><span class="sp-badge-icon">${esc(b.icon)}</span>${esc(b.label)}</span>`;
    }
    h += `</div></div>`;
  }

  // Stats
  h += `<div class="sp-section"><div class="sp-section-title">Stats</div>`;
  const stats = [
    { key: 'power', label: '⚔ Power', val: d.stats.power },
    { key: 'reach', label: '⭐ Reach', val: d.stats.reach },
    { key: 'versatility', label: '🌐 Versatility', val: d.stats.versatility },
  ];
  for (const s of stats) {
    const pct = Math.round((s.val / 20) * 100);
    h += `<div class="sp-stat-row">`;
    h += `<span class="sp-stat-label">${s.label}</span>`;
    h += `<div class="sp-stat-bar"><div class="sp-stat-fill ${s.key}" style="width:${pct}%"></div></div>`;
    h += `<span class="sp-stat-val">${s.val}</span>`;
    h += `</div>`;
  }
  h += `</div>`;

  // Kingdoms
  if (d.languages && d.languages.length > 0) {
    h += `<div class="sp-section"><div class="sp-section-title">Kingdoms</div><div class="sp-kingdoms">`;
    for (const lang of d.languages) {
      h += `<span class="sp-kingdom">${esc(lang)}</span>`;
    }
    h += `</div></div>`;
  }

  // Repos (max 5 inline)
  if (d.repos && d.repos.length > 0) {
    const shown = d.repos.slice(0, 5);
    h += `<div class="sp-section"><div class="sp-section-title">Inventory (${d.repos.length})</div>`;
    for (const r of shown) {
      h += `<div class="sp-repo">`;
      h += `<span class="sp-repo-icon">${repoIcon(r.stargazers)}</span>`;
      h += `<span class="sp-repo-name"><a href="https://github.com/${esc(r.full_name)}" target="_blank">${esc(r.full_name)}</a></span>`;
      h += `<span class="sp-repo-meta">`;
      if (r.is_king) h += `<span style="color:#ffd700">👑</span>`;
      h += `<span class="sp-repo-stars">★${fmtNum(r.stargazers)}</span>`;
      if (r.language) h += `<span>${esc(r.language)}</span>`;
      h += `</span></div>`;
    }
    if (d.repos.length > 5) {
      h += `<div style="text-align:center;margin-top:6px"><a href="/citizen/${esc(d.login)}" target="_blank" style="color:#b0a070;font-size:11px">View all ${d.repos.length} repos →</a></div>`;
    }
    h += `</div>`;
  }

  // Actions
  const shareUrl = `${window.location.origin}/citizen/${encodeURIComponent(d.login)}`;
  h += `<div class="sp-actions">`;
  h += `<a href="https://github.com/${esc(d.login)}" target="_blank" class="sp-btn">GitHub</a>`;
  h += `<button class="sp-btn sp-share-btn" data-url="${esc(shareUrl)}">📋 Share</button>`;
  h += `<a href="/citizen/${esc(d.login)}" target="_blank" class="sp-btn">Full Sheet</a>`;
  h += `</div>`;

  return h;
}
