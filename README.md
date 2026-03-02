# Git Kingdom

**Explore GitHub as a Fantasy RPG World**

Git Kingdom transforms GitHub into a living, breathing pixel-art fantasy world. Every programming language becomes a kingdom. Every repository becomes a building. The more stars and commits a repo has, the grander its structure — from humble cottages to towering castles.

![Git Kingdom Title Screen](screenshots/title.png)

## The World

Sign in with GitHub and your repositories join a shared universal world alongside thousands of other open-source projects. The entire map is procedurally generated from real GitHub data.

![World Map](screenshots/world.png)

Each kingdom on the map represents a programming language:
- **TypeScript** — home to vscode, Angular, Tailwind CSS, and Supabase
- **Python** — where transformers, LangChain, and PyTorch reside
- **Rust** — land of Deno, Tauri, and Alacritty
- **C++** — domain of TensorFlow, Electron, and Godot
- And many more...

Kingdoms are sized by their total stars and commits. The terrain — forests, mountains, deserts, snow — is determined by the language's character.

## Cities

Click any kingdom to see its stats, top repos, and reigning "King" (the developer with the most commits). Enter a city to explore individual buildings.

![Kingdom Details](screenshots/kingdom-info.png)

Inside each city, buildings are arranged in neighborhoods with roads, gardens, and trees. Large repos become castles and keeps at the city center. Smaller repos form houses and cottages in the surrounding blocks.

## How It Works

1. **Sign in with GitHub** — one-click OAuth, no tokens to paste
2. **Your repos join the world** — they appear as buildings in their language's kingdom
3. **Explore** — scroll the world map, zoom into cities, click buildings to see repo details
4. **Share** — every profile and repo has its own URL

## Built With

- [Phaser 3](https://phaser.io/) — 2D game engine
- [Vite](https://vitejs.dev/) — build tool
- [Vercel](https://vercel.com/) — hosting & serverless functions
- [Vercel KV](https://vercel.com/storage/kv) — Redis-based persistence
- GitHub OAuth & API

## Local Development

```bash
npm install
npm run dev
```

The app runs at `http://localhost:5173`. For the full experience with OAuth and the universal world, you'll need Vercel environment variables configured.

## License

[AGPL-3.0](LICENSE) — Created by [Rob Gourley](https://www.robertcreative.com/)
