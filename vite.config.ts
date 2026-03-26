import { defineConfig, Plugin } from 'vite';
import { resolve } from 'path';
import { writeFileSync, readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

/**
 * Vite dev-server plugin that exposes a POST /api/save-templates endpoint.
 * The building editor uses this to persist the template library directly
 * to public/assets/buildings/templates.json without a file-download workflow.
 */
function templateSavePlugin(): Plugin {
  return {
    name: 'template-save',
    configureServer(server) {
      server.middlewares.use('/api/save-templates', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer | string) => { body += chunk; });
        req.on('end', () => {
          try {
            // Validate JSON before writing
            const lib = JSON.parse(body);
            if (!lib.templates || !Array.isArray(lib.templates)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Invalid library format' }));
              return;
            }

            const outPath = resolve(__dirname, 'public/assets/buildings/templates.json');
            writeFileSync(outPath, JSON.stringify(lib, null, 2), 'utf-8');

            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(JSON.stringify({
              ok: true,
              count: lib.templates.length,
            }));
            console.log(`[template-save] Saved ${lib.templates.length} templates to ${outPath}`);
          } catch (err: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [
    templateSavePlugin(),
    // Serve citizen.html for /citizen/* routes in dev (mirrors Vercel rewrite)
    {
      name: 'citizen-rewrite',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.startsWith('/citizen/')) {
            try {
              const html = readFileSync(resolve(__dirname, 'citizen.html'), 'utf-8');
              const transformed = await server.transformIndexHtml(req.url, html);
              res.setHeader('Content-Type', 'text/html');
              res.statusCode = 200;
              res.end(transformed);
            } catch {
              next();
            }
            return;
          }
          next();
        });
      },
    },
    // Dev API handlers for events and rankings (query Supabase directly)
    {
      name: 'dev-api',
      configureServer(server) {
        const getSupabase = () => {
          const url = process.env.SUPABASE_URL;
          const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
          if (!url || !key) return null;
          return createClient(url, key);
        };

        server.middlewares.use('/api/events', async (_req, res) => {
          const sb = getSupabase();
          if (!sb) { res.statusCode = 500; res.end('{}'); return; }
          const { data } = await sb.from('world_events')
            .select('id, event_type, payload, created_at')
            .order('created_at', { ascending: false })
            .limit(20);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data ?? []));
        });

        server.middlewares.use('/api/rankings', async (_req, res) => {
          const sb = getSupabase();
          if (!sb) { res.statusCode = 500; res.end('{}'); return; }
          const [r, b] = await Promise.all([
            sb.from('kingdom_rankings').select('*').order('rank', { ascending: true }),
            sb.from('kingdom_battles').select('*').order('started_at', { ascending: false }).limit(10),
          ]);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ rankings: r.data ?? [], battles: b.data ?? [] }));
        });
      },
    },
    // Intercept remaining /api/* requests in dev so Vite doesn't try to transform serverless .ts files
    {
      name: 'mock-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/api/') && !req.url.startsWith('/api/save-templates') && !req.url.startsWith('/api/citizen')) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'API not available in dev mode' }));
            return;
          }
          next();
        });
      },
    },
  ],
  server: {
    hmr: {
      overlay: false,
    },
    proxy: {
      '/api/citizen': {
        target: 'https://www.gitkingdom.com',
        changeOrigin: true,
      },
    },
    watch: {
      ignored: [resolve(__dirname, 'api') + '/**'],
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        editor: resolve(__dirname, 'editor.html'),
        about: resolve(__dirname, 'about.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        changelog: resolve(__dirname, 'changelog.html'),
        'how-it-works': resolve(__dirname, 'how-it-works.html'),
        faq: resolve(__dirname, 'faq.html'),
        admin: resolve(__dirname, 'admin.html'),
        citizen: resolve(__dirname, 'citizen.html'),
        citizens: resolve(__dirname, 'citizens.html'),
      },
    },
  },
});
