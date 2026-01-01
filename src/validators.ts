/**
 * @file validators.ts
 * @description Централизованная валидация данных.
 * Все функции валидации собраны в одном месте для удобства управления и тестирования.
 */

import type { Post } from './types.js';
import { BANNED_STRINGS } from './config.js';

/**
 * Проверка валидности поста
 * @param post - Пост для проверки
 * @returns true если пост валиден, false если нет
 */
export function isValidPost(post: Post): boolean {
  const name = post.name?.toLowerCase() || '';
  const desc = post.description?.toLowerCase() || '';

  // Проверка наличия username
  if (!post.username?.trim()) {
    return false;
  }

  // Проверка черного списка
  for (const bannedString of BANNED_STRINGS) {
    if (name.includes(bannedString) || desc.includes(bannedString)) {
      return false;
    }
  }

  // Специальная проверка для stake + predict
  if (name.includes('stake') && name.includes('predict')) {
    return false;
  }

  return true;
}

/**
 * Валидация email адреса
 * @param email - Email для проверки
 * @returns true если email валиден
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Валидация URL
 * @param url - URL для проверки
 * @returns true если URL валиден
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Валидация строки (не пустая, не только пробелы)
 * @param str - Строка для проверки
 * @param minLength - Минимальная длина (по умолчанию 1)
 * @param maxLength - Максимальная длина (опционально)
 * @returns true если строка валидна
 */
export function isValidString(
  str: string | null | undefined,
  minLength: number = 1,
  maxLength?: number,
): boolean {
  if (!str || typeof str !== 'string') {
    return false;
  }

  const trimmed = str.trim();

  if (trimmed.length < minLength) {
    return false;
  }

  if (maxLength && trimmed.length > maxLength) {
    return false;
  }

  return true;
}

/**
 * Валидация числа в диапазоне
 * @param num - Число для проверки
 * @param min - Минимальное значение (опционально)
 * @param max - Максимальное значение (опционально)
 * @returns true если число валидно
 */
export function isValidNumber(num: number | null | undefined, min?: number, max?: number): boolean {
  if (typeof num !== 'number' || isNaN(num)) {
    return false;
  }

  if (min !== undefined && num < min) {
    return false;
  }

  if (max !== undefined && num > max) {
    return false;
  }

  return true;
}

/**
 * Валидация даты
 * @param date - Дата для проверки (строка или объект Date)
 * @returns true если дата валидна
 */
export function isValidDate(date: string | Date | null | undefined): boolean {
  if (!date) {
    return false;
  }

  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return dateObj instanceof Date && !isNaN(dateObj.getTime());
}

/**
 * Валидация API ключа
 * @param key - API ключ для проверки
 * @param minLength - Минимальная длина ключа (по умолчанию 10)
 * @returns true если ключ валиден
 */
export function isValidApiKey(key: string | null | undefined, minLength: number = 10): boolean {
  if (!key || typeof key !== 'string') {
    return false;
  }

  const trimmed = key.trim();

  // Проверка минимальной длины
  if (trimmed.length < minLength) {
    return false;
  }

  // Проверка что это не дефолтное значение
  const invalidDefaults = ['your-api-key', 'api-key-here', 'xxx', 'test', 'demo'];
  if (invalidDefaults.includes(trimmed.toLowerCase())) {
    return false;
  }

  return true;
}

/**
 * Валидация источника новостей
 * @param source - Источник для проверки
 * @returns true если источник валиден
 */
export function isValidSource(source: string): boolean {
  const validSources = ['github', 'huggingface', 'reddit', 'replicate'];
  return validSources.includes(source.toLowerCase());
}

/**
 * Валидация фильтра времени
 * @param filter - Фильтр для проверки
 * @returns true если фильтр валиден
 */
export function isValidTimeFilter(filter: string): boolean {
  const validFilters = ['past_day', 'past_three_days', 'past_week'];
  return validFilters.includes(filter);
}

/**
 * Санитизация строки (удаление опасных символов)
 * @param str - Строка для санитизации
 * @returns Санитизированная строка
 */
export function sanitizeString(str: string): string {
  if (!str) return '';

  return str
    .replace(/[<>]/g, '') // Удаляем < и >
    .replace(/javascript:/gi, '') // Удаляем javascript:
    .replace(/on\w+=/gi, '') // Удаляем обработчики событий
    .trim();
}

/**
 * Валидация объекта Post
 * @param post - Объект для проверки
 * @returns Объект с результатом валидации и списком ошибок
 */
export function validatePost(post: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!isValidString(post.id)) {
    errors.push('Invalid or missing id');
  }

  if (!isValidSource(post.source)) {
    errors.push('Invalid or missing source');
  }

  if (!isValidString(post.username)) {
    errors.push('Invalid or missing username');
  }

  if (!isValidString(post.name)) {
    errors.push('Invalid or missing name');
  }

  if (!isValidNumber(post.stars, 0)) {
    errors.push('Invalid stars count');
  }

  if (!isValidUrl(post.url)) {
    errors.push('Invalid URL');
  }

  if (!isValidDate(post.created_at)) {
    errors.push('Invalid created_at date');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Валидация переменных окружения
 * @param env - Объект с переменными окружения
 * @returns Объект с результатом валидации и списком ошибок
 */
export function validateEnvironment(env: Record<string, string | undefined>): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Обязательные переменные
  if (!isValidUrl(env.SUPABASE_URL || '')) {
    errors.push('SUPABASE_URL is not set or invalid');
  }

  if (!isValidApiKey(env.SUPABASE_ANON_KEY)) {
    errors.push('SUPABASE_ANON_KEY is not set or invalid');
  }

  if (!isValidApiKey(env.SUPABASE_SERVICE_ROLE_KEY)) {
    errors.push('SUPABASE_SERVICE_ROLE_KEY is not set or invalid');
  }

  // Опциональные но рекомендуемые
  if (!isValidApiKey(env.OPENROUTER_API_KEY)) {
    warnings.push('OPENROUTER_API_KEY is not set - translations will not work');
  }

  if (!isValidApiKey(env.REPLICATE_API_TOKEN)) {
    warnings.push('REPLICATE_API_TOKEN is not set - Replicate fetcher will not work');
  }

  if (!isValidString(env.ADMIN_USER, 3) || env.ADMIN_USER === 'admin') {
    warnings.push('ADMIN_USER is not set or using default value');
  }

  if (!isValidString(env.ADMIN_PASS, 8) || env.ADMIN_PASS === 'admin') {
    warnings.push('ADMIN_PASS is not set or using weak default value');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
