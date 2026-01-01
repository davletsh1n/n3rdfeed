/**
 * @file index.ts
 * @description Главная точка входа приложения. Управляет маршрутизацией (Hono), рендерингом страниц (Mustache) и API-эндпоинтами.
 * Оптимизировано для Vercel Serverless Runtime (шаблоны встроены как константы для 100% совместимости).
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

// Шаблоны встроены как строковые константы для исключения ошибок ERR_MODULE_NOT_FOUND при деплое
const PAGE_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>N3RDFEED - ML/AI News</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;700&display=swap" rel="stylesheet" />
    <style>
      :root { --bg: #ffffff; --fg: #000000; --dim: #666666; --accent: #f0f0f0; --border: #000000; }
      body { font-family: 'Fira Code', monospace; background-color: var(--bg); color: var(--fg); }
      .terminal-border { border: 1px solid var(--border); }
      .post-item:hover { background-color: var(--accent); }
      .source-checkbox { display: none; }
      .source-label { cursor: pointer; padding: 2px 8px; border: 1px solid var(--border); font-size: 0.75rem; transition: all 0.1s; user-select: none; }
      .source-checkbox:checked + .source-label { background-color: var(--fg); color: var(--bg); }
      .source-label:hover { background-color: var(--accent); }
      .source-checkbox:checked + .source-label:hover { opacity: 0.8; }
      @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      .cursor-blink { animation: blink 1s step-end infinite; }
      ::-webkit-scrollbar { width: 8px; }
      ::-webkit-scrollbar-track { background: var(--bg); }
      ::-webkit-scrollbar-thumb { background: #ccc; }
    </style>
  </head>
  <body class="p-2 md:p-4">
    <div class="container mx-auto max-w-4xl">
      <header class="mb-4 terminal-border p-4">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 class="text-2xl font-bold tracking-tighter">
              <a href="/" class="bg-black text-white px-1">N3RDFEED<span class="cursor-blink">_</span></a>
            </h1>
            <p class="text-[10px] text-gray-500 mt-1">> ML/AI News</p>
          </div>
          <nav class="flex flex-wrap gap-2 text-sm">
            {{#filterLinks}}
            <a href="/?filter={{key}}&sources={{sourcesParam}}" class="px-2 py-1 terminal-border {{#active}}bg-black text-white hover:bg-gray-800{{/active}} {{^active}}hover:bg-gray-100{{/active}} transition-colors" data-navigate>[{{label}}]</a>
            {{/filterLinks}}
          </nav>
        </div>
        <div class="mt-4 pt-4 border-t border-black flex flex-wrap justify-between items-center gap-4 text-xs">
          <div class="flex flex-wrap gap-2">
            {{#sources}}
            <label class="flex items-center cursor-pointer">
              <input type="checkbox" class="source-checkbox" data-source="{{name}}" {{#checked}}checked{{/checked}}>
              <span class="source-label">{{name}}</span>
            </label>
            {{/sources}}
          </div>
          <div class="text-gray-500 text-[10px]">UPDATED: <span id="last-updated">...</span></div>
        </div>
      </header>
      <main class="terminal-border overflow-hidden">
        <div class="bg-black text-white px-4 py-1 text-[10px] font-bold flex justify-between uppercase tracking-widest">
          <span>NAME / DESCRIPTION</span>
          <span class="hidden md:inline">METRICS</span>
        </div>
        <ul class="divide-y divide-black">
          {{#posts}}
          <li class="post-item p-4 transition-colors">
            <div class="flex justify-between items-start gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-gray-400 text-xs">{{index}}.</span>
                  <a href="{{url}}" target="_blank" rel="noopener noreferrer" class="font-bold hover:underline block">{{displayName}}</a>
                  <span class="text-[10px] px-1 border border-gray-300 text-gray-500">{{icon}}</span>
                </div>
                <p class="text-sm text-gray-600 leading-tight">{{description}}</p>
              </div>
              <div class="text-right flex flex-col items-end gap-1 shrink-0">
                <span class="text-sm font-bold">{{stars}}</span>
                <span class="text-[9px] bg-black text-white px-1 font-bold">STARS</span>
              </div>
            </div>
          </li>
          {{/posts}}
        </ul>
      </main>
      <footer class="mt-4 p-4 text-center text-[10px] text-gray-400 uppercase tracking-widest">
        <p>© 2025 N3RDFEED SYSTEM - NO RIGHTS RESERVED</p>
      </footer>
    </div>
    <script>
      const currentFilter = "{{filter}}";
      const lastUpdatedTimestamp = {{lastUpdatedTimestamp}};
      function timeSince(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 60) return seconds + "s";
        let interval = seconds / 31536000;
        if (interval > 1) return Math.floor(interval) + "y";
        interval = seconds / 2592000;
        if (interval > 1) return Math.floor(interval) + "mo";
        interval = seconds / 86400;
        if (interval > 1) return Math.floor(interval) + "d";
        interval = seconds / 3600;
        if (interval > 1) return Math.floor(interval) + "h";
        interval = seconds / 60;
        if (interval > 1) return Math.floor(interval) + "m";
        return Math.floor(seconds) + "s";
      }
      function updateLastUpdated() {
        const el = document.getElementById('last-updated');
        if (el && lastUpdatedTimestamp) { el.textContent = timeSince(lastUpdatedTimestamp).toUpperCase() + ' AGO'; }
      }
      updateLastUpdated();
      setInterval(updateLastUpdated, 1000);
      function getSelectedSources() { return [...document.querySelectorAll('[data-source]:checked')].map(c => c.dataset.source); }
      function buildUrl(filter, sources) { return '/?filter=' + filter + '&sources=' + sources.join(','); }
      async function navigate(url) {
        document.querySelectorAll('[data-source]').forEach(cb => { cb.disabled = true; });
        history.pushState(null, '', url);
        const res = await fetch(url);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        document.querySelector('.container').innerHTML = doc.querySelector('.container').innerHTML;
        attachListeners();
        updateLastUpdated();
      }
      function attachListeners() {
        document.querySelectorAll('[data-source]').forEach(cb => { cb.addEventListener('change', () => { navigate(buildUrl(currentFilter, getSelectedSources())); }); });
        document.querySelectorAll('[data-navigate]').forEach(a => { a.addEventListener('click', (e) => { e.preventDefault(); navigate(a.href); }); });
      }
      window.addEventListener('popstate', () => navigate(location.href));
      attachListeners();
    </script>
  </body>
</html>`;

const ADMIN_TEMPLATE = `<div class="max-w-4xl mx-auto space-y-8">
  <div class="flex justify-between items-center bg-white p-6 rounded shadow-sm border-l-4 border-black">
    <div>
      <h1 class="text-2xl font-bold uppercase tracking-tighter">N3RDFEED Control Center</h1>
      <p class="text-gray-500 text-xs mt-1">Admin: {{user}}</p>
    </div>
    <div class="flex gap-4 items-center">
      <div id="statusIndicator" class="hidden items-center gap-2 text-xs font-bold text-blue-600 animate-pulse">
        <span class="w-2 h-2 bg-blue-600 rounded-full"></span> PROCESSING...
      </div>
      <button onclick="updateContent()" id="updateBtn" class="bg-black text-white px-4 py-2 hover:bg-gray-800 transition-all uppercase font-bold text-xs">Run Manual Update</button>
      <button onclick="logout()" class="bg-red-500 text-white px-4 py-2 hover:bg-red-600 transition-all uppercase font-bold text-xs">Logout</button>
    </div>
  </div>
  <div id="liveLogsContainer" class="hidden bg-black text-green-400 p-4 rounded shadow-inner font-mono text-[10px] h-40 overflow-y-auto border-2 border-gray-800 relative group">
    <div id="liveLogs"></div>
    <button onclick="toggleLogs()" class="absolute top-2 right-2 bg-gray-800 text-gray-400 px-2 py-1 rounded hover:text-white text-[8px] uppercase opacity-0 group-hover:opacity-100 transition-opacity">Toggle Size</button>
  </div>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
    <div class="md:col-span-1 bg-white p-6 rounded shadow-sm border-l-4 border-blue-500">
      <div class="flex justify-between items-center mb-4">
        <h2 class="font-bold uppercase text-blue-500">LLM Configuration</h2>
        <div class="text-right">
          <div class="text-[8px] text-gray-400 uppercase">Balance</div>
          <div class="text-xs font-bold text-green-600">{{balance}}</div>
        </div>
      </div>
      <div class="space-y-4">
        {{#models}}
        <div onclick="selectModel('{{id}}')" class="p-3 border rounded cursor-pointer hover:bg-blue-50 transition-colors group relative {{#active}}border-blue-500 bg-blue-50{{/active}}">
          <div class="font-bold text-xs group-hover:text-blue-600">{{name}}</div>
          <div class="text-[10px] text-gray-500 mt-1">Prompt: {{prompt}}/1M<br />Completion: {{completion}}/1M</div>
          {{#active}}<div class="absolute top-2 right-2 text-[8px] bg-blue-500 text-white px-1 rounded">ACTIVE</div>{{/active}}
          {{^active}}<div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-[8px] bg-gray-500 text-white px-1 rounded">SELECT</div>{{/active}}
        </div>
        {{/models}}
      </div>
    </div>
    <div class="md:col-span-2 bg-white p-6 rounded shadow-sm border-l-4 border-green-500">
      <h2 class="font-bold mb-4 uppercase text-green-500">Usage Statistics (30d)</h2>
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="border-b text-[10px] text-gray-400 uppercase">
            <th class="py-2">Model</th>
            <th class="py-2">Tokens</th>
            <th class="py-2 text-right">Cost (USD)</th>
          </tr>
        </thead>
        <tbody class="text-xs">
          {{#stats}}
          <tr class="border-b hover:bg-green-50">
            <td class="py-2">{{model}}</td>
            <td class="py-2">{{tokens}}</td>
            <td class="py-2 text-right font-bold">{{cost}}</td>
          </tr>
          {{/stats}}
        </tbody>
      </table>
      <div class="mt-4 text-right">
        <span class="text-[10px] text-gray-400 uppercase">Total Burn:</span>
        <span class="text-lg font-bold ml-2">{{totalCost}}</span>
      </div>
    </div>
  </div>
  <div class="bg-white p-6 rounded shadow-sm border-l-4 border-purple-500">
    <h2 class="font-bold mb-4 uppercase text-purple-500">Recent Translation Logs</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="border-b text-[10px] text-gray-400 uppercase">
            <th class="py-2">Time</th>
            <th class="py-2">Model</th>
            <th class="py-2">Tokens</th>
            <th class="py-2 text-right">Cost</th>
          </tr>
        </thead>
        <tbody class="text-[10px]">
          {{#logs}}
          <tr class="border-b hover:bg-purple-50">
            <td class="py-2 text-gray-500">{{time}}</td>
            <td class="py-2">{{model_id}}</td>
            <td class="py-2">{{tokens}}</td>
            <td class="py-2 text-right font-bold">{{cost}}</td>
          </tr>
          {{/logs}}
        </tbody>
      </table>
    </div>
  </div>
</div>
<script>
  function addLog(msg, type = 'info') {
    const logs = document.getElementById('liveLogs');
    const container = document.getElementById('liveLogsContainer');
    container.classList.remove('hidden');
    const div = document.createElement('div');
    const time = new Date().toLocaleTimeString();
    div.innerHTML = \`<span class="text-gray-500">[\${time}]</span> <span class="\${type === 'error' ? 'text-red-400' : 'text-green-400'}">\${msg}</span>\`;
    logs.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }
  function toggleLogs() {
    const container = document.getElementById('liveLogsContainer');
    if (container.classList.contains('h-40')) { container.classList.remove('h-40'); container.classList.add('h-96'); } else { container.classList.add('h-40'); container.classList.remove('h-96'); }
  }
  function logout() {
    const url = location.protocol + '//' + 'logout:logout@' + location.host + '/admin';
    fetch(url).then(() => { location.href = '/'; }).catch(() => { location.href = '/'; });
  }
  async function selectModel(modelId) {
    try {
      const res = await fetch('/api/admin/set-model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId }), });
      const data = await res.json();
      if (data.success) { location.reload(); } else { alert('Failed to set model'); }
    } catch (err) { alert('Error: ' + err.message); }
  }
  async function updateContent() {
    const btn = document.getElementById('updateBtn');
    const status = document.getElementById('statusIndicator');
    const originalText = btn.innerText;
    const logsDiv = document.getElementById('liveLogs');
    const container = document.getElementById('liveLogsContainer');
    btn.disabled = true; btn.innerText = 'Updating...'; btn.classList.add('opacity-50');
    status.classList.remove('hidden'); status.classList.add('flex'); container.classList.remove('hidden');
    logsDiv.innerHTML = ''; 
    addLog('Starting manual update process...');
    try {
      const res = await fetch('/api/update', { method: 'POST' });
      const data = await res.json();
      if (data.logs && Array.isArray(data.logs)) { data.logs.forEach(log => addLog(log.replace(/\\[.*?\\] /, ''))); }
      if (data.success) { addLog('Update successful! Page will reload in 5s...'); setTimeout(() => location.reload(), 5000); } else { addLog('Update failed: ' + (data.errors?.[0]?.message || 'Unknown error'), 'error'); }
    } catch (err) { addLog('Network error: ' + err.message, 'error'); } finally { btn.disabled = false; btn.innerText = originalText; btn.classList.remove('opacity-50'); status.classList.add('hidden'); status.classList.remove('flex'); }
  }
</script>`;

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

// Загружаем переменные окружения только в режиме разработки
if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
  try {
    const { config } = await import('dotenv');
    config();
  } catch (e) {
    // Игнорируем если dotenv не установлен или не поддерживается
  }
}

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
      balance: Number(balance).toFixed(2),
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
