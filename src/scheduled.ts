import { posts } from './db.js';
import {
  fetchGitHubPosts,
  fetchHuggingFacePosts,
  fetchRedditPosts,
  fetchReplicatePosts,
} from './fetchers.js';
import type { Post } from './types';
import { translateBatch, generateTLDRBatch } from './services/llm.js';
import { addExecutionLog } from './utils.js';
import { LIMITS, LLM_PROMPTS } from './config.js';

/**
 * @file scheduled.ts
 * @description Координатор процесса обновления контента. Запускает сборщики, фильтрует дубликаты, переводит новые посты и сохраняет их в БД.
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

  const allFetchedPosts: Post[] = [
    ...huggingFacePosts,
    ...gitHubPosts,
    ...redditPosts,
    ...replicatePosts,
  ];

  // Сортируем по весу (рейтингу) перед обрезкой
  allFetchedPosts.sort((a, b) => posts.scorePost(b) - posts.scorePost(a));

  // Лимит топовых постов для обработки
  const limitedPosts = allFetchedPosts.slice(0, LIMITS.POSTS_PROCESSING_LIMIT);
  const activeModel = await posts.getActiveModel();

  addExecutionLog(
    `Total posts fetched from APIs: ${allFetchedPosts.length}. Processing top 150 by score.`,
  );

  // 1. Фильтруем дубликаты на входе: оставляем только те посты, которых НЕТ в базе данных
  const existingIds = await posts.getExistingIds(limitedPosts.map((p) => p.id));
  const newPosts = limitedPosts.filter((p) => !existingIds.has(p.id));

  addExecutionLog(`New unique posts identified: ${newPosts.length}`);

  if (newPosts.length > 0) {
    // 2. Генерируем TLDR для ВСЕХ новых постов (батчами по 30 для надежности)
    const TLDR_BATCH_SIZE = 30;
    let totalGenerated = 0;
    let totalCost = 0;

    for (let i = 0; i < newPosts.length; i += TLDR_BATCH_SIZE) {
      const batch = newPosts.slice(i, i + TLDR_BATCH_SIZE);
      const batchNum = Math.floor(i / TLDR_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(newPosts.length / TLDR_BATCH_SIZE);

      const tldrBatch = batch.map((p) => ({
        id: p.id,
        title: p.name,
        description: p.description || '',
        source: p.source,
      }));

      addExecutionLog(
        `Starting TLDR batch ${batchNum}/${totalBatches} (${tldrBatch.length} items)...`,
      );

      try {
        const tldrResults = await generateTLDRBatch(tldrBatch, activeModel);

        // 3. Применяем TLDR к постам
        batch.forEach((post) => {
          const tldr = tldrResults.tldrs[post.id];
          if (tldr) {
            post.tldr_ru = tldr;
            totalGenerated++;
          } else {
            console.warn(`[TLDR] No TLDR for post ${post.id} (${post.name})`);
          }
        });

        // 4. Логируем расходы
        const totalTokens = tldrResults.usage.prompt_tokens + tldrResults.usage.completion_tokens;
        totalCost += tldrResults.usage.total_cost;

        addExecutionLog(
          `Batch ${batchNum}/${totalBatches}: ${Object.keys(tldrResults.tldrs).length}/${
            tldrBatch.length
          } TLDRs, ${totalTokens} tokens, $${tldrResults.usage.total_cost.toFixed(5)}`,
        );

        await posts.logLLMUsage({
          ...tldrResults.usage,
          post_id: `TLDR_BATCH_${batchNum}_${Date.now()}`,
          items_count: tldrBatch.length,
        });

        // Пауза между батчами
        if (i + TLDR_BATCH_SIZE < newPosts.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (err) {
        addExecutionLog(`Error in batch ${batchNum}: ${err}`);
        console.error('[TLDR] Batch error:', err);
      }
    }

    addExecutionLog(
      `TLDR complete: ${totalGenerated}/${newPosts.length} generated, cost: $${totalCost.toFixed(
        5,
      )}`,
    );

    // 5. Сохраняем только НОВЫЕ посты в базу данных
    try {
      addExecutionLog(`Attempting to insert ${newPosts.length} new posts...`);
      await posts.upsertMany(newPosts);
      addExecutionLog(`Successfully added ${newPosts.length} new posts to database`);
    } catch (err) {
      addExecutionLog(`Error inserting posts: ${err}`);
      console.error('Insert error details:', err);
    }
  } else {
    addExecutionLog('No new posts to process. Database is up to date.');
  }
}
