import { posts } from '../db.js';
import { generateDigest } from './llm.js';
import { categorizePost, cosineSimilarity } from '../utils.js';

export async function createDigest(force: boolean = false) {
  // 1. Получаем кластеры за последние 24 часа
  const clusters = await posts.queryClustered({
    filter: 'past_day',
    sources: ['GitHub', 'HuggingFace', 'Reddit', 'HackerNews', 'Replicate'],
  });

  let uniqueClusters = clusters;

  // 2. Temporal Deduplication: фильтруем то, что уже публиковали за 36 часов (если не force)
  if (!force) {
    const history = await posts.getDigestHistory(36);
    uniqueClusters = clusters.filter((cluster) => {
      if (!cluster.mainPost.embedding) return true;

      const maxSimilarity =
        history.length > 0
          ? Math.max(
              ...history.map((h) =>
                cosineSimilarity(h.embedding, cluster.mainPost.embedding),
              ),
            )
          : 0;

      return maxSimilarity < 0.85; // Порог уникальности 85%
    });
  }

  // 3. Diversity Filter: отбираем топ-8 кластеров с учетом разнообразия
  const topClusters: any[] = [];
  const categoryCounts: Record<string, number> = {};
  const MAX_PER_CATEGORY = 3;

  for (const cluster of uniqueClusters) {
    if (topClusters.length >= 8) break;

    const category = categorizePost(cluster.mainPost);
    const count = categoryCounts[category] || 0;

    if (count < MAX_PER_CATEGORY) {
      topClusters.push(cluster);
      categoryCounts[category] = count + 1;
    }
  }

  if (topClusters.length === 0) {
    return null;
  }

  // 4. Генерируем дайджест
  const digest = await generateDigest(topClusters, 'anthropic/claude-3.5-sonnet');

  return {
    content: digest.content,
    usage: digest.usage,
    clusters: topClusters,
  };
}
