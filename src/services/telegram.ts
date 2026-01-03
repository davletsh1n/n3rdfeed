import { TELEGRAM } from '../config.js';

/**
 * Отправка сообщения в Telegram.
 * @param text Текст сообщения (поддерживает HTML)
 * @param chatId ID чата (по умолчанию из конфига)
 * @param retries Количество повторных попыток при ошибке сети
 */
export async function sendTelegramMessage(
  text: string,
  chatId: string = TELEGRAM.CHAT_ID,
  retries: number = 3,
): Promise<{ success: boolean; error?: string }> {
  if (!TELEGRAM.BOT_TOKEN || !chatId) {
    console.error('[Telegram] Bot token or Chat ID not configured');
    return { success: false, error: 'Bot token or Chat ID not configured' };
  }

  const url = `https://api.telegram.org/bot${TELEGRAM.BOT_TOKEN}/sendMessage`;

  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error(`[Telegram] Send error (attempt ${i + 1}):`, error);
        
        // Если ошибка клиента (4xx), повторять нет смысла
        if (response.status >= 400 && response.status < 500) {
          return { success: false, error: `API Error: ${error.description || response.statusText}` };
        }
        
        throw new Error(`API Error ${response.status}: ${error.description}`);
      }

      return { success: true };
    } catch (err: any) {
      console.error(`[Telegram] Network error (attempt ${i + 1}/${retries + 1}):`, err.message);

      if (i === retries) {
        return { success: false, error: `Network Error: ${err.message}` };
      }

      // Ждем перед следующей попыткой (1s, 2s, 3s...)
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
    }
  }

  return { success: false, error: 'Unknown error' };
}
