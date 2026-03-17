import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { basicAuth } from 'hono/basic-auth';
import { health } from './api/health';
import { createIssuesRoutes } from './api/issues-kv';
import { createTodosRoutes } from './api/todos-kv';
import { createUsersRoutes } from './api/users-kv';
import { createGenerationRoutes } from './api/generation-kv';
import { createMeetingsRoutes, setMeetingsEnv } from './api/meetings-kv';
import { createWebhookHandler } from './pylon/handler-kv';
import { setMCPEnv } from './mcp/client';
import { setD1Database } from './store/d1-issues';
import { setUsersD1Database } from './store/d1-users';
import { setAgentEnv } from './agent';
import { setVerifyEnv } from './pylon/verify';

type Bindings = {
  ANTHROPIC_API_KEY: string;
  STACKONE_API_KEY: string;
  STACKONE_ACCOUNT_ID: string;
  STACKONE_FIREFLIES_ACCOUNT_ID?: string;
  PYLON_WEBHOOK_SECRET?: string;
  DASHBOARD_PASSWORD?: string;
  DB: D1Database;
  ASSETS?: {
    fetch: (request: Request) => Promise<Response>;
  };
};

const app = new Hono<{ Bindings: Bindings }>();

// Set env and D1 for each request
app.use('*', async (c, next) => {
  setMCPEnv(c.env);
  setD1Database(c.env.DB);
  setUsersD1Database(c.env.DB);
  setAgentEnv(c.env);
  setVerifyEnv(c.env);
  setMeetingsEnv(c.env);
  await next();
});

// Password protection (skip health check and webhook)
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;

  // Skip auth for health check and webhook
  if (path === '/health' || path === '/api/pylon/webhook') {
    return next();
  }

  // Skip auth if no password is configured
  if (!c.env.DASHBOARD_PASSWORD) {
    return next();
  }

  // Apply basic auth
  const auth = basicAuth({
    username: 'admin',
    password: c.env.DASHBOARD_PASSWORD,
  });

  return auth(c, next);
});

// Middleware
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Health check
app.route('/health', health);

// API routes (KV-backed)
app.route('/api/issues', createIssuesRoutes());
app.route('/api/todos', createTodosRoutes());
app.route('/api/users', createUsersRoutes());
app.route('/api/generate', createGenerationRoutes());
app.route('/api/meetings', createMeetingsRoutes());

// Pylon webhook (KV-backed)
app.post('/api/pylon/webhook', createWebhookHandler());



// Fallback to index.html for SPA routing (non-API routes)
app.get('*', async (c) => {
  const assets = c.env.ASSETS;
  if (assets) {
    // Try to serve the requested file, fallback to index.html
    const url = new URL(c.req.url);
    let response = await assets.fetch(new Request(url.origin + url.pathname));
    if (response.status === 404) {
      response = await assets.fetch(new Request(url.origin + '/index.html'));
    }
    return response;
  }
  return c.text('Not found', 404);
});

export default app;
