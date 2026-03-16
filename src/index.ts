import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/bun';
import { health } from './api/health';
import { issues } from './api/issues';
import { todos } from './api/todos';
import { users } from './api/users';
import { generation } from './api/generation';
import { handlePylonWebhook, processRetryQueue } from './pylon/handler';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Health check
app.route('/health', health);

// API routes
app.route('/api/issues', issues);
app.route('/api/todos', todos);
app.route('/api/users', users);
app.route('/api/generate', generation);

// Pylon webhook
app.post('/api/pylon/webhook', handlePylonWebhook);

// Serve frontend
app.get('/', async (c) => {
  const html = await Bun.file('./src/frontend/index.html').text();
  return c.html(html);
});

app.get('/styles.css', async (c) => {
  const css = await Bun.file('./src/frontend/styles.css').text();
  return c.text(css, 200, { 'Content-Type': 'text/css' });
});

app.get('/App.js', async (c) => {
  // Bundle React app on-the-fly for development
  const result = await Bun.build({
    entrypoints: ['./src/frontend/App.tsx'],
    target: 'browser',
    minify: false,
  });

  if (!result.success) {
    console.error('Build failed:', result.logs);
    return c.text('Build failed', 500);
  }

  const output = await result.outputs[0].text();
  return c.text(output, 200, { 'Content-Type': 'application/javascript' });
});

// Start retry queue processor
setInterval(() => {
  processRetryQueue().catch(err => {
    console.error('Retry queue processing failed:', err);
  });
}, 30000); // Every 30 seconds

const port = parseInt(process.env.PORT || '3000', 10);

console.log(`🚀 StackDash server starting on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
