/**
 * @file db.ts
 * @description Слой работы с базой данных (Supabase). Управляет запросами, сохранением (upsert) и фильтрацией контента.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Post, LLMUsage } from './types.js';
import { SUPABASE, LIMITS, SCORING } from './config.js';
import { isValidPost } from './validators.js';
import { normalizeUrl } from './utils.js';

function getClient(): SupabaseClient {
  return createClient(SUPABASE.URL, SUPABASE.ANON_KEY, {
    auth: {
      persistSession: false,
    },
  });
}

function getServiceRoleClient(): SupabaseClient {
  return createClient(SUPABASE.URL, SUPABASE.SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
    },
  });
}

/**
 * Алгоритм скоринга на основе популярности и времени (Gravity Score).
 * Позволяет свежим постам подниматься выше старых, даже если у них меньше звезд.
 * Формула: Score = BaseScore / (Hours + 2)^Gravity
 */
export function scorePost(post: Post): number {
  // 1. Веса источников (Source Multiplier)
  const sourceWeights: Record<string, number> = {
    github: 1.8,
    hackernews: 1.1,
    huggingface: 1.1,
    reddit: 0.8,
    replicate: 0.6,
  };
  const weight = sourceWeights[post.source] || 1.0;

  // 2. Расчет базовых очков (Base Points) с препроцессингом
  let points = Number(post.stars) || 0;

  // Препроцессинг Replicate: делим на 100, чтобы уравнять с другими источниками
  if (post.source === 'replicate') {
    points = points / 100;
  }

  // Специальная логика для Hacker News (Учет дискуссий)
  if (post.source === 'hackernews') {
    let comments = Number((post as any).comments_count) || 0;

    // Если comments_count нет (пост из БД), пытаемся достать из description
    if (comments === 0 && post.description) {
      const match = post.description.match(/\|\s*(\d+)\s*comments/);
      if (match) {
        comments = Number(match[1]);
      }
    }

    points = points + Math.log10(comments + 1) * 2;
  }

  // 3. Считаем время в часах (Age)
  const createdDate = new Date(post.created_at);
  const hoursAge = Math.max(0, (Date.now() - createdDate.getTime()) / (1000 * 60 * 60));

  // 4. Расчет VelocityBonus (Скорость роста)
  let velocityBonus = 1.0;
  // Бонус применяется только к свежим новостям (моложе 12 часов)
  if (hoursAge < 12 && post.metrics_history && post.metrics_history.length > 1) {
    const now = Date.now();
    const threeHoursAgo = now - 3 * 60 * 60 * 1000;
    const pastEntry = post.metrics_history.find((h) => h.ts >= threeHoursAgo) || post.metrics_history[0];

    if (pastEntry && pastEntry.score < post.stars) {
      const growth = post.stars - pastEntry.score;
      if (growth > pastEntry.score * 0.1) velocityBonus = 1.5;
    }
  }

  // 5. Итоговая формула (Gravity inside Log)
  // EffectivePoints = Points / (Age + 2)^Gravity
  const gravity = 1.2;
  const effectivePoints = points / Math.pow(hoursAge + 2, gravity);
  
  // Применяем логарифм к уже "затухшим" очкам
  const finalScore = Math.log10(effectivePoints + 1) * weight * velocityBonus;

  // Возвращаем sc0re (умножаем на 100 для читаемости в UI)
  return finalScore * 100;
}

export type FilterType = 'past_day' | 'past_three_days' | 'past_week';

function getFromDate(filter: FilterType): Date {
  const now = new Date();
  const fromDate = new Date();
  if (filter === 'past_day') fromDate.setDate(now.getDate() - 1);
  else if (filter === 'past_three_days') fromDate.setDate(now.getDate() - 3);
  else fromDate.setDate(now.getDate() - 7);
  return fromDate;
}

export const posts = {
  /**
   * Вспомогательная функция для скоринга постов (экспортирована для использования в других модулях)
   */
  scorePost,

  async query(options: { filter: FilterType; sources: string[] }): Promise<Post[]> {
    const client = getClient();
    const fromDate = getFromDate(options.filter);
    const sourcesLower = options.sources.map((s) => s.toLowerCase());

    const { data, error } = await client
      .from('repositories')
      .select('*')
      .order('stars', { ascending: false })
      .limit(LIMITS.POSTS_QUERY_LIMIT)
      .in('source', sourcesLower)
      .gt('created_at', fromDate.toISOString())
      .gt('inserted_at', fromDate.toISOString());

    if (error) throw new Error(`Database error: ${error.message}`);

    const filtered = (data || []).filter(isValidPost);
    filtered.sort((a, b) => scorePost(b) - scorePost(a));
    return filtered;
  },

  async upsertMany(posts: Post[]): Promise<void> {
    const client = getServiceRoleClient();

    // 1. Получаем текущие метрики для этих постов, чтобы обновить историю
    const ids = posts.map((p) => p.id);
    const { data: existingItems } = await client
      .from('repositories')
      .select('id, metrics_history, tldr_ru, embedding')
      .in('id', ids);

    const historyMap = new Map(existingItems?.map((i) => [i.id, i.metrics_history || []]) || []);
    const existingDataMap = new Map(existingItems?.map((i) => [i.id, i]) || []);

    const dataToUpsert = posts.map((post) => {
      const currentHistory = historyMap.get(post.id) || [];
      const existingData = existingDataMap.get(post.id);
      const newEntry = { ts: Date.now(), score: post.stars };

      // Ограничиваем историю последними 100 записями, чтобы JSON не раздувался
      const updatedHistory = [...currentHistory, newEntry].slice(-100);

      return {
        id: post.id,
        source: post.source,
        username: post.username,
        name: post.name,
        description: post.description,
        tldr_ru: post.tldr_ru || existingData?.tldr_ru || null,
        stars: post.stars,
        url: post.url,
        created_at: post.created_at,
        metrics_history: updatedHistory,
        embedding: post.embedding || existingData?.embedding || null,
      };
    });

    console.log(`[DB] Upserting ${dataToUpsert.length} rows with metrics history...`);

    const { data, error } = await client
      .from('repositories')
      .upsert(dataToUpsert, { onConflict: 'id,source' })
      .select();

    if (error) {
      console.error(`[DB] Upsert error:`, JSON.stringify(error));
      throw new Error(`Database error upserting posts: ${error.message}`);
    }

    console.log(`[DB] Upsert success. Rows affected: ${data?.length || 0}`);
  },

  /**
   * Сохранение логов использования LLM
   */
  async logLLMUsage(usage: LLMUsage): Promise<void> {
    const client = getServiceRoleClient();
    const { error } = await client.from('llm_usage').insert({
      model_id: usage.model_id,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_cost: usage.total_cost,
      post_id: usage.post_id,
      items_count: usage.items_count || 0,
    });
    if (error) console.error(`Error logging LLM usage: ${error.message}`);
  },

  /**
   * Получение последних логов использования LLM
   */
  async getLLMLogs(limit: number = 10) {
    const client = getServiceRoleClient();
    const { data, error } = await client
      .from('llm_usage')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error(`[DB] Error fetching LLM logs:`, error);
      throw new Error(`Error fetching logs: ${error.message}`);
    }
    return data;
  },

  /**
   * Получение статистики расходов
   */
  async getStats(days: number = 30) {
    const client = getServiceRoleClient();
    const { data, error } = await client.rpc('get_llm_stats', { days_limit: days });
    if (error) {
      console.error(`[DB] Error fetching LLM stats:`, error);
      throw new Error(`Error fetching stats: ${error.message}`);
    }
    return data;
  },

  /**
   * Получение сырых логов за период для агрегации
   */
  async getAggregatedLogs(days: number = 30) {
    const client = getServiceRoleClient();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    
    const { data, error } = await client
      .from('llm_usage')
      .select('*')
      .gt('created_at', fromDate.toISOString())
      .order('created_at', { ascending: false });
      
    if (error) {
      console.error('[DB] Error fetching aggregated logs:', error);
      return [];
    }
    return data;
  },

  /**
   * Получение активной модели LLM из конфигурации
   */
  async getActiveModel(): Promise<string> {
    const client = getClient();
    const { data } = await client
      .from('app_config')
      .select('value')
      .eq('key', 'active_llm_model')
      .single();
    return data?.value || 'openai/gpt-4o-mini';
  },

  /**
   * Сохранение активной модели LLM в конфигурацию
   */
  async setActiveModel(modelId: string): Promise<void> {
    const client = getServiceRoleClient();
    const { error } = await client
      .from('app_config')
      .upsert({ key: 'active_llm_model', value: modelId }, { onConflict: 'key' });
    if (error) throw new Error(`Error setting active model: ${error.message}`);
  },

  /**
   * Сохранение состояния последнего сгенерированного дайджеста (контент + кластеры)
   */
  async saveLastDigest(state: { content: string; clusters: any[] }): Promise<void> {
    const client = getServiceRoleClient();
    // Supabase app_config value is text, so we stringify
    const { error } = await client
      .from('app_config')
      .upsert({ key: 'last_digest_state', value: JSON.stringify(state) }, { onConflict: 'key' });
    if (error) console.error(`Error saving last digest state: ${error.message}`);
  },

  /**
   * Получение состояния последнего сгенерированного дайджеста
   */
  async getLastDigest(): Promise<{ content: string; clusters: any[]; usage?: any } | null> {
    const client = getServiceRoleClient(); // Используем Service Role для обхода RLS
    const { data } = await client
      .from('app_config')
      .select('value')
      .eq('key', 'last_digest_state')
      .single();
    
    if (!data?.value) return null;
    try {
      return JSON.parse(data.value);
    } catch (e) {
      console.error('Error parsing last digest state:', e);
      return null;
    }
  },

  /**
   * Получение значения из app_config
   */
  async getAppConfig(key: string): Promise<string | null> {
    const client = getServiceRoleClient();
    const { data } = await client
      .from('app_config')
      .select('value')
      .eq('key', key)
      .single();
    return data?.value || null;
  },

  /**
   * Сохранение значения в app_config
   */
  async setAppConfig(key: string, value: string): Promise<void> {
    const client = getServiceRoleClient();
    const { error } = await client
      .from('app_config')
      .upsert({ key, value }, { onConflict: 'key' });
    if (error) throw new Error(`Error setting config ${key}: ${error.message}`);
  },

  async getLastUpdated(): Promise<string | null> {
    const client = getClient();
    const { data } = await client.rpc('repositories_last_modified');
    return data || null;
  },

  /**
   * Проверка наличия ID постов в базе данных.
   * Используется для исключения повторного перевода уже существующих записей.
   */
  async getExistingIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const client = getClient();
    const { data, error } = await client.from('repositories').select('id').in('id', ids);

    if (error) throw new Error(`Database error checking existing IDs: ${error.message}`);
    return new Set((data || []).map((item) => item.id));
  },

  /**
   * Получение постов по списку ID.
   */
  async queryByIds(ids: string[]): Promise<Post[]> {
    if (ids.length === 0) return [];
    const client = getClient();
    const { data, error } = await client.from('repositories').select('*').in('id', ids);
    if (error) throw new Error(`Database error querying by IDs: ${error.message}`);
    return data || [];
  },

  /**
   * Получение всех постов без TLDR (для backfill скрипта)
   */
  async getPostsWithoutTLDR(limit: number = 1000): Promise<Post[]> {
    const client = getClient();
    const { data, error } = await client
      .from('repositories')
      .select('*')
      .is('tldr_ru', null)
      .order('inserted_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Database error querying posts without TLDR: ${error.message}`);
    console.log(`[DB] Found ${data?.length || 0} posts without TLDR`);
    return data || [];
  },

  /**
   * Получение истории опубликованных сюжетов за последние N часов.
   */
  async getDigestHistory(hours: number = 36): Promise<{ embedding: number[] }[]> {
    const client = getClient();
    const fromDate = new Date();
    fromDate.setHours(fromDate.getHours() - hours);

    const { data, error } = await client
      .from('digest_history')
      .select('embedding')
      .gt('published_at', fromDate.toISOString());

    if (error) {
      console.error('[DB] Error fetching digest history:', error);
      return [];
    }

    return (data || []).map((item) => ({
      embedding:
        typeof item.embedding === 'string' ? JSON.parse(item.embedding) : item.embedding,
    }));
  },

  /**
   * Сохранение опубликованных сюжетов в историю.
   */
  async addToDigestHistory(items: { topic_summary: string; embedding: number[] }[]): Promise<void> {
    const client = getServiceRoleClient();
    const { error } = await client.from('digest_history').insert(items);
    if (error) console.error('[DB] Error adding to digest history:', error);
  },

  /**
   * Получение кластеризованных постов (Сюжетов).
   * Группирует семантически похожие посты в один объект.
   */
  async queryClustered(options: { filter: FilterType; sources: string[] }): Promise<any[]> {
    // 1. Получаем обычный список постов
    const allPosts = await this.query(options);
    if (allPosts.length === 0) return [];

    const clusters: any[] = [];
    const processedIds = new Set<string>();

    // 2. Жадный алгоритм кластеризации (Greedy Clustering)
    for (const post of allPosts) {
      if (processedIds.has(post.id)) continue;

      const cluster = {
        id: post.id,
        mainPost: post,
        relatedPosts: [] as Post[],
        totalScore: scorePost(post),
      };

      processedIds.add(post.id);

      // 3. Ищем похожие посты среди ОСТАЛЬНЫХ (уже загруженных)
      // Мы не делаем запрос к БД для каждого поста, а сравниваем в памяти для скорости
      for (const otherPost of allPosts) {
        if (processedIds.has(otherPost.id)) continue;

        let isRelated = false;

        // Проверка по эмбеддингам
        if (post.embedding && otherPost.embedding) {
          const similarity = cosineSimilarity(post.embedding, otherPost.embedding);
          if (similarity > 0.85) isRelated = true;
        }

        // Проверка по URL (если эмбеддинги не сработали или их нет)
        if (!isRelated && post.url && otherPost.url) {
          if (normalizeUrl(post.url) === normalizeUrl(otherPost.url)) {
            isRelated = true;
          }
        }

        if (isRelated) {
          cluster.relatedPosts.push(otherPost);
          cluster.totalScore += scorePost(otherPost) * 0.2; // Бонус за дублирование в разных источниках
          processedIds.add(otherPost.id);
        }
      }

      clusters.push(cluster);
    }

    // Сортируем кластеры по итоговому скору
    return clusters.sort((a, b) => b.totalScore - a.totalScore);
  },
};

/**
 * Вспомогательная функция для расчета косинусного сходства векторов
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
