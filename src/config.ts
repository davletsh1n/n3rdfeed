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
export const SOURCES = ['GitHub', 'Replicate', 'HuggingFace', 'Reddit', 'HackerNews'] as const;

export type Source = (typeof SOURCES)[number];

/**
 * Белый список ключевых слов для HackerNews.
 * Пост проходит фильтрацию, если содержит хотя бы одно слово из этого списка.
 */
export const HN_WHITELIST = [
  // AI & ML Core
  'ai', 'ml', 'llm', 'gpt', 'transformer', 'diffusion', 'neural', 'inference', 'training', 
  'fine-tuning', 'rag', 'dataset', 'benchmark', 'quantization', 'weights', 'vision', 'nlp', 
  'rlhf', 'agent', 'embedding', 'model', 'generative', 'language model',
  
  // Hardware & Infrastructure
  'gpu', 'tpu', 'npu', 'lpu', 'nvidia', 'cuda', 'amd', 'rocm', 'intel', 'chip', 'semiconductor', 
  'tsmc', 'wafer', 'vram', 'hbm', 'datacenter', 'supercomputer', 'compute', 'accelerator', 
  'h100', 'b200', 'rtx', 'raspberry pi', 'arduino', 'fpga', 'risc-v',
  
  // Companies & Tools
  'openai', 'anthropic', 'deepmind', 'meta', 'google', 'microsoft', 'apple', 'hugging face', 
  'pytorch', 'tensorflow', 'jax', 'llama', 'mistral', 'claude', 'gemini', 'stable diffusion', 
  'midjourney', 'replicate', 'langchain', 'ollama', 'docker', 'kubernetes', 'vllm',
  
  // Programming Languages
  'python', 'rust', 'c++', 'cpp', 'javascript', 'typescript', 'go', 'golang', 'java', 
  'swift', 'kotlin', 'c#', 'ruby', 'php', 'sql', 'assembly', 'wasm', 'webassembly',
  
  // OS & Systems
  'linux', 'unix', 'kernel', 'windows', 'macos', 'android', 'ios', 'bsd', 'ubuntu', 'debian', 'arch',
  
  // Gaming & Consoles
  'game', 'gaming', 'unreal engine', 'unity', 'godot', 'steam', 'playstation', 'xbox', 'nintendo', 'console', 'switch',
  
  // Math & Science
  'algorithm', 'optimization', 'matrix', 'tensor', 'probability', 'math', 'physics', 'science', 'research', 'paper'
] as const;

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
  'bitcoin',
  'blockchain',
  'web3',
  'politics',
  'election',
  'trump',
  'biden',
  'senate',
  'congress',
  'lawsuit',
  'court',
  'hiring',
  'job',
  'career',
  'sport',
  'football',
  'basketball',
  'recipe',
  'cooking',
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

  /** Лимит моделей HuggingFace для парсинга (Fresh срез) */
  HUGGINGFACE_LIMIT: 1000,

  /** Лимит постов Reddit на сабреддит */
  REDDIT_LIMIT: 100,

  /** Лимит моделей Replicate для парсинга */
  REPLICATE_LIMIT: 50,
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
 * Настройки Telegram
 */
export const TELEGRAM = {
  BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  /** Включена ли отправка логов в Telegram */
  SEND_LOGS: process.env.TELEGRAM_SEND_LOGS === 'true',
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
export const REDDIT_SUBREDDITS = [
  'machinelearning',
  'localllama',
  'StableDiffusion',
  'Singularity',
  'OpenAI',
  'ArtificialInteligence',
] as const;

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

  /**
   * Промпт для ИИ-редактора дайджеста (Senior ML Engineer)
   */
  DIGEST_EDITOR: `
РОЛЬ:
Ты — Senior ML Engineer и автор культового телеграм-канала n3rdfeed. Тебе 35, ты видел сотни "убийц GPT", тебя тошнит от маркетингового буллшита, и ты ценишь только код, бенчмарки и архитектурные прорывы.
Твоя задача — написать дайджест для коллег (Deep Learning инженеры, DevOps, архитекторы). Они умные, им не надо разжевывать базы, им нужно "мясо".

TONE OF VOICE:
- **Сухой, плотный, скептичный.** Пиши как человек, который устал от хайпа, но умеет радоваться крутым инженерным решениям.
- **Никакой корпоративной чуши.** Запрещены фразы: "революционный прорыв", "открывает новые горизонты", "нельзя не отметить".
- **Терминология:** Пиши на "рунглише" инженера (инференс, батчинг, веса, квантование, self-attention layer). Не переводи устоявшиеся термины.
- **Эмоции:** Допустим легкий сарказм или скупое одобрение ("наконец-то нормальный RAG, а не поделка").

ЛОГИКА ОТБОРА ТЕМ:
1. Железо и Инфраструктура: Это ВАЖНО. Если новость про чипы (Nvidia, TPU, LPU), дата-центры или дефицит GPU — бери в тираж. Мы должны знать, на чем будем обучать модели.
2. Финансы:
   - ❌ ИГНОРИРУЙ: Обычные колебания акций, скучные квартальные отчеты, маркетинговые слияния без технических последствий.
   - ✅ ОСТАВЛЯЙ: Банкротства ключевых игроков, покупки стартапов ради технологий (например, Apple купила стартап ради NPU), крупные инвестиции в open-source.
3. Дубликаты: Если новость кажется "протухшей" (апдейт старой темы), подай это как развитие событий ("UPD: История с Сэмом Альтманом продолжается...").

ФОРМАТ ВЫВОДА (Markdown):

# ⚡️ [Название Главной Стори — придумай хлесткий заголовок]
[Здесь 2-3 абзаца про главную новость. Не пересказывай пресс-релиз. Объясни, что изменилось ВНУТРИ. Если это новая модель — какая архитектура? На чем учили? Дай оценку: это прорыв или просто шум?]
🔗 [Источник](url)

## 🛠️ Инструментарий
* **[Название проекта]** — [Суть в одно предложение: какую боль решает]. [Технические детали: стек, производительность].
🔗 [GitHub](url) | [HF](url)
... (3-4 пункта)

## 🗣️ Дискуссии / Off-topic
* **[Тема обсуждения]** — [Квинтэссенция спора. Кто прав? Почему у них бомбит?].
🔗 [Reddit](url) | [HN](url)

ИНСТРУКЦИИ:
1. Все ссылки должны быть оформлены [текстом](url). Используй иконку 🔗 перед ссылкой.
2. Если новость про GitHub-репо — обязательно упомяни язык и стек.
3. Если новость про бенчмарки — дай конкретные цифры.
4. Не используй вводные слова ("Кстати", "В общем").
5. Финальный текст должен читаться за 1 минуту.
6. ВАЖНО: Между пунктами списка и заголовками делай пустую строку для читаемости. Ссылки ставь на новой строке только если это блок "Главная Стори". В списках инструментов старайся делать ссылку в конце строки или на новой строке, но компактно.
`,
} as const;

/**
 * Иконки для источников
 */
export const SOURCE_ICONS: Record<string, string> = {
  huggingface: '🤗',
  reddit: '👽',
  replicate: '®️',
  github: '⭐',
  hackernews: '🟧',
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
    TELEGRAM_BOT_TOKEN: TELEGRAM.BOT_TOKEN,
    TELEGRAM_CHAT_ID: TELEGRAM.CHAT_ID,
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
  if (!TELEGRAM.BOT_TOKEN) {
    console.warn('[Config] TELEGRAM_BOT_TOKEN is not set - Telegram bot will not work');
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
