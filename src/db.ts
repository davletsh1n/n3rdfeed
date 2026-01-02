/**
 * @file db.ts
 * @description Слой работы с базой данных (Supabase). Управляет запросами, сохранением (upsert) и фильтрацией контента.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Post, LLMUsage } from './types.js';
import { SUPABASE, LIMITS, SCORING } from './config.js';
import { isValidPost } from './validators.js';

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
  // 1. Определяем базовый вес (нормализация разных источников)
  let baseScore = post.stars;
  if (post.source === 'reddit') baseScore = post.stars * 5; // 1 апвоут Reddit ~ 5 звезд GitHub
  if (post.source === 'replicate') baseScore = post.stars * 0.5; // 1 запуск Replicate ~ 0.5 звезды
  if (post.source === 'hackernews') baseScore = post.stars * 4; // 1 балл HN ~ 4 звезды GitHub

  // 2. Считаем время в часах с момента создания
  const createdDate = new Date(post.created_at);
  const now = new Date();
  const hoursAge = Math.max(0, (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60));

  // 3. Применяем затухание (Gravity)
  // Коэффициент 1.8 — стандарт для Hacker News, делает затухание довольно быстрым
  const gravity = 1.8;
  const finalScore = baseScore / Math.pow(hoursAge + 2, gravity);

  return finalScore;
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
    const dataToUpsert = posts.map((post) => ({
      id: post.id,
      source: post.source,
      username: post.username,
      name: post.name,
      name_ru: post.name_ru || null,
      description: post.description,
      description_ru: post.description_ru || null,
      tldr_ru: post.tldr_ru || null,
      stars: post.stars,
      url: post.url,
      created_at: post.created_at,
    }));

    console.log(`[DB] Upserting ${dataToUpsert.length} rows to 'repositories' table...`);

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
};
