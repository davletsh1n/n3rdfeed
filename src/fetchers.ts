/**
 * @file fetchers.ts
 * @description Модуль для сбора данных из внешних API (GitHub, HuggingFace, Reddit, Replicate).
 */

import Replicate from 'replicate';
import type { Post } from './types.js';
import type {
  GitHubSearchResponse,
  HuggingFaceModel,
  RedditResponse,
  ReplicateModel,
} from './types/api.js';
import {
  hashStringToInt,
  truncateWithoutBreakingWords,
  base36ToInt,
  sanitizeContent,
  addExecutionLog,
} from './utils.js';
import { API_KEYS, LIMITS, REDDIT_SUBREDDITS, REDDIT_FLAIR_FILTERS } from './config.js';

/**
 * Сборщик моделей из Replicate.
 * Replicate - это облачная платформа для запуска ML-моделей.
 */
export async function fetchReplicatePosts(): Promise<Post[]> {
  const replicate = new Replicate({ auth: API_KEYS.REPLICATE });
  const posts: Post[] = [];
  const limit = LIMITS.REPLICATE_LIMIT;
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  outer: for await (const batch of replicate.paginate(replicate.models.list)) {
    if (posts.length >= limit) break;

    for (const model of batch as ReplicateModel[]) {
      if (!model.latest_version?.id || model.run_count <= 1) continue;
      if (new Date(model.latest_version.created_at) < oneWeekAgo) break outer;

      posts.push({
        id: hashStringToInt(model.url).toString(),
        source: 'replicate',
        username: model.owner,
        name: model.name,
        stars: model.run_count,
        // Нормализуем описание перед сохранением
        description: sanitizeContent(model.description || ''),
        url: model.url,
        created_at: model.latest_version!.created_at,
      });
    }
  }

  addExecutionLog(`Fetched ${posts.length} replicate models`);
  return posts;
}

/**
 * Сборщик моделей из HuggingFace.
 * HuggingFace - это "GitHub для ML моделей".
 */
export async function fetchHuggingFacePosts(): Promise<Post[]> {
  const resp = await fetch(
    `https://huggingface.co/api/models?full=true&limit=${LIMITS.HUGGINGFACE_LIMIT}&sort=lastModified&direction=-1`,
  );
  const repos = (await resp.json()) as HuggingFaceModel[];
  const posts: Post[] = [];

  for (const repo of repos) {
    if (repo.likes <= 1 || repo.downloads <= 1 || !repo.author) continue;

    const repoIdInt = parseInt(repo._id.substring(10), 16);

    posts.push({
      id: repoIdInt.toString(),
      source: 'huggingface',
      username: repo.author,
      name: repo.id.split('/')[1],
      stars: repo.likes,
      // Для HuggingFace оставляем описание пустым, так как парсинг README часто дает неинформативный результат
      description: '',
      url: `https://huggingface.co/${repo.id}`,
      created_at: repo.lastModified,
    });
  }

  addExecutionLog(`Fetched ${posts.length} huggingface models`);
  return posts;
}

/**
 * Сборщик репозиториев из GitHub.
 * Ищет популярные Python-проекты, созданные за последнюю неделю.
 */
export async function fetchGitHubPosts(lastWeekDate: string): Promise<Post[]> {
  const posts: Post[] = [];

  for (let page = 1; page <= LIMITS.GITHUB_PAGES_LIMIT; page++) {
    const resp = await fetch(
      `https://api.github.com/search/repositories?q=language:python+created:>${lastWeekDate}&sort=stars&order=desc&per_page=${LIMITS.GITHUB_PER_PAGE}&page=${page}`,
      { headers: { 'User-Agent': 'hype-news-aggregator' } },
    );
    const data = (await resp.json()) as GitHubSearchResponse;

    for (const repo of data.items || []) {
      posts.push({
        id: repo.id.toString(),
        source: 'github',
        username: repo.owner.login,
        name: repo.name,
        stars: repo.stargazers_count,
        // Очищаем описание от возможного мусора
        description: sanitizeContent(repo.description || ''),
        url: repo.html_url,
        created_at: repo.created_at,
      });
    }
  }

  addExecutionLog(`Fetched ${posts.length} github repos`);
  return posts;
}

/**
 * Получение токена доступа Reddit через OAuth2.
 */
async function getRedditAccessToken(): Promise<string | null> {
  if (!API_KEYS.REDDIT_CLIENT_ID || !API_KEYS.REDDIT_CLIENT_SECRET) {
    addExecutionLog('[Reddit] Missing API keys, skipping OAuth');
    return null;
  }

  try {
    const auth = Buffer.from(
      `${API_KEYS.REDDIT_CLIENT_ID}:${API_KEYS.REDDIT_CLIENT_SECRET}`,
    ).toString('base64');
    const resp = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'n3rdfeed-aggregator/1.0',
      },
      body: 'grant_type=client_credentials',
    });

    if (!resp.ok) throw new Error(`Auth failed: ${resp.status}`);
    const data = (await resp.json()) as { access_token: string };
    return data.access_token;
  } catch (err) {
    addExecutionLog(`[Reddit] Auth error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Сборщик популярных постов из тематических сабреддитов.
 */
export async function fetchRedditPosts(): Promise<Post[]> {
  const posts: Post[] = [];
  const accessToken = await getRedditAccessToken();

  for (const subreddit of REDDIT_SUBREDDITS) {
    try {
      // Используем oauth.reddit.com если есть токен, иначе обычный www.reddit.com
      const baseUrl = accessToken ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
      const url = `${baseUrl}/r/${subreddit}/top.json?t=week&limit=${LIMITS.REDDIT_LIMIT}`;

      const headers: Record<string, string> = {
        'User-Agent': 'n3rdfeed-aggregator/1.0 (by /u/davletsh1n)',
      };

      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      } else {
        // Fallback заголовки для неавторизованных запросов
        headers['Accept'] = 'application/json';
        headers['Accept-Language'] = 'en-US,en;q=0.9';
      }

      const resp = await fetch(url, { headers });

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => 'No body');
        addExecutionLog(
          `[Reddit] Error fetching r/${subreddit}: ${resp.status} - ${errorText.substring(0, 100)}`,
        );
        continue;
      }

      const data = (await resp.json()) as RedditResponse;

      for (const thread of data.data?.children || []) {
        const {
          title,
          author,
          subreddit: sub,
          score,
          created_utc,
          id,
          permalink,
          link_flair_text,
        } = thread.data;

        const flairFilter = REDDIT_FLAIR_FILTERS[sub];
        if (flairFilter && link_flair_text && !flairFilter.includes(link_flair_text)) continue;

        posts.push({
          id: base36ToInt(id),
          source: 'reddit',
          username: author,
          // Заголовки Reddit тоже могут содержать странные символы
          name: sanitizeContent(title),
          stars: score,
          description: `/r/${sub}`,
          url: `https://www.reddit.com${permalink}`,
          created_at: new Date(created_utc * 1000).toISOString(),
        });
      }
    } catch (err) {
      console.error(`Error fetching from r/${subreddit}:`, err);
    }
  }

  addExecutionLog(`Fetched ${posts.length} reddit posts`);
  return posts;
}

/**
 * Сборщик популярных постов из Hacker News.
 * Использует официальный Firebase API.
 * Фильтрует посты по ключевым словам, связанным с AI/ML.
 */
export async function fetchHackerNewsPosts(): Promise<Post[]> {
  const posts: Post[] = [];
  const TOP_STORIES_URL = 'https://hacker-news.firebaseio.com/v0/topstories.json';
  const ITEM_URL = (id: number) => `https://hacker-news.firebaseio.com/v0/item/${id}.json`;

  // Темы, которые мы отсекаем для сохранения фокуса ленты
  const HN_BLACKLIST = [
    'politics',
    'election',
    'government',
    'economy',
    'inflation',
    'lawsuit',
    'court',
    'health',
    'medical',
    'cancer',
    'biology',
    'climate',
    'music',
    'movie',
    'film',
    'book review',
    'recipe',
    'cooking',
    'sport',
    'football',
    'basketball',
    'war',
    'military',
  ];

  try {
    // 1. Получаем список ID топовых постов
    const resp = await fetch(TOP_STORIES_URL);
    const topIds = (await resp.json()) as number[];

    // Берем первые 100 топовых историй
    const idsToFetch = topIds.slice(0, 100);

    // 2. Получаем детали для каждого поста параллельно
    const itemPromises = idsToFetch.map((id) => fetch(ITEM_URL(id)).then((r) => r.json()));
    const items = await Promise.all(itemPromises);

    for (const item of items) {
      // Согласно HN_API.md, проверяем тип и флаги dead/deleted
      if (
        !item ||
        item.type !== 'story' ||
        item.dead ||
        item.deleted ||
        !item.url ||
        !item.title
      ) {
        continue;
      }

      // Тематическая фильтрация (Blacklist)
      const titleLower = item.title.toLowerCase();
      const isBlacklisted = HN_BLACKLIST.some((word) => titleLower.includes(word));
      if (isBlacklisted) continue;

      // Добавляем историю
      posts.push({
        id: `hn_${item.id}`,
        source: 'hackernews',
        username: item.by,
        name: sanitizeContent(item.title),
        stars: item.score,
        description: new URL(item.url).hostname,
        url: item.url,
        created_at: new Date(item.time * 1000).toISOString(),
      });
    }
  } catch (err) {
    console.error('[HackerNews] Fetch error:', err);
    addExecutionLog(`[HackerNews] Error: ${err instanceof Error ? err.message : String(err)}`);
  }

  addExecutionLog(`Fetched ${posts.length} Hacker News posts`);
  return posts;
}
