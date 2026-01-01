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

  // Временный лимит 150 топовых постов
  const limitedPosts = allFetchedPosts.slice(0, 150);
  const activeModel = await posts.getActiveModel();

  addExecutionLog(
    `Total posts fetched from APIs: ${allFetchedPosts.length}. Processing top 150 by score.`,
  );

  // 1. Фильтруем дубликаты на входе: оставляем только те посты, которых НЕТ в базе данных
  const existingIds = await posts.getExistingIds(limitedPosts.map((p) => p.id));
  const newPosts = limitedPosts.filter((p) => !existingIds.has(p.id));

  addExecutionLog(`New unique posts identified: ${newPosts.length}`);

  if (newPosts.length > 0) {
    // 2. Группируем только НОВЫЕ посты для пакетного перевода (исключаем HuggingFace)
    const repoBatch = newPosts
      .filter((p) => (p.source === 'github' || p.source === 'replicate') && p.description)
      .map((p) => ({ id: p.id, text: p.description }));

    const redditBatch = newPosts
      .filter((p) => p.source === 'reddit')
      .map((p) => ({ id: p.id, text: p.name }));

    if (repoBatch.length > 0 || redditBatch.length > 0) {
      addExecutionLog(
        `Starting batch translation for ${repoBatch.length + redditBatch.length} items...`,
      );

      const nerdPromptRepo = `ТЫ - ОПЫТНЫЙ ML-ИНЖЕНЕР И ГИК. Переведи описание IT-проекта на русский язык в профессиональной, технической манере. 
      ПРАВИЛА:
      1. Используй правильный сленг: "деплой", "бандл", "инференс", "реверс-инжиниринг", "файнтюн", "эмбеддинги".
      2. Термин "weights" переводи как "веса".
      3. НЕ ПЕРЕВОДИ фундаментальные термины и типы моделей: "attention", "transformer", "token", "text-to-image", "image-to-video", "LLM".
      4. НЕ ОСТАВЛЯЙ АНГЛИЙСКИЙ ТЕКСТ, кроме терминов.`;

      const nerdPromptReddit = `ТЫ - ГИК И ТЕХНО-ЭНТУЗИАСТ. Переведи заголовок новости AI/ML на русский язык. 
      ПРАВИЛА:
      1. Стиль должен быть дерзким, техническим и точным.
      2. Используй сленг: "файнтюн", "эмбеддинги", "веса", "реверс-инжиниринг".
      3. НЕ ПЕРЕВОДИ фундаментальные термины и типы моделей: "attention", "transformer", "inference", "text-to-image", "LLM".
      4. НЕ ОСТАВЛЯЙ АНГЛИЙСКИЙ ТЕКСТ, кроме терминов.`;

      const [repoTranslations, redditTranslations] = await Promise.all([
        translateBatch(repoBatch, nerdPromptRepo, activeModel),
        translateBatch(redditBatch, nerdPromptReddit, activeModel),
      ]);

      // 3. Сопоставляем результаты перевода только для новых постов
      newPosts.forEach((post) => {
        const translatedDesc = repoTranslations.translations[post.id];
        const translatedName = redditTranslations.translations[post.id];

        if (translatedDesc) post.description_ru = translatedDesc;
        if (translatedName) post.name_ru = translatedName;
      });

      // 4. Логируем расходы
      const logUsage = async (batchResult: any, count: number) => {
        if (count > 0) {
          const totalTokens = batchResult.usage.prompt_tokens + batchResult.usage.completion_tokens;
          addExecutionLog(
            `LLM Response: ${totalTokens} tokens used. Cost: $${batchResult.usage.total_cost.toFixed(
              5,
            )}`,
          );
          await posts.logLLMUsage({ ...batchResult.usage, post_id: `BATCH_${Date.now()}` });
        }
      };

      await Promise.all([
        logUsage(repoTranslations, repoBatch.length),
        logUsage(redditTranslations, redditBatch.length),
      ]);
    }

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
