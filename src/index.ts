/**
 * @file index.ts
 * @description Главная точка входа приложения. Управляет маршрутизацией (Hono), рендерингом страниц (Mustache) и API-эндпоинтами.
 */

import { ApiException, fromHono } from 'chanfana';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import Mustache from 'mustache';
import { ListPosts, GetLastUpdated } from './endpoints/posts.js';
import { updateContent } from './scheduled.js';
import { posts, FilterType, scorePost } from './db.js';
import type { Post } from './types';
import {
  MODEL_RATES,
  getOpenRouterBalance,
  generateDigest,
} from './services/llm.js';
import {
  executionLogs,
  clearExecutionLogs,
  timeSince,
  categorizePost,
  cosineSimilarity,
} from './utils.js';
import { PAGE_TEMPLATE, ADMIN_TEMPLATE } from './templates.js';
import { SOURCES, AUTH, SOURCE_ICONS, validateConfig, logConfig } from './config.js';
import type { LLMStatsRow, LLMLogRow, AdminStats, AdminLog, AdminModel } from './types/api.js';
import { feedCache } from './cache.js';
import { rebuildFeed } from './worker.js';

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

  // Рассчитываем sc0re и время
  const score = scorePost(post);
  const timeAgo = timeSince(new Date(post.created_at));

  return {
    index: index + 1,
    displayName,
    icon,
    originalDescription,
    tldr,
    hasTLDR,
    url: post.url,
    stars: post.stars,
    score: score.toFixed(1),
    timeAgo: `${timeAgo.toUpperCase()} AGO`,
  };
}

const app = new Hono();

app.get('/', async (c) => {
  const filter = (c.req.query('filter') || 'past_week') as FilterType;
  const sourcesParam = c.req.query('sources') || SOURCES.join(',');
  const selectedSources = sourcesParam.split(',').map((s) => s.toLowerCase());

  let cachedData = feedCache.get();

  // If cache is empty, we try to load from DB once to avoid empty screen on first visit
  if (!cachedData) {
    console.log(`[Cache] Global miss, performing emergency sync build...`);
    
    // Запускаем сборку в фоне, не блокируя ответ
    rebuildFeed().catch(err => console.error('Emergency rebuild failed:', err));
    
    // Возвращаем страницу загрузки с авто-обновлением
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>N3RDFEED - Initializing...</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <meta http-equiv="refresh" content="2">
          <style>
            @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
            .cursor-blink { animation: blink 1s step-end infinite; }
          </style>
        </head>
        <body class="bg-white flex items-center justify-center h-screen font-mono">
          <div class="text-center">
            <h1 class="text-2xl font-bold mb-2 tracking-tighter">N3RDFEED<span class="cursor-blink">_</span></h1>
            <p class="text-xs text-gray-500 uppercase tracking-widest mb-4">Initializing feed cache...</p>
            <div class="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin mx-auto"></div>
          </div>
        </body>
      </html>
    `);
  }

  const lastUpdatedTimestamp = cachedData ? cachedData.lastUpdated : Date.now();
  
  // Filter in memory
  const now = Date.now();
  let timeLimit = now - 7 * 24 * 60 * 60 * 1000; // Default past_week
  if (filter === 'past_day') timeLimit = now - 24 * 60 * 60 * 1000;
  else if (filter === 'past_three_days') timeLimit = now - 3 * 24 * 60 * 60 * 1000;

  const filteredClusters = (cachedData?.clusters || []).filter((cluster: any) => {
    // 1. Time filter
    if (cluster.createdAt < timeLimit) return false;

    // 2. Source filter: at least one source in cluster must be in selectedSources
    return cluster.sourcesInCluster.some((s: string) => selectedSources.includes(s));
  });

  // Prepare for Mustache
  const postsToRender = filteredClusters.map((cluster: any, index: number) => {
    return {
      ...cluster.prepareData,
      index: index + 1,
      timeAgo: timeSince(new Date(cluster.createdAt)).toUpperCase() + ' AGO',
      sources: cluster.prepareData.sourceTypes.map((s: string) => ({ 
        icon: SOURCE_ICONS[s] || SOURCE_ICONS.github 
      }))
    };
  });

  const html = Mustache.render(PAGE_TEMPLATE, {
    filter: filter || 'past_week',
    sourcesParam: sourcesParam,
    lastUpdatedTimestamp,
    posts: postsToRender,
    filterLinks: [
      { key: 'past_day', label: 'Past day' },
      { key: 'past_three_days', label: 'Past three days' },
      { key: 'past_week', label: 'Past week' },
    ].map((f) => ({ ...f, active: filter === f.key || (!filter && f.key === 'past_week') })),
    sources: ALL_SOURCES.map((name) => ({ name, checked: selectedSources.includes(name.toLowerCase()) })),
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

app.get('/admin/digest', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    c.header('WWW-Authenticate', 'Basic realm="N3RDFEED Admin"');
    return c.text('Unauthorized', 401);
  }

  const [type, credentials] = authHeader.split(' ');
  const decoded = atob(credentials || '');
  const [user, pass] = decoded.split(':');

  if (user !== adminUser || pass !== adminPass) {
    c.header('WWW-Authenticate', 'Basic realm="N3RDFEED Admin"');
    return c.text('Invalid Credentials', 401);
  }

  try {
    // 1. Получаем кластеры за последние 12 часов
    const clusters = await posts.queryClustered({
      filter: 'past_day',
      sources: ['GitHub', 'HuggingFace', 'Reddit', 'HackerNews', 'Replicate'],
    });

    // 2. Temporal Deduplication: фильтруем то, что уже публиковали за 36 часов
    const history = await posts.getDigestHistory(36);
    const uniqueClusters = clusters.filter((cluster) => {
      if (!cluster.mainPost.embedding) return true;
      
      const maxSimilarity = history.length > 0 
        ? Math.max(...history.map(h => cosineSimilarity(h.embedding, cluster.mainPost.embedding)))
        : 0;
      
      return maxSimilarity < 0.85; // Порог уникальности 85%
    });

    // 3. Diversity Filter: отбираем топ-8 кластеров с учетом разнообразия
    const topClusters: any[] = [];
    const categoryCounts: Record<string, number> = {};
    const MAX_PER_CATEGORY = 3;

    for (const cluster of uniqueClusters) {
      if (topClusters.length >= 8) break;

      const category = categorizePost(cluster.mainPost);
      const count = categoryCounts[category] || 0;

      if (count < MAX_PER_CATEGORY) {
        topClusters.push(cluster);
        categoryCounts[category] = count + 1;
      }
    }

    // 4. Генерируем дайджест
    const digest = await generateDigest(topClusters, 'anthropic/claude-3.5-sonnet');

    // 5. Логируем использование LLM
    await posts.logLLMUsage({
      ...digest.usage,
      post_id: `DIGEST_${Date.now()}`,
      items_count: topClusters.length,
    });

    // 6. Записываем опубликованные сюжеты в историю
    if (topClusters.length > 0) {
      await posts.addToDigestHistory(topClusters.map(c => ({
        topic_summary: c.mainPost.name,
        embedding: c.mainPost.embedding
      })));
    }

    return c.html(`
      <html>
        <head>
          <title>Digest Preview</title>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="p-8 bg-gray-100 font-mono text-sm">
          <div class="max-w-2xl mx-auto bg-white p-8 rounded shadow-sm border-l-4 border-black">
            <h1 class="text-xl font-bold mb-6 uppercase tracking-tighter">AI Digest Preview</h1>
            <div class="whitespace-pre-wrap leading-relaxed text-gray-800">${digest.content}</div>
            <div class="mt-8 pt-4 border-t border-gray-100 text-[10px] text-gray-400">
              Model: ${digest.usage.model_id} | Cost: $${digest.usage.total_cost.toFixed(5)}
            </div>
            <a href="/admin" class="inline-block mt-6 text-blue-500 hover:underline">← Back to Admin</a>
          </div>
        </body>
      </html>
    `);
  } catch (err: any) {
    return c.text(`Error generating digest: ${err.message}`, 500);
  }
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

export default app;
