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
 * Сборщик популярных постов из тематических сабреддитов.
 */
export async function fetchRedditPosts(): Promise<Post[]> {
  const posts: Post[] = [];

  for (const subreddit of REDDIT_SUBREDDITS) {
    try {
      const url = `https://www.reddit.com/r/${subreddit}/top.json?t=week&limit=${LIMITS.REDDIT_LIMIT}`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
      });

      if (!resp.ok) {
        addExecutionLog(`[Reddit] Error fetching r/${subreddit}: ${resp.status}`);
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
