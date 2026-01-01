/**
 * @file scheduled.ts
 * @description Координатор процесса обновления контента. Запускает сборщики и сохраняет результаты в БД.
 * @inputs
 *   - Функции-сборщики из fetchers.ts.
 * @outputs
 *   - Асинхронная функция `updateContent`, выполняющая полный цикл обновления данных.
 *   - Логирует количество добавленных записей.
 */

import { posts } from './db.js';
import {
  fetchGitHubPosts,
  fetchHuggingFacePosts,
  fetchRedditPosts,
  fetchReplicatePosts,
} from './fetchers.js';
import type { Post } from './types';

export async function updateContent(): Promise<void> {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  const lastWeekDate = date.toISOString().slice(0, 10);

  const [huggingFacePosts, gitHubPosts, redditPosts, replicatePosts] = await Promise.all([
    fetchHuggingFacePosts(),
    fetchGitHubPosts(lastWeekDate),
    fetchRedditPosts(),
    fetchReplicatePosts(),
  ]);

  const allPosts: Post[] = [...huggingFacePosts, ...gitHubPosts, ...redditPosts, ...replicatePosts];

  try {
    await posts.upsertMany(allPosts);
    console.log(`Upserted ${allPosts.length} posts`);
  } catch (err) {
    console.error(`Error upserting posts:`, err);
  }

  console.log(`Updated ${allPosts.length} posts total`);
}
