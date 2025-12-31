import { ApiException, fromHono } from 'chanfana';
import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import Mustache from 'mustache';
import { ListPosts, GetLastUpdated } from './endpoints/posts';
import { updateContent } from './scheduled';
import { posts, FilterType } from './db';
import type { Post } from './types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PAGE_TEMPLATE = readFileSync(join(__dirname, 'templates/page.html'), 'utf-8');

const ALL_SOURCES = ['GitHub', 'Replicate', 'HuggingFace', 'Reddit'];

interface PostData {
  index: number;
  displayName: string;
  icon: string;
  description: string;
  url: string;
  stars: number;
}

function preparePostData(post: Post, index: number): PostData {
  const isRepo =
    post.source === 'huggingface' || post.source === 'github' || post.source === 'replicate';
  const displayName = isRepo ? `${post.username}/${post.name}` : post.name;
  const icon =
    post.source === 'huggingface'
      ? '🤗'
      : post.source === 'reddit'
      ? '👽'
      : post.source === 'replicate'
      ? '®️'
      : '⭐';
  const description = isRepo ? post.description : `${post.username} on ${post.description}`;

  return {
    index: index + 1,
    displayName,
    icon,
    description: description || '',
    url: post.url,
    stars: post.stars,
  };
}

function renderPage(
  postList: Post[],
  filter: string,
  sources: string[],
  lastUpdatedTimestamp: number | null,
): string {
  const filterLinks = [
    { key: 'past_day', label: 'Past day' },
    { key: 'past_three_days', label: 'Past three days' },
    { key: 'past_week', label: 'Past week' },
  ].map((f, i) => ({
    ...f,
    active: filter === f.key || (!filter && f.key === 'past_week'),
    first: i === 0,
  }));

  return Mustache.render(PAGE_TEMPLATE, {
    filter: filter || 'past_week',
    sourcesParam: sources.join(','),
    lastUpdatedTimestamp,
    posts: postList.map(preparePostData),
    filterLinks,
    sources: ALL_SOURCES.map((name) => ({
      name,
      checked: sources.includes(name),
    })),
  });
}

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof ApiException) {
    return c.json(
      { success: false, errors: err.buildResponse() },
      err.status as ContentfulStatusCode,
    );
  }
  console.error('Error:', err);
  return c.json(
    { success: false, errors: [{ code: 7000, message: 'Internal Server Error' }] },
    500,
  );
});

app.get('/', async (c) => {
  const filter = (c.req.query('filter') || 'past_week') as FilterType;
  const sourcesParam = c.req.query('sources') || 'GitHub,HuggingFace,Reddit,Replicate';
  const sources = sourcesParam.split(',');

  const [postList, lastUpdatedRaw] = await Promise.all([
    posts.query({ filter, sources }),
    posts.getLastUpdated(),
  ]);

  const lastUpdatedTimestamp = lastUpdatedRaw ? new Date(lastUpdatedRaw).getTime() : null;

  return c.html(renderPage(postList, filter, sources, lastUpdatedTimestamp), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
});

const openapi = fromHono(app, {
  docs_url: '/docs',
  schema: {
    info: {
      title: 'N3RDFEED API',
      version: '1.0.0',
      description: 'ML/AI news aggregator API',
    },
  },
});

openapi.get('/api/posts', ListPosts);
openapi.get('/api/last-updated', GetLastUpdated);

async function handleUpdate() {
  await updateContent();
  return { success: true };
}

app.get('/api/updateRepos', async (c) => c.json(await handleUpdate()));
app.post('/api/updateRepos', async (c) => c.json(await handleUpdate()));
app.get('/api/update', async (c) => c.json(await handleUpdate()));
app.post('/api/update', async (c) => c.json(await handleUpdate()));

export const GET = handle(app);
export const POST = handle(app);

export default app;
