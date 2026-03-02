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
  plugins: [templateSavePlugin()],
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        editor: resolve(__dirname, 'editor.html'),
      },
    },
  },
});
