import { defineConfig, Plugin } from 'vite';
import { resolve } from 'path';
import { writeFileSync, readFileSync } from 'fs';

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
    // Intercept /api/* requests in dev so Vite doesn't try to transform serverless .ts files
    {
      name: 'mock-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // If it's an /api/ request (not /api/save-templates which is handled above),
          // return a 404 JSON instead of letting Vite try to serve api/*.ts as modules
          if (req.url?.startsWith('/api/') && !req.url.startsWith('/api/save-templates')) {
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
      },
    },
  },
});
