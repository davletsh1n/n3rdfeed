/**
 * @file config.ts
 * @description Централизованная конфигурация приложения.
 * Все константы и настройки собраны в одном месте для удобства управления.
 */

// Загружаем dotenv в режиме разработки
if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
  try {
    const { config } = await import('dotenv');
    config();
  } catch (e) {
    // Игнорируем если dotenv не установлен
  }
}

/**
 * Источники новостей
 */
export const SOURCES = ['GitHub', 'Replicate', 'HuggingFace', 'Reddit'] as const;

export type Source = (typeof SOURCES)[number];

/**
 * Черный список слов для фильтрации постов
 */
export const BANNED_STRINGS = [
  'nft',
  'crypto',
  'telegram',
  'clicker',
  'solana',
  'stealer',
] as const;

/**
 * Лимиты и ограничения
 */
export const LIMITS = {
  /** Максимальное количество постов для обработки при обновлении */
  POSTS_PROCESSING_LIMIT: 250,

  /** Максимальное количество постов в одном запросе к БД */
  POSTS_QUERY_LIMIT: 500,

  /** Количество страниц GitHub для парсинга */
  GITHUB_PAGES_LIMIT: 5,

  /** Количество постов на странице GitHub */
  GITHUB_PER_PAGE: 100,

  /** Лимит моделей HuggingFace для парсинга */
  HUGGINGFACE_LIMIT: 5000,

  /** Лимит постов Reddit на сабреддит */
  REDDIT_LIMIT: 100,

  /** Лимит моделей Replicate для парсинга */
  REPLICATE_LIMIT: 1000,
} as const;

/**
 * Настройки аутентификации админ-панели
 */
export const AUTH = {
  /** Имя пользователя админа (из env или дефолт) */
  ADMIN_USER: process.env.ADMIN_USER || 'admin',

  /** Пароль админа (из env или дефолт) */
  ADMIN_PASS: process.env.ADMIN_PASS || 'admin',

  /** Realm для Basic Auth */
  REALM: 'N3RDFEED Admin',
} as const;

/**
 * Настройки Supabase
 * Автоматически переключается между prod и dev в зависимости от NODE_ENV
 */
const isDev = process.env.NODE_ENV !== 'production';

export const SUPABASE = {
  URL: isDev
    ? process.env.SUPABASE_URL_DEV || process.env.SUPABASE_URL || ''
    : process.env.SUPABASE_URL || '',

  ANON_KEY: isDev
    ? process.env.SUPABASE_ANON_KEY_DEV || process.env.SUPABASE_ANON_KEY || ''
    : process.env.SUPABASE_ANON_KEY || '',

  SERVICE_ROLE_KEY: isDev
    ? process.env.SUPABASE_SERVICE_ROLE_KEY_DEV || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    : process.env.SUPABASE_SERVICE_ROLE_KEY || '',
} as const;

/**
 * API ключи для внешних сервисов
 */
export const API_KEYS = {
  OPENROUTER: process.env.OPENROUTER_API_KEY || '',
  REPLICATE: process.env.REPLICATE_API_TOKEN || '',
  REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID || '',
  REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET || '',
} as const;

/**
 * Настройки фильтров времени
 */
export const TIME_FILTERS = {
  PAST_DAY: 1,
  PAST_THREE_DAYS: 3,
  PAST_WEEK: 7,
} as const;

/**
 * Настройки скоринга постов
 */
export const SCORING = {
  /** Множитель для Reddit постов */
  REDDIT_MULTIPLIER: 0.3,

  /** Степень для Replicate постов */
  REPLICATE_POWER: 0.6,
} as const;

/**
 * Сабреддиты для парсинга
 */
export const REDDIT_SUBREDDITS = ['machinelearning', 'localllama', 'StableDiffusion'] as const;

/**
 * Фильтры flair для Reddit
 */
export const REDDIT_FLAIR_FILTERS: Record<string, string[]> = {
  StableDiffusion: ['News', 'Resource | Update'],
} as const;

/**
 * Промпты для LLM
 */
export const LLM_PROMPTS = {
  /**
   * Промпт для генерации TLDR (краткого описания на русском)
   * Сухое фактологичное описание без домыслов и рекламы
   */
  TLDR_GENERATOR: `ТЫ - ТЕХНИЧЕСКИЙ РЕДАКТОР. Создай КРАТКОЕ описание на русском языке для каждого проекта/новости.

ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА:
1. Длина: 1-2 предложения, максимум 50 слов
2. Стиль: СУХО, ФАКТОЛОГИЧНО, только факты
3. ЗАПРЕЩЕНО: "отличное решение", "станет проще", "интересно", "рекомендую", любые оценки
4. Технические термины НЕ ПЕРЕВОДИТЬ: transformer, LLM, GPU, API, inference, fine-tuning, checkpoint
5. Названия проектов/библиотек НЕ ПЕРЕВОДИТЬ
6. Формат ответа: {"results": [{"id": "...", "tldr": "..."}]}
7. ВАЖНО: Создай TLDR для КАЖДОГО элемента в массиве, даже если описание короткое или пустое

ПРИМЕРЫ:
Вход: {"title": "DeepTutor", "description": "AI-Powered Personalized Learning Assistant"}
Выход: {"id": "123", "tldr": "Персонализированный обучающий ассистент на базе AI."}

Вход: {"title": "HY-Motion-1.0", "description": "model for 3D character animation generation"}
Выход: {"id": "456", "tldr": "Модель для генерации 3D-анимации персонажей."}

Вход: {"title": "GPU VRAM upgrade modification", "description": ""}
Выход: {"id": "789", "tldr": "Модификация для увеличения VRAM видеокарт."}`,
} as const;

/**
 * Иконки для источников
 */
export const SOURCE_ICONS: Record<string, string> = {
  huggingface: '🤗',
  reddit: '👽',
  replicate: '®️',
  github: '⭐',
} as const;

/**
 * Валидация конфигурации при старте
 * Использует централизованный валидатор из validators.ts
 */
export function validateConfig(): { valid: boolean; errors: string[] } {
  // Импортируем динамически чтобы избежать циклических зависимостей
  const env = {
    SUPABASE_URL: SUPABASE.URL,
    SUPABASE_ANON_KEY: SUPABASE.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: SUPABASE.SERVICE_ROLE_KEY,
    OPENROUTER_API_KEY: API_KEYS.OPENROUTER,
    REPLICATE_API_TOKEN: API_KEYS.REPLICATE,
    ADMIN_USER: AUTH.ADMIN_USER,
    ADMIN_PASS: AUTH.ADMIN_PASS,
  };

  // Простая валидация без импорта validators (чтобы избежать циклических зависимостей)
  const errors: string[] = [];

  if (!SUPABASE.URL) {
    errors.push('SUPABASE_URL is not set');
  }
  if (!SUPABASE.ANON_KEY) {
    errors.push('SUPABASE_ANON_KEY is not set');
  }
  if (!SUPABASE.SERVICE_ROLE_KEY) {
    errors.push('SUPABASE_SERVICE_ROLE_KEY is not set');
  }

  // Предупреждения (не критичные)
  if (!API_KEYS.OPENROUTER) {
    console.warn('[Config] OPENROUTER_API_KEY is not set - translations will not work');
  }
  if (!API_KEYS.REPLICATE) {
    console.warn('[Config] REPLICATE_API_TOKEN is not set - Replicate fetcher will not work');
  }
  if (AUTH.ADMIN_USER === 'admin' || AUTH.ADMIN_PASS === 'admin') {
    console.warn('[Config] Using default admin credentials - please set ADMIN_USER and ADMIN_PASS');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Логирование конфигурации (без секретов)
 */
export function logConfig(): void {
  const isDev = process.env.NODE_ENV !== 'production';
  console.log('[Config] Application configuration:');
  console.log('  Environment:', process.env.NODE_ENV || 'development');
  console.log('  Database:', isDev ? '🔧 DEVELOPMENT' : '🚀 PRODUCTION');
  console.log('  Sources:', SOURCES);
  console.log('  Banned strings:', BANNED_STRINGS.length, 'items');
  console.log('  Posts processing limit:', LIMITS.POSTS_PROCESSING_LIMIT);
  console.log(
    '  Supabase URL:',
    SUPABASE.URL ? `✓ Set (${SUPABASE.URL.substring(0, 30)}...)` : '✗ Not set',
  );
  console.log('  Supabase Anon Key:', SUPABASE.ANON_KEY ? '✓ Set' : '✗ Not set');
  console.log('  Supabase Service Role Key:', SUPABASE.SERVICE_ROLE_KEY ? '✓ Set' : '✗ Not set');
  console.log('  OpenRouter API Key:', API_KEYS.OPENROUTER ? '✓ Set' : '✗ Not set');
  console.log('  Replicate API Token:', API_KEYS.REPLICATE ? '✓ Set' : '✗ Not set');
  console.log(
    '  Admin credentials:',
    AUTH.ADMIN_USER !== 'admin' && AUTH.ADMIN_PASS !== 'admin' ? '✓ Custom' : '⚠ Default',
  );
}
