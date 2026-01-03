/**
 * @file cache.ts
 * @description In-memory cache for the feed to ensure zero-latency performance.
 */

export interface CachedFeed {
  clusters: any[];
  lastUpdated: number;
}

class FeedCache {
  private static instance: FeedCache;
  private cache: CachedFeed | null = null;

  private constructor() {}

  public static getInstance(): FeedCache {
    if (!FeedCache.instance) {
      FeedCache.instance = new FeedCache();
    }
    return FeedCache.instance;
  }

  public set(clusters: any[]): void {
    this.cache = {
      clusters,
      lastUpdated: Date.now(),
    };
  }

  public get(): CachedFeed | null {
    return this.cache;
  }

  public clear(): void {
    this.cache = null;
  }
}

export const feedCache = FeedCache.getInstance();
