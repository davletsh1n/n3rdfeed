/**
 * @file llm.ts
 * @description Сервис для взаимодействия с OpenRouter API. Отвечает за перевод контента и логирование расходов.
 */

import { LLMUsage } from '../types.js';
import { API_KEYS } from '../config.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Тарифы моделей (цена за 1 млн токенов в USD)
 */
export const MODEL_RATES: Record<string, { name: string; prompt: number; completion: number }> = {
  'openai/gpt-4o-mini': { name: 'GPT-4o Mini', prompt: 0.15, completion: 0.6 },
  'google/gemini-flash-1.5': { name: 'Gemini 1.5 Flash', prompt: 0.075, completion: 0.3 },
  'deepseek/deepseek-chat': { name: 'DeepSeek Chat', prompt: 0.14, completion: 0.28 },
  'anthropic/claude-3-haiku': { name: 'Claude 3 Haiku', prompt: 0.25, completion: 1.25 },
};

/**
 * Получение текущего баланса аккаунта OpenRouter.
 */
export async function getOpenRouterBalance(): Promise<number> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('[OpenRouter] API key not configured');
    return 0;
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
    });

    if (!response.ok) {
      console.error(`[OpenRouter] Balance API returned ${response.status}`);
      return 0;
    }

    const data = await response.json();
    console.log('[OpenRouter] Balance API Response:', JSON.stringify(data, null, 2));

    // OpenRouter API возвращает limit и usage
    // Баланс = limit - usage
    const limit = data.data?.limit || 0;
    const usage = data.data?.usage || 0;
    const balance = limit - usage;

    console.log(`[OpenRouter] Balance calculation: limit(${limit}) - usage(${usage}) = ${balance}`);

    return Math.max(0, balance); // Не возвращаем отрицательный баланс
  } catch (err) {
    console.error('[OpenRouter] Failed to fetch balance:', err);
    return 0;
  }
}

/**
 * Пакетный перевод текстов через LLM.
 * Использует JSON-структуру для минимизации количества запросов и гарантии сопоставления.
 */
export async function translateBatch(
  items: { id: string; text: string }[],
  prompt: string,
  model: string = 'openai/gpt-4o-mini',
): Promise<{ translations: Record<string, string>; usage: LLMUsage }> {
  if (items.length === 0)
    return {
      translations: {},
      usage: { model_id: model, prompt_tokens: 0, completion_tokens: 0, total_cost: 0 },
    };

  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not defined');
  }

  const systemPrompt = `${prompt} 
  ОТВЕТЬ СТРОГО В ФОРМАТЕ JSON: {"results": [{"id": "...", "translated": "..."}]}. 
  Сохраняй оригинальные ID.`;

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://github.com/n3rdfeed',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({ items }) },
      ],
      response_format: { type: 'json_object' }, // Гарантируем JSON ответ
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenRouter API error: ${JSON.stringify(error)}`);
  }

  const data = await response.json();

  // Логируем ответ для отладки
  console.log(`[LLM] API Response received. Tokens: ${data.usage?.total_tokens || 0}`);

  let content;
  try {
    content = JSON.parse(data.choices[0].message.content);
  } catch (e) {
    console.error(`[LLM] Failed to parse JSON response: ${data.choices[0].message.content}`);
    throw new Error('Invalid JSON response from LLM');
  }

  const translations: Record<string, string> = {};
  if (content.results && Array.isArray(content.results)) {
    content.results.forEach((res: any) => {
      translations[res.id] = res.translated;
    });
  }

  const usage: LLMUsage = {
    model_id: model,
    prompt_tokens: data.usage.prompt_tokens,
    completion_tokens: data.usage.completion_tokens,
    total_cost: calculateCost(model, data.usage.prompt_tokens, data.usage.completion_tokens),
  };

  return { translations, usage };
}

/**
 * Вспомогательная функция для расчета примерной стоимости.
 * В идеале OpenRouter отдает это сам, но для надежности считаем по тарифам.
 * Цены указаны за 1 млн токенов.
 */
function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const rate = MODEL_RATES[model] || { prompt: 0.5, completion: 1.5 }; // Дефолтные цены если модель не в списке

  const promptCost = (promptTokens / 1_000_000) * rate.prompt;
  const completionCost = (completionTokens / 1_000_000) * rate.completion;

  return promptCost + completionCost;
}
