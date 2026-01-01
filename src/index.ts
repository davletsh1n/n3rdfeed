/**
 * @file index.ts
 * @description Главная точка входа приложения. Управляет маршрутизацией (Hono), рендерингом страниц (Mustache) и API-эндпоинтами.
 */

import { ApiException, fromHono } from 'chanfana';
import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import Mustache from 'mustache';
import { ListPosts, GetLastUpdated } from './endpoints/posts.js';
import { updateContent } from './scheduled.js';
import { posts, FilterType } from './db.js';
import type { Post } from './types';
import { MODEL_RATES, getOpenRouterBalance } from './services/llm.js';
import { executionLogs, clearExecutionLogs } from './utils.js';
import { PAGE_TEMPLATE, ADMIN_TEMPLATE } from './templates.js';
import { SOURCES, AUTH, SOURCE_ICONS, validateConfig, logConfig } from './config.js';
import type { LLMStatsRow, LLMLogRow, AdminStats, AdminLog, AdminModel } from './types/api.js';

const ALL_SOURCES = [...SOURCES];

function preparePostData(post: Post, index: number) {
  const isRepo =
    post.source === 'huggingface' || post.source === 'github' || post.source === 'replicate';

  // Всегда показываем оригинальное название (без перевода)
  const displayName = isRepo ? `${post.username}/${post.name}` : post.name;
  const icon = SOURCE_ICONS[post.source] || SOURCE_ICONS.github;

  // Оригинальное описание (всегда показываем)
  const originalDescription = isRepo
    ? post.description || ''
    : `${post.username} on ${post.description}`;

  // TLDR (если есть)
  const tldr = post.tldr_ru || '';
  const hasTLDR = !!post.tldr_ru;

  return {
    index: index + 1,
    displayName,
    icon,
    originalDescription,
    tldr,
    hasTLDR,
    url: post.url,
    stars: post.stars,
  };
}

const app = new Hono();

app.get('/', async (c) => {
  const filter = (c.req.query('filter') || 'past_week') as FilterType;
  const sourcesParam = c.req.query('sources') || 'GitHub,HuggingFace,Reddit,Replicate';
  const sources = sourcesParam.split(',');

  const [postList, lastUpdatedRaw] = await Promise.all([
    posts.query({ filter, sources }),
    posts.getLastUpdated(),
  ]);

  const lastUpdatedTimestamp = lastUpdatedRaw ? new Date(lastUpdatedRaw).getTime() : null;

  const html = Mustache.render(PAGE_TEMPLATE, {
    filter: filter || 'past_week',
    sourcesParam: sources.join(','),
    lastUpdatedTimestamp,
    posts: postList.map(preparePostData),
    filterLinks: [
      { key: 'past_day', label: 'Past day' },
      { key: 'past_three_days', label: 'Past three days' },
      { key: 'past_week', label: 'Past week' },
    ].map((f) => ({ ...f, active: filter === f.key || (!filter && f.key === 'past_week') })),
    sources: ALL_SOURCES.map((name) => ({ name, checked: sources.includes(name) })),
  });

  return c.html(html);
});

// Admin Auth
const adminUser = process.env.ADMIN_USER || 'admin';
const adminPass = process.env.ADMIN_PASS || 'admin';

// Логируем для отладки (только факт наличия, не сами значения)
console.log('[Auth] Admin credentials configured:', {
  userSet: !!process.env.ADMIN_USER,
  passSet: !!process.env.ADMIN_PASS,
  usingDefaults: !process.env.ADMIN_USER || !process.env.ADMIN_PASS,
});

app.get('/admin', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    c.header('WWW-Authenticate', 'Basic realm="N3RDFEED Admin"');
    return c.text('Unauthorized', 401);
  }

  const [type, credentials] = authHeader.split(' ');
  if (!credentials) {
    console.log('[Auth] No credentials in Authorization header');
    c.header('WWW-Authenticate', 'Basic realm="N3RDFEED Admin"');
    return c.text('Unauthorized', 401);
  }

  const decoded = atob(credentials);
  const [user, pass] = decoded.split(':');

  console.log('[Auth] Login attempt:', { user, passLength: pass?.length || 0 });

  if (user !== adminUser || pass !== adminPass) {
    console.log('[Auth] Invalid credentials');
    c.header('WWW-Authenticate', 'Basic realm="N3RDFEED Admin"');
    return c.text('Invalid Credentials', 401);
  }

  console.log('[Auth] Successful login:', user);

  try {
    console.log('[Admin] Fetching admin panel data...');

    const [stats, logs, activeModel, balance] = await Promise.all([
      posts.getStats(30).catch((err) => {
        console.error('[Admin] Error fetching stats:', err);
        return [];
      }),
      posts.getLLMLogs(20).catch((err) => {
        console.error('[Admin] Error fetching logs:', err);
        return [];
      }),
      posts.getActiveModel().catch((err) => {
        console.error('[Admin] Error fetching active model:', err);
        return 'openai/gpt-4o-mini';
      }),
      getOpenRouterBalance().catch((err) => {
        console.error('[Admin] Error fetching balance:', err);
        return 0;
      }),
    ]);

    console.log('[Admin] Stats result:', stats);
    console.log('[Admin] Logs result:', logs);
    console.log('[Admin] Active model:', activeModel);
    console.log('[Admin] Balance:', balance);

    const html = Mustache.render(ADMIN_TEMPLATE, {
      user,
      balance: Number(balance).toFixed(2),
      models: Object.entries(MODEL_RATES).map(([id, rate]) => ({
        id,
        ...rate,
        active: id === activeModel,
      })),
      stats: (stats || []).map(
        (s: LLMStatsRow): AdminStats => ({
          model: s.model_id || 'Unknown',
          tokens: (Number(s.total_tokens) || 0).toLocaleString(),
          cost: Number(s.total_usd || 0).toFixed(4),
        }),
      ),
      totalCost: (stats || [])
        .reduce((acc: number, s: LLMStatsRow) => acc + Number(s.total_usd || 0), 0)
        .toFixed(4),
      logs: (logs || []).map(
        (l: LLMLogRow): AdminLog => ({
          time: new Date(l.created_at).toLocaleString(),
          model_id: l.model_id,
          tokens: (Number(l.prompt_tokens) + Number(l.completion_tokens)).toLocaleString(),
          cost: Number(l.total_cost).toFixed(5),
        }),
      ),
    });

    return c.html(
      `<html><head><title>Admin</title><script src="https://cdn.tailwindcss.com"></script></head><body class="p-8 bg-gray-100 font-mono text-sm">${html}</body></html>`,
    );
  } catch (err) {
    console.error('[Admin] Critical error:', err);
    const errorDetails = err instanceof Error ? err.message : String(err);
    const isDev = process.env.NODE_ENV !== 'production';
    return c.html(
      `<html><head><title>Admin Error</title><script src="https://cdn.tailwindcss.com"></script></head><body class="p-8 bg-gray-100"><div class="max-w-2xl mx-auto bg-white p-6 rounded shadow"><h1 class="text-2xl font-bold text-red-600 mb-4">Admin Panel Error</h1><p class="text-gray-700 mb-4">Failed to load admin panel data.</p>${
        isDev
          ? `<div class="bg-red-50 border border-red-200 p-4 rounded"><p class="font-mono text-sm text-red-800">${errorDetails}</p></div>`
          : ''
      }<a href="/admin" class="inline-block mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">Retry</a></div></body></html>`,
      500,
    );
  }
});

app.post('/api/admin/set-model', async (c) => {
  const { modelId } = await c.req.json();
  if (!MODEL_RATES[modelId]) return c.json({ success: false }, 400);
  await posts.setActiveModel(modelId);
  return c.json({ success: true });
});

app.post('/api/update', async (c) => {
  try {
    clearExecutionLogs();
    await updateContent();
    return c.json({ success: true, logs: executionLogs });
  } catch (err: any) {
    return c.json({ success: false, errors: [{ message: err.message }], logs: executionLogs }, 500);
  }
});

const openapi = fromHono(app, { docs_url: '/docs' });
openapi.get('/api/posts', ListPosts);
openapi.get('/api/last-updated', GetLastUpdated);

export const GET = handle(app);
export const POST = handle(app);
export default app;
