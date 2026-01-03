# План реализации Telegram бота для N3RDFEED

Цель: Автоматическая публикация дайджестов новостей в Telegram канал.

## Этап 1: Подготовка и Интеграция (MVP)

1.  **Регистрация бота:**
    *   Создать бота через `@BotFather`.
    *   Получить `TELEGRAM_BOT_TOKEN`.
    *   Получить `TELEGRAM_CHAT_ID` (сначала личный ID админа для тестов).

2.  **Настройка окружения:**
    *   Добавить переменные в `.env` и `src/config.ts`:
        *   `TELEGRAM_BOT_TOKEN`
        *   `TELEGRAM_CHAT_ID`

3.  **Сервис отправки (`src/services/telegram.ts`):**
    *   Реализовать функцию `sendTelegramMessage(text: string, parseMode: 'Markdown' | 'HTML' = 'HTML')`.
    *   Использовать `fetch` к `https://api.telegram.org/bot<token>/sendMessage`.
    *   Обработка ошибок (rate limits, network errors).

4.  **Интеграция в Админку:**
    *   Добавить кнопку "Send Test Digest to Telegram" в `/admin`.
    *   Создать эндпоинт `POST /api/admin/send-digest`.
    *   Логика:
        1.  Генерируем дайджест (как в `/admin/digest`).
        2.  Форматируем для Telegram (экранирование, лимиты длины).
        3.  Отправляем через `sendTelegramMessage`.

## Этап 2: Форматирование и Улучшение

1.  **Адаптация Markdown:**
    *   LLM генерирует Markdown. Telegram поддерживает ограниченный MarkdownV2 или HTML.
    *   Нужно конвертировать Markdown в HTML или экранировать спецсимволы для MarkdownV2.
    *   Лучше использовать HTML для надежности (`<b>`, `<i>`, `<a href="...">`).
    *   Промпт для LLM можно скорректировать, чтобы он выдавал HTML, или использовать конвертер.

2.  **Разбиение на сообщения:**
    *   Лимит Telegram: 4096 символов.
    *   Дайджест может быть длиннее.
    *   Реализовать логику разбиения текста на части (по параграфам/заголовкам).

## Этап 3: Автоматизация (Production)

1.  **Планировщик:**
    *   Добавить задачу в `src/scheduled.ts` (или отдельный cron).
    *   Например, отправка каждый день в 9:00 и 21:00.
    *   Проверка: не отправлять пустые дайджесты.

2.  **Управление каналом:**
    *   Заменить `TELEGRAM_CHAT_ID` на ID публичного канала.
    *   Добавить бота в администраторы канала.

## Технические детали

*   **Библиотеки:** Не обязательно использовать `telegraf` для простой отправки, достаточно `fetch`. Это уменьшит размер бандла для Edge Runtime (если понадобится).
*   **Безопасность:** Токен бота хранить только в env.

## Пример кода отправки

```typescript
export async function sendTelegramMessage(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!token || !chatId) return;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  });
  
  // ... обработка ответа
}
```
