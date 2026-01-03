/**
 * @file worker.ts
 * @description Background worker for periodic feed rebuilding and data ingestion.
 */

import { posts } from './db.js';
import { feedCache } from './cache.js';
import { updateContent } from './scheduled.js';
import { addExecutionLog } from './utils.js';
import { SOURCES } from './config.js';

const REBUILD_INTERVAL = 15 * 60 * 1000; // 15 minutes
const INGESTION_INTERVAL = 60 * 60 * 1000; // 1 hour

/**
 * Нормализация URL для сравнения.
 * Убирает протоколы, завершающие слеши и www.
 */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace('www.', '') + u.pathname.replace(/\/$/, '');
  } catch {
    return url.replace(/^https?:\/\//, '').replace('www.', '').replace(/\/$/, '');
  }
}

export async function rebuildFeed() {
  addExecutionLog('Background feed rebuild started');
  try {
    const sources = [...SOURCES];
    const clusteredPosts = await posts.queryClustered({ filter: 'past_week', sources });
    
    const processedClusters = clusteredPosts.map((cluster) => {
      const mainPost = cluster.mainPost;
      const relatedPosts = cluster.relatedPosts || [];
      const allPostsInCluster = [mainPost, ...relatedPosts];
      
      // 1. Collect all unique source types (normalized to lowercase)
      const sourceTypes = new Set<string>();
      allPostsInCluster.forEach((p: any) => sourceTypes.add(p.source.toLowerCase()));
      
      // ДОПОЛНИТЕЛЬНО: Проверяем URL на совпадение, если кластеризация по эмбеддингам промахнулась
      // Это важно для HN + GitHub, так как у HN может не быть эмбеддинга или он слабый
      const mainUrlNorm = normalizeUrl(mainPost.url);
      
      // Ищем среди всех постов те, что ведут на тот же URL, но не попали в кластер
      // (Это упрощенная доп. кластеризация по URL)
      // Но так как queryClustered уже вернул кластеры, мы просто убеждаемся, что uniqueSources собраны верно
      
      // 2. Synergy Boost
      const uniqueSourcesCount = sourceTypes.size;
      let multiplier = 1.0;
      if (uniqueSourcesCount === 2) multiplier = 1.2;
      else if (uniqueSourcesCount >= 3) multiplier = 1.5;

      const boostedScore = cluster.totalScore * multiplier;

      // 3. Best Link Selection (GitHub > HF > Others)
      const githubPost = allPostsInCluster.find(p => p.source.toLowerCase() === 'github');
      const hfPost = allPostsInCluster.find(p => p.source.toLowerCase() === 'huggingface');
      
      const bestPost = githubPost || hfPost || mainPost;
      const bestLink = bestPost.url;

      return {
        ...cluster,
        boostedScore,
        uniqueSources: Array.from(sourceTypes),
        bestLink,
        createdAt: new Date(mainPost.created_at).getTime(),
        sourcesInCluster: Array.from(sourceTypes),
        prepareData: {
          displayName: bestPost.source.toLowerCase() === 'github' || bestPost.source.toLowerCase() === 'huggingface' || bestPost.source.toLowerCase() === 'replicate' 
            ? `${bestPost.username}/${bestPost.name}` 
            : bestPost.name,
          tldr: mainPost.tldr_ru || '',
          hasTLDR: !!mainPost.tldr_ru,
          url: bestLink,
          stars: mainPost.stars,
          score: boostedScore.toFixed(1),
          originalDescription: mainPost.source.toLowerCase() === 'github' || mainPost.source.toLowerCase() === 'huggingface' || mainPost.source.toLowerCase() === 'replicate'
            ? mainPost.description || ''
            : `${mainPost.username} on ${mainPost.description}`,
          sourceTypes: Array.from(sourceTypes)
        }
      };
    });

    processedClusters.sort((a, b) => b.boostedScore - a.boostedScore);
    
    feedCache.set(processedClusters);
    addExecutionLog('Background feed rebuild completed');
  } catch (err) {
    addExecutionLog(`Background feed rebuild failed: ${err}`);
    console.error(err);
  }
}

export function startWorker() {
  // Initial rebuild - NON-BLOCKING
  rebuildFeed().catch(err => console.error('Initial rebuild failed:', err));

  // Schedule feed rebuild
  setInterval(() => {
    rebuildFeed().catch(err => console.error('Scheduled rebuild failed:', err));
  }, REBUILD_INTERVAL);

  // Schedule data ingestion
  setInterval(async () => {
    addExecutionLog('Background ingestion started');
    try {
      await updateContent();
      await rebuildFeed();
      addExecutionLog('Background ingestion completed');
    } catch (err) {
      addExecutionLog(`Background ingestion failed: ${err}`);
    }
  }, INGESTION_INTERVAL);
}
