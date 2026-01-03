/**
 * @file worker.ts
 * @description Background worker for periodic feed rebuilding and data ingestion.
 */

import { posts } from './db.js';
import { feedCache } from './cache.js';
import { updateContent } from './scheduled.js';
import { addExecutionLog, normalizeUrl } from './utils.js';
import { SOURCES } from './config.js';

const REBUILD_INTERVAL = 15 * 60 * 1000; // 15 minutes
const INGESTION_INTERVAL = 60 * 60 * 1000; // 1 hour

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

      // FIX: Добавляем иконки репозиториев, если ссылка ведет на них, даже если источника нет в кластере
      if (bestLink.includes('github.com')) sourceTypes.add('github');
      if (bestLink.includes('huggingface.co')) sourceTypes.add('huggingface');
      if (bestLink.includes('replicate.com')) sourceTypes.add('replicate');

      // FIX: Улучшенное определение displayName для ссылок на репозитории
      let displayName = bestPost.name;
      const isRepoSource = ['github', 'huggingface', 'replicate'].includes(bestPost.source.toLowerCase());
      
      if (isRepoSource) {
        displayName = `${bestPost.username}/${bestPost.name}`;
      } else {
        // Пытаемся извлечь owner/repo из URL для HN/Reddit постов
        try {
          const urlObj = new URL(bestLink);
          if (urlObj.hostname.includes('github.com') || urlObj.hostname.includes('huggingface.co')) {
             const parts = urlObj.pathname.split('/').filter(Boolean);
             if (parts.length >= 2) {
               displayName = `${parts[0]}/${parts[1]}`;
             }
          }
        } catch {}
      }

      // 4. Spotted Links Generation
      const spottedLinksMap = new Map<string, string>();
      allPostsInCluster.forEach((p: any) => {
        const source = p.source.toLowerCase();
        let url = p.url;
        
        // Восстанавливаем ссылки на обсуждения
        if (source === 'hackernews' && p.id.startsWith('hn_')) {
           url = `https://news.ycombinator.com/item?id=${p.id.replace('hn_', '')}`;
        }
        
        if (!spottedLinksMap.has(source)) {
           spottedLinksMap.set(source, url);
        }
      });

      const spottedLinks = Array.from(spottedLinksMap.entries()).map(([name, url], idx, arr) => ({
        name: name === 'hackernews' ? 'Hacker News' : name.charAt(0).toUpperCase() + name.slice(1),
        url,
        last: idx === arr.length - 1
      }));

      return {
        ...cluster,
        boostedScore,
        uniqueSources: Array.from(sourceTypes),
        bestLink,
        createdAt: new Date(mainPost.created_at).getTime(),
        sourcesInCluster: Array.from(sourceTypes),
        prepareData: {
          displayName,
          tldr: mainPost.tldr_ru || '',
          hasTLDR: !!mainPost.tldr_ru,
          url: bestLink,
          stars: mainPost.stars,
          score: boostedScore.toFixed(1),
          originalDescription: isRepoSource
            ? mainPost.description || ''
            : `${mainPost.username} on ${mainPost.description}`,
          sourceTypes: Array.from(sourceTypes),
          spottedLinks
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
