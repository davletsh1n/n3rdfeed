/**
 * @file index.ts
 * @description Главная точка входа приложения. Управляет маршрутизацией (Hono), рендерингом страниц (Mustache) и API-эндпоинтами.
 */

import { ApiException, fromHono } from 'chanfana';
import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import Mustache from 'mustache';
import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { ListPosts, GetLastUpdated } from './endpoints/posts.js';
import { updateContent } from './scheduled.js';
import { posts, FilterType } from './db.js';
import type { Post } from './types';
import { MODEL_RATES, getOpenRouterBalance } from './services/llm.js';
import { executionLogs, clearExecutionLogs } from './utils.js';

// Загружаем переменные окружения
config();

// Загрузка шаблонов
const PAGE_TEMPLATE = fs.readFileSync(
  path.resolve(process.cwd(), 'src/templates/page.html'),
  'utf-8',
);
const ADMIN_TEMPLATE = fs.readFileSync(
  path.resolve(process.cwd(), 'src/templates/admin.html'),
  'utf-8',
);

const ALL_SOURCES = ['GitHub', 'Replicate', 'HuggingFace', 'Reddit'];

function preparePostData(post: Post, index: number) {
  const isRepo =
    post.source === 'huggingface' || post.source === 'github' || post.source === 'replicate';
  const displayName = isRepo ? `${post.username}/${post.name}` : post.name_ru || post.name;
  const icon =
    post.source === 'huggingface'
      ? '🤗'
      : post.source === 'reddit'
      ? '👽'
      : post.source === 'replicate'
      ? '®️'
      : '⭐';
  const description = isRepo
    ? post.description_ru || post.description
    : `${post.username} on ${post.description}`;

  return {
    index: index + 1,
    displayName,
    icon,
    description: description || '',
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

app.get('/admin', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    c.header('WWW-Authenticate', 'Basic realm="N3RDFEED Admin"');
    return c.text('Unauthorized', 401);
  }
  const [type, credentials] = authHeader.split(' ');
  const decoded = atob(credentials);
  const [user, pass] = decoded.split(':');

  if (user !== adminUser || pass !== adminPass) {
    c.header('WWW-Authenticate', 'Basic realm="N3RDFEED Admin"');
    return c.text('Invalid Credentials', 401);
  }

  try {
    const [stats, logs, activeModel, balance] = await Promise.all([
      posts.getStats(30),
      posts.getLLMLogs(20),
      posts.getActiveModel(),
      getOpenRouterBalance(),
    ]);

    const html = Mustache.render(ADMIN_TEMPLATE, {
      user,
      balance: Number(balance).toFixed(4),
      models: Object.entries(MODEL_RATES).map(([id, rate]) => ({
        id,
        ...rate,
        active: id === activeModel,
      })),
      stats: (stats || []).map((s: any) => ({
        model: s.model_id || 'Unknown',
        tokens: (Number(s.total_tokens) || 0).toLocaleString(),
        cost: Number(s.total_usd || 0).toFixed(4),
      })),
      totalCost: (stats || [])
        .reduce((acc: number, s: any) => acc + Number(s.total_usd || 0), 0)
        .toFixed(4),
      logs: (logs || []).map((l: any) => ({
        time: new Date(l.created_at).toLocaleString(),
        model_id: l.model_id,
        tokens: (Number(l.prompt_tokens) + Number(l.completion_tokens)).toLocaleString(),
        cost: Number(l.total_cost).toFixed(5),
      })),
    });

    return c.html(
      `<html><head><title>Admin</title><script src="https://cdn.tailwindcss.com"></script></head><body class="p-8 bg-gray-100 font-mono text-sm">${html}</body></html>`,
    );
  } catch (err) {
    console.error('Admin Error:', err);
    return c.html('<h1>Admin Error</h1>', 500);
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
