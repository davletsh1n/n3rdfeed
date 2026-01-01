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
