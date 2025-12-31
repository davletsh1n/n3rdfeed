import { serve } from '@hono/node-server';
import { config } from 'dotenv';
import app from './index';

config();

const port = 3000;
console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
