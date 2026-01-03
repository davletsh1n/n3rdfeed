/**
 * @file utils.ts
 * @description Набор вспомогательных утилит для обработки текста, времени и генерации идентификаторов.
 * @inputs
 *   - Строковые данные, даты, числовые значения.
 * @outputs
 *   - Экспортирует функции: sanitizeContent, timeSince, hashStringToInt, truncateWithoutBreakingWords, base36ToInt.
 */

/**
 * Глобальный массив для временного хранения логов выполнения.
 * Позволяет передавать сообщения из глубоких слоев логики (fetchers, scheduled) в API ответ.
 */
export const executionLogs: string[] = [];

export function addExecutionLog(msg: string) {
  const time = new Date().toLocaleTimeString();
  const logMsg = `[${time}] ${msg}`;
  console.log(logMsg); // Дублируем в терминал
  executionLogs.push(logMsg);
}

export function clearExecutionLogs() {
  executionLogs.length = 0;
}

/**
 * Функция для глубокой очистки текста от HTML-тегов, Markdown-разметки и лишних пробелов.
 * Важна для нормализации данных перед сохранением в БД.
 */
export function sanitizeContent(text: string): string {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '') // Удаляем все HTML-теги (например, <div>, <script>)
    .replace(/&[^;]+;/g, ' ') // Заменяем HTML-сущности (например, &nbsp;) на пробелы
    .replace(/!\[.*?\]\(.*?\)/g, '') // Удаляем Markdown-изображения
    .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Очищаем Markdown-ссылки, оставляя только текст внутри скобок
    .replace(/\s+/g, ' ') // Заменяем множественные пробелы и переносы строк на один пробел
    .trim(); // Убираем пробелы по краям
}

export function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + ' years';

  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + ' months';

  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + ' days';

  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + ' hours';

  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + ' minutes';

  return Math.floor(seconds) + ' seconds';
}

export function hashStringToInt(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

export function truncateWithoutBreakingWords(str: string, n: number): string {
  str = str.replace(/\n/g, ' ');
  str = str.replace(/\[(.*?)\]\((.*?)\)/g, '$1');

  if (str.length <= n) return str;

  const firstSentenceEnd = str.indexOf('.');
  const firstSentence = firstSentenceEnd === -1 ? str : str.slice(0, firstSentenceEnd + 1);

  if (firstSentence.length <= n) return firstSentence;

  const truncatedStr = firstSentence.substr(0, n);
  const lastSpaceIndex = truncatedStr.lastIndexOf(' ');

  return lastSpaceIndex === -1
    ? truncatedStr + '...'
    : truncatedStr.substr(0, lastSpaceIndex) + '...';
}

export function base36ToInt(str: string): string {
  let result = BigInt(0);
  for (const char of str) {
    const digit = parseInt(char, 36);
    result = result * BigInt(36) + BigInt(digit);
  }
  return result.toString();
}

/**
 * Вспомогательная функция для расчета косинусного сходства векторов
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
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

/**
 * Нормализация URL для сравнения.
 * Убирает протоколы, завершающие слеши и www.
 */
export function normalizeUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    // Приводим к нижнему регистру, убираем .git и завершающие слеши
    const path = u.pathname.replace(/\/$/, '').replace(/\.git$/, '').toLowerCase();
    return u.hostname.replace('www.', '').toLowerCase() + path;
  } catch {
    return url
      .replace(/^https?:\/\//, '')
      .replace('www.', '')
      .replace(/\/$/, '')
      .replace(/\.git$/, '')
      .toLowerCase();
  }
}

/**
 * Категории для Diversity Filter
 */
export type ContentCategory = 'NLP' | 'CV' | 'Audio' | 'Systems' | 'General';

/**
 * Определяет категорию поста на основе его метаданных и текста.
 */
export function categorizePost(post: any): ContentCategory {
  const text = `${post.name} ${post.description} ${post.tldr_ru || ''}`.toLowerCase();

  // 1. Systems & Infrastructure
  if (
    text.includes('inference') ||
    text.includes('cuda') ||
    text.includes('quantization') ||
    text.includes('gguf') ||
    text.includes('rust') ||
    text.includes('cpp') ||
    text.includes('engine') ||
    text.includes('optimization')
  ) {
    return 'Systems';
  }

  // 2. Computer Vision
  if (
    text.includes('image') ||
    text.includes('video') ||
    text.includes('diffusion') ||
    text.includes('vision') ||
    text.includes('segmentation') ||
    text.includes('detection')
  ) {
    return 'CV';
  }

  // 3. Audio & Speech
  if (
    text.includes('audio') ||
    text.includes('speech') ||
    text.includes('voice') ||
    text.includes('tts') ||
    text.includes('stt') ||
    text.includes('music')
  ) {
    return 'Audio';
  }

  // 4. NLP (Default for most AI stuff)
  if (
    text.includes('llm') ||
    text.includes('gpt') ||
    text.includes('text') ||
    text.includes('language') ||
    text.includes('rag') ||
    text.includes('agent') ||
    text.includes('chat')
  ) {
    return 'NLP';
  }

  return 'General';
}
