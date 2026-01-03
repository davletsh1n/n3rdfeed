import { serve } from '@hono/node-server';
import { config } from 'dotenv';
import app from './index';
import { startWorker } from './worker.js';
import { loadDynamicConfig } from './services/config.js';

config();

// Load dynamic config from DB
loadDynamicConfig().catch(err => console.error('Failed to load dynamic config:', err));

// Start background worker
startWorker();

const port = Number(process.env.PORT) || 3000;

try {
  console.log(`[Server] Starting server on http://0.0.0.0:${port}`);
  
  const server = serve({
    fetch: app.fetch,
    port,
    hostname: '0.0.0.0',
  }, (info) => {
    console.log(`[Server] Listening on http://${info.address}:${info.port}`);
  });

  server.on('error', (err) => {
    console.error('[Server] Server error:', err);
  });

} catch (err) {
  console.error('[Server] Failed to start server:', err);
  process.exit(1);
}
