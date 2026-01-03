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
} from './services/llm.js';
import {
  executionLogs,
  clearExecutionLogs,
  timeSince,
  markdownToHtml,
} from './utils.js';
import { createDigest } from './services/digest.js';
import { sendTelegramMessage } from './services/telegram.js';
import { dynamicConfig, setTelegramSendLogs } from './services/config.js';
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

let lastDigestResult: { content: string; clusters: any[]; usage?: any } | null = null;

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

app.post('/api/admin/preview-digest', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) return c.json({ success: false, message: 'Unauthorized' }, 401);
  const [type, credentials] = authHeader.split(' ');
  const decoded = atob(credentials || '');
  const [user, pass] = decoded.split(':');
  if (user !== adminUser || pass !== adminPass) return c.json({ success: false, message: 'Invalid Credentials' }, 401);

  const { force } = await c.req.json().catch(() => ({ force: false }));

  try {
    const result = await createDigest(force);
    if (!result) return c.json({ success: false, message: 'No new topics found' });

    lastDigestResult = result;

    // Сохраняем в БД для персистентности
    await posts.saveLastDigest(result);

    // Логируем генерацию (косты)
    await posts.logLLMUsage({ ...result.usage, post_id: `PREVIEW_${Date.now()}`, items_count: result.clusters.length });

    return c.json({ success: true, html: markdownToHtml(result.content) });
  } catch (err: any) {
    return c.json({ success: false, message: err.message });
  }
});

app.post('/api/admin/load-last-digest', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) return c.json({ success: false, message: 'Unauthorized' }, 401);
  const [type, credentials] = authHeader.split(' ');
  const decoded = atob(credentials || '');
  const [user, pass] = decoded.split(':');
  if (user !== adminUser || pass !== adminPass) return c.json({ success: false, message: 'Invalid Credentials' }, 401);

  try {
    const result = await posts.getLastDigest();
    if (!result) return c.json({ success: false, message: 'No saved digest found' });
    
    lastDigestResult = result;
    
    return c.json({ success: true, html: markdownToHtml(result.content) });
  } catch (err: any) {
    return c.json({ success: false, message: err.message });
  }
});

app.post('/api/admin/send-last-digest', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) return c.json({ success: false, message: 'Unauthorized' }, 401);
  const [type, credentials] = authHeader.split(' ');
  const decoded = atob(credentials || '');
  const [user, pass] = decoded.split(':');
  if (user !== adminUser || pass !== adminPass) return c.json({ success: false, message: 'Invalid Credentials' }, 401);

  if (!lastDigestResult) return c.json({ success: false, message: 'No digest generated yet' });

  try {
    const htmlContent = markdownToHtml(lastDigestResult.content);
    const resultTg = await sendTelegramMessage(htmlContent);
    
    if (resultTg.success) {
        await posts.addToDigestHistory(lastDigestResult.clusters.map(c => ({ topic_summary: c.mainPost.name, embedding: c.mainPost.embedding })));
        return c.json({ success: true });
    } else {
        return c.json({ success: false, message: resultTg.error || 'Failed to send to Telegram' });
    }
  } catch (err: any) {
    return c.json({ success: false, message: err.message });
  }
});

app.post('/api/admin/send-digest', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) return c.json({ success: false, message: 'Unauthorized' }, 401);
  const [type, credentials] = authHeader.split(' ');
  const decoded = atob(credentials || '');
  const [user, pass] = decoded.split(':');
  if (user !== adminUser || pass !== adminPass) return c.json({ success: false, message: 'Invalid Credentials' }, 401);

  const { force } = await c.req.json().catch(() => ({ force: false }));

  try {
    const result = await createDigest(force);
    if (!result) return c.json({ success: false, message: 'No new topics found' });

    // Сохраняем в БД
    await posts.saveLastDigest(result);

    const { content, usage, clusters } = result;
    const htmlContent = markdownToHtml(content);
    const resultTg = await sendTelegramMessage(htmlContent);
    
    if (resultTg.success) {
        await posts.logLLMUsage({ ...usage, post_id: `DIGEST_TG_${Date.now()}`, items_count: clusters.length });
        await posts.addToDigestHistory(clusters.map(c => ({ topic_summary: c.mainPost.name, embedding: c.mainPost.embedding })));
        return c.json({ success: true });
    } else {
        return c.json({ success: false, message: resultTg.error || 'Failed to send to Telegram' });
    }
  } catch (err: any) {
    return c.json({ success: false, message: err.message });
  }
});

app.post('/api/admin/toggle-logs', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) return c.json({ success: false, message: 'Unauthorized' }, 401);
  const [type, credentials] = authHeader.split(' ');
  const decoded = atob(credentials || '');
  const [user, pass] = decoded.split(':');
  if (user !== adminUser || pass !== adminPass) return c.json({ success: false, message: 'Invalid Credentials' }, 401);

  const { enabled } = await c.req.json();
  
  try {
    await posts.setAppConfig('telegram_send_logs', String(enabled));
    setTelegramSendLogs(enabled);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, message: err.message });
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

    const [stats, logs, activeModel, balance, aggregatedLogs] = await Promise.all([
      posts.getStats(30).catch((err) => {
        console.error('[Admin] Error fetching stats:', err);
        return [];
      }),
      posts.getLLMLogs(50).catch((err) => {
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
      posts.getAggregatedLogs(30).catch((err) => {
        console.error('[Admin] Error fetching aggregated logs:', err);
        return [];
      }),
    ]);

    // Aggregation Logic
    const byType = { tldr: 0, digest: 0, preview: 0, other: 0 };
    (aggregatedLogs || []).forEach((l: any) => {
      const cost = Number(l.total_cost) || 0;
      if (l.post_id.startsWith('BATCH')) byType.tldr += cost;
      else if (l.post_id.startsWith('DIGEST')) byType.digest += cost;
      else if (l.post_id.startsWith('PREVIEW')) byType.preview += cost;
      else byType.other += cost;
    });

    const dailyBurn: Record<string, number> = {};
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dailyBurn[d.toISOString().slice(0, 10)] = 0;
    }

    (aggregatedLogs || []).forEach((l: any) => {
      const day = l.created_at.split('T')[0];
      if (dailyBurn[day] !== undefined) {
        dailyBurn[day] += Number(l.total_cost) || 0;
      }
    });

    const maxDaily = Math.max(...Object.values(dailyBurn), 0.1); // Avoid div by zero

    const dailyBurnData = Object.entries(dailyBurn).map(([date, cost]) => ({
      date: date.slice(5), // MM-DD
      cost: cost.toFixed(3),
      height: Math.max(5, (cost / maxDaily) * 100) + '%',
    }));

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
      byType: {
        tldr: byType.tldr.toFixed(4),
        digest: byType.digest.toFixed(4),
        preview: byType.preview.toFixed(4),
        other: byType.other.toFixed(4),
      },
      dailyBurn: dailyBurnData,
      tgLogs: dynamicConfig.telegramSendLogs,
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
    await rebuildFeed();
    return c.json({ success: true, logs: executionLogs });
  } catch (err: any) {
    return c.json({ success: false, errors: [{ message: err.message }], logs: executionLogs }, 500);
  }
});

const openapi = fromHono(app, { docs_url: '/docs' });
openapi.get('/api/posts', ListPosts);
openapi.get('/api/last-updated', GetLastUpdated);

export default app;
