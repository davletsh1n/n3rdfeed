/**
 * @file types.ts
 * @description Определение основных интерфейсов данных проекта.
 * @inputs -
 * @outputs Экспортирует интерфейс Post и вспомогательные типы.
 */

import type { Context } from 'hono';

export interface Post {
  id: string;
  source: string;
  username: string;
  name: string;
  name_ru?: string; // Переведенное название (для Reddit)
  stars: number;
  description: string;
  description_ru?: string; // Переведенное описание (для GitHub/Replicate)
  url: string;
  created_at: string;
}

/**
 * Интерфейс для записи логов использования LLM
 */
export interface LLMUsage {
  model_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_cost: number;
  post_id?: string;
}
