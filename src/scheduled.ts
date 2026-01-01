import { posts } from './db.js';
import {
  fetchGitHubPosts,
  fetchHuggingFacePosts,
  fetchRedditPosts,
  fetchReplicatePosts,
} from './fetchers.js';
import type { Post } from './types';
import { translateBatch } from './services/llm.js';
import { addExecutionLog } from './utils.js';

/**
 * @file scheduled.ts
 * @description Координатор процесса обновления контента. Запускает сборщики, переводит контент пакетами и сохраняет результаты в БД.
 */

export async function updateContent(): Promise<void> {
  addExecutionLog('Manual update triggered');

  const date = new Date();
  date.setDate(date.getDate() - 7);
  const lastWeekDate = date.toISOString().slice(0, 10);

  const [huggingFacePosts, gitHubPosts, redditPosts, replicatePosts] = await Promise.all([
    fetchHuggingFacePosts(),
    fetchGitHubPosts(lastWeekDate),
    fetchRedditPosts(),
    fetchReplicatePosts(),
  ]);

  const allPosts: Post[] = [
    ...huggingFacePosts,
    ...gitHubPosts,
    ...redditPosts,
    ...replicatePosts,
  ].slice(0, 100); // Временный лимит 100 постов для проверки
  const activeModel = await posts.getActiveModel();

  addExecutionLog(`Total posts fetched: ${allPosts.length}. Checking for existing IDs...`);

  // 1. Фильтруем посты, которые уже есть в БД
  const existingIds = await posts.getExistingIds(allPosts.map((p) => p.id));
  const newPosts = allPosts.filter((p) => !existingIds.has(p.id));

  addExecutionLog(`New posts to translate: ${newPosts.length}`);

  if (newPosts.length > 0) {
    // 2. Группируем только НОВЫЕ посты для пакетного перевода
    const repoBatch = newPosts
      .filter((p) => (p.source === 'github' || p.source === 'replicate') && p.description)
      .map((p) => ({ id: p.id, text: p.description }));

    const redditBatch = newPosts
      .filter((p) => p.source === 'reddit')
      .map((p) => ({ id: p.id, text: p.name }));

    addExecutionLog(
      `Starting batch translation: ${repoBatch.length} repos, ${redditBatch.length} reddit posts...`,
    );

    // 3. Выполняем пакетные запросы
    const [repoTranslations, redditTranslations] = await Promise.all([
      translateBatch(
        repoBatch,
        'ПЕРЕВЕДИ ОПИСАНИЕ IT-ПРОЕКТА НА РУССКИЙ ЯЗЫК. Используй профессиональный сленг. НЕ ОСТАВЛЯЙ АНГЛИЙСКИЙ ТЕКСТ.',
        activeModel,
      ),
      translateBatch(
        redditBatch,
        'ПЕРЕВЕДИ ЗАГОЛОВОК НОВОСТИ AI/ML НА РУССКИЙ ЯЗЫК. Сохраняй стиль IT-медиа. НЕ ОСТАВЛЯЙ АНГЛИЙСКИЙ ТЕКСТ.',
        activeModel,
      ),
    ]);

    // 4. Сопоставляем результаты (ВАЖНО: обновляем объекты в allPosts)
    allPosts.forEach((post) => {
      const translatedDesc = repoTranslations.translations[post.id];
      const translatedName = redditTranslations.translations[post.id];

      if (translatedDesc) {
        post.description_ru = translatedDesc;
      }
      if (translatedName) {
        post.name_ru = translatedName;
      }
    });

    // 5. Логируем расходы
    const logUsage = async (batchResult: any, count: number) => {
      if (count > 0) {
        const totalTokens = batchResult.usage.prompt_tokens + batchResult.usage.completion_tokens;
        const totalCost = batchResult.usage.total_cost;

        addExecutionLog(
          `LLM Response received. Tokens: ${totalTokens}. Cost: $${totalCost.toFixed(5)}`,
        );

        await posts.logLLMUsage({
          ...batchResult.usage,
          post_id: `BATCH_${Date.now()}`,
        });
      }
    };

    await Promise.all([
      logUsage(repoTranslations, repoBatch.length),
      logUsage(redditTranslations, redditBatch.length),
    ]);
  } else {
    addExecutionLog('No new posts to translate. Skipping LLM calls.');
  }

  try {
    addExecutionLog(`Attempting to upsert ${allPosts.length} posts...`);
    await posts.upsertMany(allPosts);
    addExecutionLog(`Upserted ${allPosts.length} posts to database successfully`);
  } catch (err) {
    addExecutionLog(`Error upserting posts: ${err}`);
    console.error('Upsert error details:', err);
  }
}
