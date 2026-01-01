/**
 * Скрипт для генерации TLDR для существующих постов в БД
 * Используется для обновления старых постов, которые были добавлены до внедрения системы TLDR
 */

import { config } from 'dotenv';
import { posts } from '../src/db.js';
import { generateTLDRBatch } from '../src/services/llm.js';

config();

async function main() {
  console.log('[Script] Starting TLDR generation for existing posts...');

  try {
    // Получаем активную модель
    const activeModel = await posts.getActiveModel();
    console.log(`[Script] Using model: ${activeModel}`);

    // Получаем все посты без TLDR
    const postsWithoutTLDR = await posts.getPostsWithoutTLDR(1000);

    console.log(`[Script] Found ${postsWithoutTLDR.length} posts without TLDR`);

    if (postsWithoutTLDR.length === 0) {
      console.log('[Script] All posts already have TLDR. Nothing to do.');
      process.exit(0);
    }

    // Обрабатываем батчами по 50 постов
    const batchSize = 50;
    let totalGenerated = 0;

    for (let i = 0; i < postsWithoutTLDR.length; i += batchSize) {
      const batch = postsWithoutTLDR.slice(i, i + batchSize);

      console.log(
        `[Script] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
          postsWithoutTLDR.length / batchSize,
        )}...`,
      );

      const tldrBatch = batch.map((p: any) => ({
        id: p.id,
        title: p.name,
        description: p.description || '',
        source: p.source,
      }));

      try {
        const tldrResults = await generateTLDRBatch(tldrBatch, activeModel);

        // Применяем TLDR к постам
        batch.forEach((post: any) => {
          const tldr = tldrResults.tldrs[post.id];
          if (tldr) {
            post.tldr_ru = tldr;
            totalGenerated++;
          }
        });

        // Сохраняем обновленные посты
        await posts.upsertMany(batch);

        console.log(
          `[Script] Batch complete. Generated ${Object.keys(tldrResults.tldrs).length} TLDRs`,
        );
        console.log(`[Script] Cost: $${tldrResults.usage.total_cost.toFixed(5)}`);

        // Логируем использование
        await posts.logLLMUsage({
          ...tldrResults.usage,
          post_id: `TLDR_BACKFILL_${Date.now()}`,
          items_count: batch.length,
        });

        // Пауза между батчами чтобы не превысить rate limit
        if (i + batchSize < postsWithoutTLDR.length) {
          console.log('[Script] Waiting 2 seconds before next batch...');
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (err) {
        console.error(`[Script] Error processing batch:`, err);
        // Продолжаем со следующим батчем
      }
    }

    console.log(`[Script] Complete! Generated ${totalGenerated} TLDRs for existing posts`);
    process.exit(0);
  } catch (error) {
    console.error('[Script] Fatal error:', error);
    process.exit(1);
  }
}

main();
