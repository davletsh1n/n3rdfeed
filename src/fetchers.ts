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
import { API_KEYS, LIMITS, REDDIT_SUBREDDITS, REDDIT_FLAIR_FILTERS, HN_WHITELIST, BANNED_STRINGS } from './config.js';

/**
 * Сборщик моделей из Replicate.
 * Оптимизирован: берем только топ-50 за неделю.
 */
export async function fetchReplicatePosts(): Promise<Post[]> {
  const replicate = new Replicate({ auth: API_KEYS.REPLICATE });
  const posts: Post[] = [];
  const limit = LIMITS.REPLICATE_LIMIT; // Теперь 50 согласно ТЗ
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  try {
    outer: for await (const batch of replicate.paginate(replicate.models.list)) {
      if (posts.length >= limit) break;

      for (const model of batch as ReplicateModel[]) {
        if (posts.length >= limit) break outer;
        if (!model.latest_version?.id || model.run_count <= 1) continue;
        if (new Date(model.latest_version.created_at) < oneWeekAgo) break outer;

        posts.push({
          id: hashStringToInt(model.url).toString(),
          source: 'replicate',
          username: model.owner,
          name: model.name,
          stars: model.run_count,
          description: sanitizeContent(model.description || ''),
          url: model.url,
          created_at: model.latest_version!.created_at,
        });
      }
    }
  } catch (err) {
    console.error('[Replicate] Fetch error:', err);
  }

  addExecutionLog(`Fetched ${posts.length} replicate models`);
  return posts;
}

/**
 * Сборщик моделей из HuggingFace.
 * Реализует два среза: Trending (по лайкам) и Fresh (по дате).
 */
export async function fetchHuggingFacePosts(): Promise<Post[]> {
  const posts: Post[] = [];
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const endpoints = [
    {
      name: 'Trending',
      url: `https://huggingface.co/api/models?full=true&limit=100&sort=likes&direction=-1`,
    },
    {
      name: 'Fresh',
      url: `https://huggingface.co/api/models?full=true&limit=${LIMITS.HUGGINGFACE_LIMIT}&sort=lastModified&direction=-1`,
    },
  ];

  for (const endpoint of endpoints) {
    try {
      const resp = await fetch(endpoint.url);
      const repos = (await resp.json()) as HuggingFaceModel[];

      for (const repo of repos) {
        // Фильтр: отсекаем мусор (likes > 2 и downloads > 10)
        if (repo.likes < 2 || repo.downloads < 10 || !repo.author) continue;

        // Для Trending среза дополнительно фильтруем по дате создания (age < 7d)
        if (endpoint.name === 'Trending' && new Date(repo.lastModified) < oneWeekAgo) continue;

        const repoIdInt = parseInt(repo._id.substring(10), 16);

        posts.push({
          id: repoIdInt.toString(),
          source: 'huggingface',
          username: repo.author,
          name: repo.id.split('/')[1],
          stars: repo.likes,
          description: repo.pipeline_tag || 'ML Model',
          url: `https://huggingface.co/${repo.id}`,
          created_at: repo.lastModified,
        });
      }
      addExecutionLog(`[HuggingFace] Sliced '${endpoint.name}' fetched ${repos.length} models`);
    } catch (err) {
      console.error(`[HuggingFace] Error fetching ${endpoint.name}:`, err);
    }
  }

  addExecutionLog(`Fetched total ${posts.length} huggingface models`);
  return posts;
}

/**
 * Сборщик репозиториев из GitHub.
 * Реализует 4 вектора поиска для максимального охвата (Recall).
 * Использует правильное URL-кодирование и упрощенные запросы.
 */
export async function fetchGitHubPosts(lastWeekDate: string): Promise<Post[]> {
  const posts: Post[] = [];

  // Окно 60 дней для новых проектов
  const date60 = new Date();
  date60.setDate(date60.getDate() - 60);
  const last60DaysDate = date60.toISOString().slice(0, 10);

  const searchVectors = [
    {
      name: 'Global AI (ML Only)',
      query: `topic:machine-learning created:>${last60DaysDate} stars:>50`,
    },
    {
      name: 'LLM Systems',
      query: `topic:llm created:>${last60DaysDate} stars:>30`,
    },
    {
      name: 'Generative AI',
      query: `topic:generative-ai created:>${last60DaysDate} stars:>30`,
    },
  ];

  for (const vector of searchVectors) {
    try {
      // ВАЖНО: Кодируем запрос, чтобы пробелы стали %20, а символы > передались верно
      const encodedQuery = encodeURIComponent(vector.query);
      const url = `https://api.github.com/search/repositories?q=${encodedQuery}&sort=stars&order=desc&per_page=50`;

      addExecutionLog(`[GitHub] Fetching vector '${vector.name}'...`);

      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'n3rdfeed-aggregator/2.1',
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (!resp.ok) {
        const errText = await resp.text();
        addExecutionLog(`[GitHub] Error ${resp.status} in vector '${vector.name}': ${errText.substring(0, 100)}`);
        continue;
      }

      const data = (await resp.json()) as GitHubSearchResponse;

      // Дедупликация в памяти (если вектора пересеклись)
      for (const repo of data.items || []) {
        if (!posts.find((p) => p.id === repo.id.toString())) {
          // Логируем для проверки данных
          console.log(`[GitHub] Repo ${repo.name} stars: ${repo.stargazers_count}`);
          
          posts.push({
            id: repo.id.toString(),
            source: 'github',
            username: repo.owner.login,
            name: repo.name,
            stars: Number(repo.stargazers_count) || 0,
            description: sanitizeContent(repo.description || ''),
            url: repo.html_url,
            created_at: repo.created_at,
          });
        }
      }

      addExecutionLog(`[GitHub] '${vector.name}' -> ${data.items?.length || 0} items`);
    } catch (err) {
      console.error(`[GitHub] Fatal error in vector ${vector.name}:`, err);
    }
  }

  addExecutionLog(`Fetched total ${posts.length} unique github repos`);
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

      // Тематическая фильтрация
      const titleLower = item.title.toLowerCase();

      // 1. Blacklist Check (Глобальный черный список)
      const isBlacklisted = BANNED_STRINGS.some((word) => titleLower.includes(word));
      if (isBlacklisted) continue;

      // 2. Whitelist Check (Только профильные темы)
      const isWhitelisted = HN_WHITELIST.some((word) => titleLower.includes(word));
      if (!isWhitelisted) continue;

      // Добавляем историю
      posts.push({
        id: `hn_${item.id}`,
        source: 'hackernews',
        username: item.by,
        name: sanitizeContent(item.title),
        stars: item.score,
        // Сохраняем количество комментариев в поле stars_extra или подобном, 
        // но так как у нас нет такого поля в Post, будем использовать description для хранения метаданных
        // или просто передадим в scorePost через расширенный объект
        description: `${new URL(item.url).hostname} | ${item.descendants || 0} comments`,
        url: item.url,
        created_at: new Date(item.time * 1000).toISOString(),
        // Добавляем временное поле для скоринга (оно не сохранится в БД, но будет доступно в текущем цикле)
        comments_count: item.descendants || 0,
      } as any);
    }
  } catch (err) {
    console.error('[HackerNews] Fetch error:', err);
    addExecutionLog(`[HackerNews] Error: ${err instanceof Error ? err.message : String(err)}`);
  }

  addExecutionLog(`Fetched ${posts.length} Hacker News posts`);
  return posts;
}
