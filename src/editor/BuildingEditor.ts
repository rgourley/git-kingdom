import {
  TileRef, BuildingTemplate, TemplateLibrary, SheetDef, SHEET_DEFS,
  LayerName, LAYER_ORDER, TemplateLayers,
  emptyLayers, emptyLayerGrid, migrateTemplate,
} from './types';
import { swapRoofColor, detectRoofColor, mirrorHorizontal, footprintToRank } from './VariationEngine';

// ─── Constants ──────────────────────────────────────────────────
const T = 16;             // native tile size
const SCALE = 2;          // editor zoom (2× for palette + grid)
const ST = T * SCALE;     // scaled tile size (32px)
const GRID_LINE = '#3a3a5c';
const GRID_LINE_HOVER = '#f0c060';
const SELECT_BORDER = '#f0c060';
const MAX_UNDO = 50;

const LAYER_COLORS: Record<LayerName, string> = {
  base:   '#4a6741',
  main:   '#6a6a8a',
  detail: '#8a6a4a',
};

// ─── Image Loader ───────────────────────────────────────────────
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
    img.src = src;
  });
}

// ─── Deep clone layers ──────────────────────────────────────────
function cloneLayers(layers: TemplateLayers): TemplateLayers {
  return {
    base:   layers.base.map(row => row.map(c => c ? { ...c } : null)),
    main:   layers.main.map(row => row.map(c => c ? { ...c } : null)),
    detail: layers.detail.map(row => row.map(c => c ? { ...c } : null)),
  };
}

// ─── Editor Class ───────────────────────────────────────────────
class BuildingEditor {
  // Sheet images
  private sheets = new Map<string, HTMLImageElement>();
  private activeSheetKey = SHEET_DEFS[0].key;
  private activeCategoryIdx = -1;

  // Grid state — multi-layer
  private gridW = 3;
  private gridH = 5;
  private layers!: TemplateLayers;
  private activeLayer: LayerName = 'main';

  // Selection
  private selectedTile: TileRef | null = null;

  // Hover state
  private hoveredGrid: [number, number] | null = null;
  private hoveredPalette: number = -1;

  // Drag painting
  private isDragging = false;
  private dragButton = 0; // 0 = left (paint), 2 = right (erase)
  private lastDragCell: [number, number] | null = null;

  // Undo / Redo
  private undoStack: { layers: TemplateLayers; w: number; h: number }[] = [];
  private redoStack: { layers: TemplateLayers; w: number; h: number }[] = [];

  // Palette scroll
  private paletteScrollY = 0;

  // Library
  private library: BuildingTemplate[] = [];
  // Tracks the ID of the template currently being edited (for overwrite on save)
  private editingTemplateId: string | null = null;

  // DOM refs
  private paletteCanvas!: HTMLCanvasElement;
  private paletteCtx!: CanvasRenderingContext2D;
  private gridCanvas!: HTMLCanvasElement;
  private gridCtx!: CanvasRenderingContext2D;
  private previewCanvas!: HTMLCanvasElement;
  private previewCtx!: CanvasRenderingContext2D;
  private varCanvases: HTMLCanvasElement[] = [];
  private statusText!: HTMLElement;
  private paletteTooltip!: HTMLElement;

  constructor() {
    this.layers = emptyLayers(this.gridW, this.gridH);
    this.init();
  }

  // ─── Convenience ──────────────────────────────────────────────

  private get grid(): (TileRef | null)[][] {
    return this.layers[this.activeLayer];
  }

  // ─── Init ─────────────────────────────────────────────────────

  private async init() {
    this.status('Loading sprites…');

    await Promise.all(
      SHEET_DEFS.map(async (def) => {
        try {
          const img = await loadImg(def.src);
          this.sheets.set(def.key, img);
        } catch (e) {
          console.warn(`Could not load sheet: ${def.src}`, e);
        }
      }),
    );

    this.paletteCanvas = document.getElementById('palette-canvas') as HTMLCanvasElement;
    this.paletteCtx = this.paletteCanvas.getContext('2d')!;
    this.gridCanvas = document.getElementById('grid-canvas') as HTMLCanvasElement;
    this.gridCtx = this.gridCanvas.getContext('2d')!;
    this.previewCanvas = document.getElementById('preview-canvas') as HTMLCanvasElement;
    this.previewCtx = this.previewCanvas.getContext('2d')!;
    this.varCanvases = Array.from(document.querySelectorAll('.var-canvas'));
    this.statusText = document.getElementById('status-text')!;
    this.paletteTooltip = document.getElementById('palette-tooltip')!;

    [this.paletteCtx, this.gridCtx, this.previewCtx].forEach(ctx => {
      ctx.imageSmoothingEnabled = false;
    });

    this.buildSheetTabs();
    this.buildCategoryTabs();
    this.buildLayerTabs();
    this.wireEvents();
    this.resizeGridCanvas();
    this.renderAll();
    this.status('Ready — pick a tile, paint on the grid. Ctrl+Z undo, Alt+click eyedropper');
  }

  // ─── Undo / Redo ──────────────────────────────────────────────

  private pushUndo() {
    this.undoStack.push({ layers: cloneLayers(this.layers), w: this.gridW, h: this.gridH });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = []; // new action clears redo
  }

  private undo() {
    const state = this.undoStack.pop();
    if (!state) { this.status('Nothing to undo'); return; }
    this.redoStack.push({ layers: cloneLayers(this.layers), w: this.gridW, h: this.gridH });
    this.gridW = state.w;
    this.gridH = state.h;
    this.layers = state.layers;
    this.resizeGridCanvas();
    this.renderAll();
    this.status('Undo');
  }

  private redo() {
    const state = this.redoStack.pop();
    if (!state) { this.status('Nothing to redo'); return; }
    this.undoStack.push({ layers: cloneLayers(this.layers), w: this.gridW, h: this.gridH });
    this.gridW = state.w;
    this.gridH = state.h;
    this.layers = state.layers;
    this.resizeGridCanvas();
    this.renderAll();
    this.status('Redo');
  }

  // ─── Layer Management ─────────────────────────────────────────

  private buildLayerTabs() {
    const container = document.getElementById('layer-tabs')!;
    container.innerHTML = '';
    const labels: Record<LayerName, string> = {
      base: '⬇ Base',
      main: '🏠 Main',
      detail: '⬆ Detail',
    };
    const hints: Record<LayerName, string> = {
      base: '1',
      main: '2',
      detail: '3',
    };
    for (const layer of LAYER_ORDER) {
      const tab = document.createElement('div');
      tab.className = 'layer-tab' + (layer === this.activeLayer ? ' active' : '');
      tab.dataset.layer = layer;
      tab.innerHTML = `<span class="layer-dot" style="background:${LAYER_COLORS[layer]}"></span>${labels[layer]} <span class="key-hint">${hints[layer]}</span>`;
      tab.addEventListener('click', () => {
        this.activeLayer = layer;
        this.buildLayerTabs();
        this.renderGrid();
        this.status(`Layer: ${layer}`);
      });
      container.appendChild(tab);
    }
  }

  private resizeLayers(newW: number, newH: number) {
    this.pushUndo();
    const old = this.layers;
    this.gridW = newW;
    this.gridH = newH;
    this.layers = emptyLayers(newW, newH);
    for (const layerName of LAYER_ORDER) {
      const oldGrid = old[layerName];
      const newGrid = this.layers[layerName];
      for (let r = 0; r < Math.min(newH, oldGrid.length); r++) {
        for (let c = 0; c < Math.min(newW, oldGrid[r].length); c++) {
          newGrid[r][c] = oldGrid[r][c];
        }
      }
    }
    this.resizeGridCanvas();
    this.renderAll();
  }

  private clearAllLayers() {
    this.pushUndo();
    this.editingTemplateId = null; // Starting fresh — no longer editing an existing template
    this.layers = emptyLayers(this.gridW, this.gridH);
    this.renderAll();
  }

  // ─── Sheet / Category Tabs ────────────────────────────────────

  private buildSheetTabs() {
    const container = document.getElementById('sheet-tabs')!;
    container.innerHTML = '';
    for (const def of SHEET_DEFS) {
      const tab = document.createElement('div');
      tab.className = 'sheet-tab' + (def.key === this.activeSheetKey ? ' active' : '');
      tab.textContent = def.label;
      tab.addEventListener('click', () => {
        this.activeSheetKey = def.key;
        this.activeCategoryIdx = -1;
        this.paletteScrollY = 0;
        this.buildSheetTabs();
        this.buildCategoryTabs();
        this.renderPalette();
      });
      container.appendChild(tab);
    }
  }

  private buildCategoryTabs() {
    const container = document.getElementById('category-tabs')!;
    container.innerHTML = '';
    const def = this.getActiveSheet();
    if (!def.categories || def.categories.length === 0) return;

    const allTab = document.createElement('div');
    allTab.className = 'cat-tab' + (this.activeCategoryIdx === -1 ? ' active' : '');
    allTab.textContent = 'All';
    allTab.addEventListener('click', () => {
      this.activeCategoryIdx = -1;
      this.paletteScrollY = 0;
      this.buildCategoryTabs();
      this.renderPalette();
    });
    container.appendChild(allTab);

    for (let i = 0; i < def.categories.length; i++) {
      const cat = def.categories[i];
      const tab = document.createElement('div');
      tab.className = 'cat-tab' + (this.activeCategoryIdx === i ? ' active' : '');
      tab.textContent = cat.name;
      tab.addEventListener('click', () => {
        this.activeCategoryIdx = i;
        this.paletteScrollY = 0;
        this.buildCategoryTabs();
        this.renderPalette();
      });
      container.appendChild(tab);
    }
  }

  private getActiveSheet(): SheetDef {
    return SHEET_DEFS.find(s => s.key === this.activeSheetKey) || SHEET_DEFS[0];
  }

  // ─── Event Wiring ─────────────────────────────────────────────

  private wireEvents() {
    // Palette events
    this.paletteCanvas.addEventListener('click', (e) => this.onPaletteClick(e));
    this.paletteCanvas.addEventListener('mousemove', (e) => this.onPaletteMove(e));
    this.paletteCanvas.addEventListener('mouseleave', () => {
      this.hoveredPalette = -1;
      this.paletteTooltip.style.display = 'none';
      this.renderPalette();
    });
    this.paletteCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.paletteScrollY += e.deltaY > 0 ? 3 : -3;
      this.paletteScrollY = Math.max(0, this.paletteScrollY);
      this.renderPalette();
    });

    // Grid events — drag painting
    this.gridCanvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      // Alt+click = eyedropper
      if (e.altKey) {
        this.eyedropper(e);
        return;
      }
      this.pushUndo();
      this.isDragging = true;
      this.dragButton = e.button;
      this.lastDragCell = null;
      this.paintOrErase(e);
    });
    this.gridCanvas.addEventListener('mousemove', (e) => {
      this.onGridMove(e);
      if (this.isDragging) {
        this.paintOrErase(e);
      }
    });
    this.gridCanvas.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.lastDragCell = null;
    });
    this.gridCanvas.addEventListener('mouseleave', () => {
      this.isDragging = false;
      this.lastDragCell = null;
      this.hoveredGrid = null;
      this.renderGrid();
    });
    this.gridCanvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.onKeyDown(e));

    // Controls
    document.getElementById('btn-resize')!.addEventListener('click', () => {
      const w = parseInt((document.getElementById('grid-w') as HTMLInputElement).value) || 3;
      const h = parseInt((document.getElementById('grid-h') as HTMLInputElement).value) || 5;
      this.resizeLayers(Math.max(1, Math.min(20, w)), Math.max(1, Math.min(20, h)));
      this.status(`Grid resized to ${this.gridW}×${this.gridH}`);
    });

    document.getElementById('btn-clear')!.addEventListener('click', () => {
      this.clearAllLayers();
      this.status('All layers cleared');
    });

    document.getElementById('btn-new')!.addEventListener('click', () => {
      (document.getElementById('tmpl-name') as HTMLInputElement).value = 'building-' + Date.now().toString(36);
      this.clearAllLayers();
      this.status('New template');
    });

    document.getElementById('btn-mirror')!.addEventListener('click', () => this.mirrorBuilding());

    document.getElementById('btn-save')!.addEventListener('click', () => this.saveTemplate());
    document.getElementById('btn-save-as')!.addEventListener('click', () => this.saveTemplateAs());
    document.getElementById('btn-load')!.addEventListener('click', () => {
      document.getElementById('file-input')!.click();
    });
    document.getElementById('file-input')!.addEventListener('change', (e) => this.loadTemplateFile(e));

    document.getElementById('btn-export-lib')!.addEventListener('click', () => this.exportLibrary());
    document.getElementById('btn-import-lib')!.addEventListener('click', () => {
      document.getElementById('lib-file-input')!.click();
    });
    document.getElementById('lib-file-input')!.addEventListener('change', (e) => this.importLibraryFile(e));

    document.getElementById('btn-lib-load')!.addEventListener('click', () => this.loadFromLibrary());
    document.getElementById('btn-lib-delete')!.addEventListener('click', () => this.deleteFromLibrary());

    // Size presets
    document.querySelectorAll('.size-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const w = parseInt((btn as HTMLElement).dataset.w || '3');
        const h = parseInt((btn as HTMLElement).dataset.h || '3');
        (document.getElementById('grid-w') as HTMLInputElement).value = String(w);
        (document.getElementById('grid-h') as HTMLInputElement).value = String(h);
        this.resizeLayers(w, h);
        this.status(`Preset: ${w}×${h}`);
      });
    });

    this.fetchLibrary();
  }

  // ─── Keyboard Shortcuts ───────────────────────────────────────

  private onKeyDown(e: KeyboardEvent) {
    // Ctrl+S / Ctrl+Shift+S always work, even in inputs
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      // handled below — don't return early
    } else if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') {
      return;
    }

    // Ctrl+Z = undo, Ctrl+Shift+Z = redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
      e.preventDefault();
      this.redo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }

    // Ctrl+S = save, Ctrl+Shift+S = save as
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && !e.shiftKey) {
      e.preventDefault();
      this.saveTemplate();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && e.shiftKey) {
      e.preventDefault();
      this.saveTemplateAs();
      return;
    }

    // 1/2/3 = switch layer
    if (e.key === '1') { this.activeLayer = 'base';   this.buildLayerTabs(); this.renderGrid(); this.status('Layer: base'); }
    if (e.key === '2') { this.activeLayer = 'main';   this.buildLayerTabs(); this.renderGrid(); this.status('Layer: main'); }
    if (e.key === '3') { this.activeLayer = 'detail'; this.buildLayerTabs(); this.renderGrid(); this.status('Layer: detail'); }

    // M = mirror
    if (e.key === 'm' || e.key === 'M') { this.mirrorBuilding(); }
  }

  // ─── Eyedropper (Alt+click) ───────────────────────────────────

  private eyedropper(e: MouseEvent) {
    const [c, r] = this.getGridCell(e);
    if (r < 0 || r >= this.gridH || c < 0 || c >= this.gridW) return;

    // Search layers top-to-bottom for the first non-null tile at this cell
    for (let i = LAYER_ORDER.length - 1; i >= 0; i--) {
      const layerName = LAYER_ORDER[i];
      const ref = this.layers[layerName][r]?.[c];
      if (ref) {
        this.selectedTile = { ...ref };
        this.activeLayer = layerName;
        this.buildLayerTabs();
        // Try to switch palette to show this tile's sheet
        const def = SHEET_DEFS.find(s => s.key === ref.sheet);
        if (def && def.key !== this.activeSheetKey) {
          this.activeSheetKey = def.key;
          this.activeCategoryIdx = -1;
          this.paletteScrollY = 0;
          this.buildSheetTabs();
          this.buildCategoryTabs();
        }
        this.renderAll();
        this.status(`Eyedropper: picked ${ref.sheet} frame ${ref.frame} from ${layerName} layer`);
        return;
      }
    }
    this.status('Eyedropper: empty cell');
  }

  // ─── Drag Paint / Erase ───────────────────────────────────────

  private paintOrErase(e: MouseEvent) {
    const [c, r] = this.getGridCell(e);
    if (r < 0 || r >= this.gridH || c < 0 || c >= this.gridW) return;

    // Skip if same cell as last drag event (avoid redundant paints)
    if (this.lastDragCell && this.lastDragCell[0] === c && this.lastDragCell[1] === r) return;
    this.lastDragCell = [c, r];

    if (this.dragButton === 2) {
      // Right-click drag = erase
      this.layers[this.activeLayer][r][c] = null;
    } else {
      // Left-click drag = paint
      if (!this.selectedTile) {
        this.status('Select a tile from the palette first');
        return;
      }
      this.layers[this.activeLayer][r][c] = { ...this.selectedTile };
    }
    this.renderAll();
  }

  // ─── Mirror ───────────────────────────────────────────────────

  private mirrorBuilding() {
    this.pushUndo();
    const tmpl = this.buildTemplate();
    const mirrored = mirrorHorizontal(tmpl);
    this.layers = {
      base:   mirrored.layers.base.map(row => row.map(c => c ? { ...c } : null)),
      main:   mirrored.layers.main.map(row => row.map(c => c ? { ...c } : null)),
      detail: mirrored.layers.detail.map(row => row.map(c => c ? { ...c } : null)),
    };
    this.renderAll();
    this.status('Mirrored horizontally');
  }

  // ─── Palette Rendering ────────────────────────────────────────

  private getPaletteFrames(): number[] {
    const def = this.getActiveSheet();
    const totalFrames = def.cols * def.rows;

    if (this.activeCategoryIdx >= 0 && def.categories) {
      const cat = def.categories[this.activeCategoryIdx];
      const frames: number[] = [];
      for (let f = cat.startFrame; f <= Math.min(cat.endFrame, totalFrames - 1); f++) {
        frames.push(f);
      }
      return frames;
    }

    const frames: number[] = [];
    for (let f = 0; f < totalFrames; f++) frames.push(f);
    return frames;
  }

  private renderPalette() {
    const def = this.getActiveSheet();
    const img = this.sheets.get(def.key);
    const frames = this.getPaletteFrames();
    const paletteCols = Math.floor(this.paletteCanvas.width / ST);
    const paletteRows = Math.ceil(frames.length / paletteCols);

    const visibleRows = Math.ceil(this.paletteCanvas.parentElement!.clientHeight / ST);
    this.paletteCanvas.height = Math.max(visibleRows, paletteRows) * ST;

    const ctx = this.paletteCtx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.paletteCanvas.width, this.paletteCanvas.height);

    if (!img) return;

    const startRow = Math.max(0, this.paletteScrollY);
    const endRow = Math.min(paletteRows, startRow + visibleRows + 1);

    for (let i = startRow * paletteCols; i < Math.min(frames.length, endRow * paletteCols); i++) {
      const frame = frames[i];
      const px = (i % paletteCols) * ST;
      const py = (Math.floor(i / paletteCols) - this.paletteScrollY) * ST;

      if (py + ST < 0 || py > this.paletteCanvas.height) continue;

      const srcCol = frame % def.cols;
      const srcRow = Math.floor(frame / def.cols);

      ctx.drawImage(img, srcCol * T, srcRow * T, T, T, px, py, ST, ST);

      ctx.strokeStyle = '#2a2a4a';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(px, py, ST, ST);

      if (this.selectedTile && this.selectedTile.sheet === def.key && this.selectedTile.frame === frame) {
        ctx.strokeStyle = SELECT_BORDER;
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, ST - 2, ST - 2);
      }

      if (this.hoveredPalette === i) {
        ctx.fillStyle = 'rgba(240, 192, 96, 0.2)';
        ctx.fillRect(px, py, ST, ST);
      }
    }
  }

  private onPaletteClick(e: MouseEvent) {
    const rect = this.paletteCanvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (this.paletteCanvas.width / rect.width);
    const sy = (e.clientY - rect.top) * (this.paletteCanvas.height / rect.height);
    const paletteCols = Math.floor(this.paletteCanvas.width / ST);
    const col = Math.floor(sx / ST);
    const row = Math.floor(sy / ST) + this.paletteScrollY;
    const idx = row * paletteCols + col;
    const frames = this.getPaletteFrames();

    if (idx >= 0 && idx < frames.length) {
      const def = this.getActiveSheet();
      this.selectedTile = { sheet: def.key, frame: frames[idx] };
      this.renderPalette();
      const srcCol = frames[idx] % def.cols;
      const srcRow = Math.floor(frames[idx] / def.cols);
      this.status(`Selected: ${def.label} [${srcCol},${srcRow}] → ${this.activeLayer} layer`);
    }
  }

  private onPaletteMove(e: MouseEvent) {
    const rect = this.paletteCanvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (this.paletteCanvas.width / rect.width);
    const sy = (e.clientY - rect.top) * (this.paletteCanvas.height / rect.height);
    const paletteCols = Math.floor(this.paletteCanvas.width / ST);
    const col = Math.floor(sx / ST);
    const row = Math.floor(sy / ST) + this.paletteScrollY;
    const newHover = row * paletteCols + col;
    if (newHover !== this.hoveredPalette) {
      this.hoveredPalette = newHover;
      this.renderPalette();
    }

    // Show tooltip with sheet key + frame number
    const frames = this.getPaletteFrames();
    if (newHover >= 0 && newHover < frames.length) {
      const def = this.getActiveSheet();
      const frame = frames[newHover];
      const srcCol = frame % def.cols;
      const srcRow = Math.floor(frame / def.cols);
      this.paletteTooltip.textContent = `${def.key} #${frame}  [${srcCol},${srcRow}]`;
      this.paletteTooltip.style.display = 'block';
      // Position near cursor, relative to palette panel
      const panelRect = document.getElementById('palette-panel')!.getBoundingClientRect();
      this.paletteTooltip.style.left = `${e.clientX - panelRect.left + 12}px`;
      this.paletteTooltip.style.top = `${e.clientY - panelRect.top - 8}px`;
    } else {
      this.paletteTooltip.style.display = 'none';
    }
  }

  // ─── Grid Rendering (multi-layer) ────────────────────────────

  private resizeGridCanvas() {
    this.gridCanvas.width = this.gridW * ST;
    this.gridCanvas.height = this.gridH * ST;
    document.getElementById('grid-info')!.textContent = `${this.gridW} × ${this.gridH}`;
  }

  private renderGrid() {
    const ctx = this.gridCtx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.gridCanvas.width, this.gridCanvas.height);

    // Checkerboard background
    for (let r = 0; r < this.gridH; r++) {
      for (let c = 0; c < this.gridW; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#1a1a30' : '#16162a';
        ctx.fillRect(c * ST, r * ST, ST, ST);
      }
    }

    // Draw ALL layers bottom-to-top, dimming non-active layers
    for (const layerName of LAYER_ORDER) {
      const layerGrid = this.layers[layerName];
      const isActive = layerName === this.activeLayer;

      if (!isActive) ctx.globalAlpha = 0.5;

      for (let r = 0; r < this.gridH; r++) {
        for (let c = 0; c < this.gridW; c++) {
          const ref = layerGrid[r]?.[c];
          if (!ref) continue;
          this.drawTile(ctx, ref, c * ST, r * ST, SCALE);
        }
      }

      ctx.globalAlpha = 1;
    }

    // Grid lines
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 0.5;
    for (let r = 0; r <= this.gridH; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * ST);
      ctx.lineTo(this.gridW * ST, r * ST);
      ctx.stroke();
    }
    for (let c = 0; c <= this.gridW; c++) {
      ctx.beginPath();
      ctx.moveTo(c * ST, 0);
      ctx.lineTo(c * ST, this.gridH * ST);
      ctx.stroke();
    }

    // Active layer indicator
    const activeGrid = this.layers[this.activeLayer];
    ctx.strokeStyle = LAYER_COLORS[this.activeLayer];
    ctx.lineWidth = 1;
    for (let r = 0; r < this.gridH; r++) {
      for (let c = 0; c < this.gridW; c++) {
        if (activeGrid[r]?.[c]) {
          ctx.strokeRect(c * ST + 2, r * ST + 2, ST - 4, ST - 4);
        }
      }
    }

    // Hover highlight
    if (this.hoveredGrid) {
      const [hc, hr] = this.hoveredGrid;
      ctx.strokeStyle = GRID_LINE_HOVER;
      ctx.lineWidth = 2;
      ctx.strokeRect(hc * ST + 1, hr * ST + 1, ST - 2, ST - 2);

      if (this.selectedTile && !this.isDragging) {
        ctx.globalAlpha = 0.5;
        this.drawTile(ctx, this.selectedTile, hc * ST, hr * ST, SCALE);
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawTile(ctx: CanvasRenderingContext2D, ref: TileRef, x: number, y: number, scale: number) {
    const def = SHEET_DEFS.find(s => s.key === ref.sheet);
    const img = this.sheets.get(ref.sheet);
    if (!def || !img) return;

    const srcCol = ref.frame % def.cols;
    const srcRow = Math.floor(ref.frame / def.cols);
    ctx.drawImage(img, srcCol * T, srcRow * T, T, T, x, y, T * scale, T * scale);
  }

  private onGridMove(e: MouseEvent) {
    const [c, r] = this.getGridCell(e);
    if (!this.hoveredGrid || this.hoveredGrid[0] !== c || this.hoveredGrid[1] !== r) {
      this.hoveredGrid = [c, r];
      this.renderGrid();
    }
  }

  private getGridCell(e: MouseEvent): [number, number] {
    const rect = this.gridCanvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (this.gridCanvas.width / rect.width);
    const sy = (e.clientY - rect.top) * (this.gridCanvas.height / rect.height);
    return [Math.floor(sx / ST), Math.floor(sy / ST)];
  }

  // ─── Preview ──────────────────────────────────────────────────

  private renderPreview() {
    const pc = this.previewCanvas;
    pc.width = this.gridW * T;
    pc.height = this.gridH * T;
    const ctx = this.previewCtx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, pc.width, pc.height);

    for (const layerName of LAYER_ORDER) {
      const layerGrid = this.layers[layerName];
      for (let r = 0; r < this.gridH; r++) {
        for (let c = 0; c < this.gridW; c++) {
          const ref = layerGrid[r]?.[c];
          if (!ref) continue;
          this.drawTile(ctx, ref, c * T, r * T, 1);
        }
      }
    }

    pc.style.width = (this.gridW * T * 2) + 'px';
    pc.style.height = (this.gridH * T * 2) + 'px';
  }

  private renderVariations() {
    const template = this.buildTemplate();
    const colors = ['red', 'blue', 'green', 'brown'];
    const baseColor = detectRoofColor(template) || 'red';

    for (let i = 0; i < 4; i++) {
      const canvas = this.varCanvases[i];
      if (!canvas) continue;

      canvas.width = this.gridW * T;
      canvas.height = this.gridH * T;
      canvas.style.width = (this.gridW * T * 2) + 'px';
      canvas.style.height = (this.gridH * T * 2) + 'px';

      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const color = colors[i];
      const variant = color === baseColor
        ? template
        : swapRoofColor(template, baseColor, color);

      for (const layerName of LAYER_ORDER) {
        const layerGrid = variant.layers[layerName];
        for (let r = 0; r < variant.height; r++) {
          for (let c = 0; c < variant.width; c++) {
            const ref = layerGrid[r]?.[c];
            if (!ref) continue;
            this.drawTile(ctx, ref, c * T, r * T, 1);
          }
        }
      }

      const label = canvas.parentElement?.querySelector('.var-label');
      if (label) {
        label.textContent = color + (color === baseColor ? ' (base)' : '');
      }
    }
  }

  // ─── Render All ───────────────────────────────────────────────

  private renderAll() {
    this.renderPalette();
    this.renderGrid();
    this.renderPreview();
    this.renderVariations();
  }

  // ─── Template Build / Save / Load ─────────────────────────────

  private buildTemplate(): BuildingTemplate {
    const name = (document.getElementById('tmpl-name') as HTMLInputElement).value || 'building';
    const slugId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    // When editing an existing template, keep its original ID so save overwrites it.
    // Only use the slug-based ID for brand-new templates.
    const id = this.editingTemplateId || slugId;
    const isPublic = (document.getElementById('tmpl-public') as HTMLInputElement)?.checked || false;
    const tags: string[] = [];
    if (isPublic) tags.push('public');
    return {
      id,
      name,
      width: this.gridW,
      height: this.gridH,
      layers: cloneLayers(this.layers),
      ...(tags.length > 0 ? { tags } : {}),
    };
  }

  private applyTemplate(tmpl: BuildingTemplate) {
    tmpl = migrateTemplate(tmpl);
    (document.getElementById('tmpl-name') as HTMLInputElement).value = tmpl.name;
    (document.getElementById('grid-w') as HTMLInputElement).value = String(tmpl.width);
    (document.getElementById('grid-h') as HTMLInputElement).value = String(tmpl.height);
    const publicCb = document.getElementById('tmpl-public') as HTMLInputElement;
    if (publicCb) publicCb.checked = tmpl.tags?.includes('public') || false;
    this.gridW = tmpl.width;
    this.gridH = tmpl.height;
    this.layers = cloneLayers(tmpl.layers);
    this.resizeGridCanvas();
    this.renderAll();
  }

  private async saveTemplate() {
    const tmpl = this.buildTemplate();
    this.addToLibrary(tmpl);
    this.editingTemplateId = tmpl.id; // Now tracking this template for future saves
    await this.persistLibrary();
    const rank = footprintToRank(tmpl.width, tmpl.height);
    this.status(`Saved: ${tmpl.name} (${tmpl.width}×${tmpl.height}) → ${rank} rank`);
  }

  private async saveTemplateAs() {
    const currentName = (document.getElementById('tmpl-name') as HTMLInputElement).value || 'building';
    const newName = prompt('Save as new template name:', currentName + '-copy');
    if (!newName || newName.trim() === '') return;

    // Clear editing ID so this creates a brand-new template
    this.editingTemplateId = null;
    (document.getElementById('tmpl-name') as HTMLInputElement).value = newName.trim();
    const tmpl = this.buildTemplate();
    this.addToLibrary(tmpl);
    this.editingTemplateId = tmpl.id; // Now editing the new copy
    await this.persistLibrary();
    const rank = footprintToRank(tmpl.width, tmpl.height);
    this.status(`Saved new: ${tmpl.name} (${tmpl.width}×${tmpl.height}) → ${rank} rank`);
  }

  /** Persist the in-memory library to the server (writes templates.json to disk). */
  private async persistLibrary() {
    const lib: TemplateLibrary = {
      version: 1,
      templates: this.library,
    };
    try {
      const resp = await fetch('/api/save-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lib, null, 2),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        this.status(`Save failed: ${err.error || resp.statusText}`);
        return;
      }
      const result = await resp.json();
      console.log(`[Editor] Persisted ${result.count} templates to server`);
    } catch (err: any) {
      this.status(`Save failed: ${err.message}`);
    }
  }

  private loadTemplateFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        let tmpl = JSON.parse(reader.result as string);
        tmpl = migrateTemplate(tmpl);
        if (!tmpl.layers || !tmpl.width || !tmpl.height) throw new Error('Invalid template');
        this.pushUndo();
        this.applyTemplate(tmpl);
        this.addToLibrary(tmpl);
        this.status(`Loaded: ${tmpl.name}`);
      } catch (err) {
        this.status('Error: invalid template file');
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  // ─── Library Management ───────────────────────────────────────

  private addToLibrary(tmpl: BuildingTemplate) {
    // Match by ID first; fall back to matching by name to handle legacy
    // templates whose IDs don't match their slugified name
    let existing = this.library.findIndex(t => t.id === tmpl.id);
    if (existing < 0) {
      existing = this.library.findIndex(t => t.name === tmpl.name);
    }
    if (existing >= 0) {
      this.library[existing] = tmpl;
    } else {
      this.library.push(tmpl);
    }
    this.refreshLibrarySelect();
  }

  private refreshLibrarySelect() {
    const select = document.getElementById('lib-select') as HTMLSelectElement;
    select.innerHTML = '';
    if (this.library.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '(no templates)';
      select.appendChild(opt);
      return;
    }

    // Group templates by rank (descending area)
    const sorted = [...this.library].sort((a, b) => (b.width * b.height) - (a.width * a.height));
    const groups = new Map<string, BuildingTemplate[]>();
    for (const tmpl of sorted) {
      const rank = footprintToRank(tmpl.width, tmpl.height);
      if (!groups.has(rank)) groups.set(rank, []);
      groups.get(rank)!.push(tmpl);
    }

    const rankOrder = ['citadel', 'castle', 'palace', 'keep', 'manor', 'guild', 'cottage', 'hovel'];
    for (const rank of rankOrder) {
      const tmpls = groups.get(rank);
      if (!tmpls || tmpls.length === 0) continue;
      const optGroup = document.createElement('optgroup');
      const cap = rank.charAt(0).toUpperCase() + rank.slice(1);
      optGroup.label = `${cap}`;
      for (const tmpl of tmpls) {
        const opt = document.createElement('option');
        opt.value = tmpl.id;
        opt.textContent = `${tmpl.name} (${tmpl.width}×${tmpl.height})`;
        optGroup.appendChild(opt);
      }
      select.appendChild(optGroup);
    }
  }

  private loadFromLibrary() {
    const select = document.getElementById('lib-select') as HTMLSelectElement;
    const id = select.value;
    const tmpl = this.library.find(t => t.id === id);
    if (tmpl) {
      this.pushUndo();
      this.editingTemplateId = tmpl.id; // Track original ID for overwrite on save
      this.applyTemplate(tmpl);
      this.status(`Loaded from library: ${tmpl.name}`);
    }
  }

  private async deleteFromLibrary() {
    const select = document.getElementById('lib-select') as HTMLSelectElement;
    const id = select.value;
    if (!id) return;
    if (!confirm(`Delete template "${id}" from library?`)) return;
    this.library = this.library.filter(t => t.id !== id);
    this.refreshLibrarySelect();
    await this.persistLibrary();
    this.status(`Deleted: ${id}`);
  }

  private exportLibrary() {
    const current = this.buildTemplate();
    const hasContent = LAYER_ORDER.some(l => this.layers[l].some(r => r.some(c => c !== null)));
    if (hasContent) {
      this.addToLibrary(current);
    }

    const lib: TemplateLibrary = {
      version: 1,
      templates: this.library,
    };
    const json = JSON.stringify(lib, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'templates.json';
    a.click();
    URL.revokeObjectURL(url);
    this.status(`Exported library: ${this.library.length} templates`);
  }

  private importLibraryFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const lib = JSON.parse(reader.result as string) as TemplateLibrary;
        if (!lib.templates || !Array.isArray(lib.templates)) throw new Error('Invalid library');
        this.library = lib.templates.map(t => migrateTemplate(t));
        this.refreshLibrarySelect();
        this.status(`Imported library: ${lib.templates.length} templates`);
      } catch {
        this.status('Error: invalid library file');
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  private async fetchLibrary() {
    try {
      const resp = await fetch('/assets/buildings/templates.json');
      if (!resp.ok) return;
      const lib = await resp.json() as TemplateLibrary;
      if (lib.templates && lib.templates.length > 0) {
        this.library = lib.templates.map(t => migrateTemplate(t));
        this.refreshLibrarySelect();
        this.status(`Loaded library: ${lib.templates.length} templates`);
      }
    } catch {
      // No library yet
    }
  }

  // ─── Status ───────────────────────────────────────────────────

  private status(msg: string) {
    if (this.statusText) {
      this.statusText.textContent = msg;
    }
  }
}

// ─── Boot ───────────────────────────────────────────────────────
new BuildingEditor();
