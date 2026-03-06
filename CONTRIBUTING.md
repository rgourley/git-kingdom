# Contributing to Git Kingdom

Thanks for your interest in contributing! Git Kingdom welcomes contributions of all kinds — code, pixel art, building templates, and bug reports.

## Getting Started

```bash
npm install
npm run dev
```

The app runs at `http://localhost:5173`.

## Contributing Buildings & Assets

Git Kingdom uses a built-in **Building Editor** for creating pixel-art building templates. To open it:

1. Start the dev server (`npm run dev`)
2. Navigate to `http://localhost:5173/?editor=building` (or `/editor.html`)

### Building templates

Building templates live in `public/assets/buildings/templates.json`. Each template uses tiles from the sprite sheets in `public/assets/town/` and `public/assets/grasslands/`.

Templates have three layers:
- **base** — ground-level foundation (floors, paths)
- **main** — walls, roofs, primary structure
- **detail** — doors, windows, decorations

### Adding a new building

1. Open the Building Editor
2. Design your building using tiles from the palette
3. Save — the editor exports updated JSON
4. Submit a PR with the updated `templates.json`

### Asset guidelines

- All sprites are **16×16 pixel tiles**
- Use the existing sprite sheets whenever possible
- New sprite sheets should match the RPG Maker VX Ace format
- Keep building footprints reasonable (2×2 for hovels up to 6×6 for citadels)

## Contributing Code

### Project structure

```
src/
  main.ts              — Boot sequence & entry point
  types.ts             — Shared TypeScript types
  router.ts            — Client-side URL routing
  analytics.ts         — Google Analytics event tracking
  api/client.ts        — API client for Vercel serverless functions
  scenes/
    TitleScene.ts      — Animated title screen
    WorldScene.ts      — Top-level world map (all kingdoms)
    CityScene.ts       — City interior (individual kingdom)
  generators/
    TerrainGenerator.ts — Procedural terrain (noise-based)
    WorldGenerator.ts   — World map layout
    CityGenerator.ts    — City layout & building placement
    KingdomGenerator.ts — Kingdom data processing
    TilesetGenerator.ts — Sprite sheet → tileset conversion
  editor/
    BuildingEditor.ts  — Pixel art building editor
    VariationEngine.ts — Building template variations
```

### Development workflow

1. Fork and clone the repo
2. Create a feature branch (`git checkout -b my-feature`)
3. Make your changes
4. Verify: `npx tsc --noEmit && npm run build`
5. Open a pull request

### Finding things to work on

Look for `TODO` comments in the source code — they mark areas ready for improvement. You can find them all with:

```bash
grep -rn "TODO" src/
```

## Reporting Bugs

Use the [bug report template](https://github.com/rgourley/git-kingdom/issues/new?template=bug_report.yml) to file issues. Include browser info and screenshots when possible.
