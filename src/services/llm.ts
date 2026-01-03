/**
 * @file llm.ts
 * @description Сервис для взаимодействия с OpenRouter API. Отвечает за перевод контента и логирование расходов.
 */

import { LLMUsage } from '../types.js';
import { API_KEYS, LLM_PROMPTS } from '../config.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings';

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

/**
 * Генерация TLDR (кратких описаний) для постов.
 * Заменяет прямые переводы более естественным и кратким описанием на русском.
 *
 * @param items - Массив постов с заголовком, описанием и источником
 * @param model - Модель LLM для генерации
 * @returns Объект с TLDR и данными об использовании
 */
export async function generateTLDRBatch(
  items: { id: string; title: string; description: string; source: string }[],
  model: string = 'openai/gpt-4o-mini',
): Promise<{ tldrs: Record<string, string>; usage: LLMUsage }> {
  if (items.length === 0) {
    return {
      tldrs: {},
      usage: { model_id: model, prompt_tokens: 0, completion_tokens: 0, total_cost: 0 },
    };
  }

  if (!API_KEYS.OPENROUTER) {
    throw new Error('OPENROUTER_API_KEY is not defined');
  }

  const systemPrompt = `${LLM_PROMPTS.TLDR_GENERATOR}

IMPORTANT: You must output valid JSON only.
FORMAT: {"results": [{"id": "...", "tldr": "..."}]}.
Keep original IDs.`;

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEYS.OPENROUTER}`,
      'HTTP-Referer': 'https://github.com/n3rdfeed',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({ items }) },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 4096, // Увеличиваем лимит на выход, чтобы избежать обрывов JSON
      temperature: 0.1, // Минимальная температура - только факты, без креатива
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenRouter API error: ${JSON.stringify(error)}`);
  }

  const data = await response.json();

  console.log(`[LLM] TLDR generation response received. Tokens: ${data.usage?.total_tokens || 0}`);

  let content;
  try {
    content = JSON.parse(data.choices[0].message.content);
  } catch (e) {
    console.error(`[LLM] Failed to parse JSON response: ${data.choices[0].message.content}`);
    throw new Error('Invalid JSON response from LLM');
  }

  const tldrs: Record<string, string> = {};
  if (content.results && Array.isArray(content.results)) {
    content.results.forEach((res: any) => {
      if (res.tldr && res.tldr.trim()) {
        tldrs[res.id] = res.tldr.trim();
      }
    });
  }

  console.log(`[LLM] Generated ${Object.keys(tldrs).length} TLDRs out of ${items.length} items`);

  // Логируем какие посты не получили TLDR
  const missingTLDRs = items.filter((item) => !tldrs[item.id]);
  if (missingTLDRs.length > 0) {
    console.warn(
      `[LLM] Missing TLDRs for ${missingTLDRs.length} items:`,
      missingTLDRs.map((i) => i.id),
    );
  }

  const usage: LLMUsage = {
    model_id: model,
    prompt_tokens: data.usage.prompt_tokens,
    completion_tokens: data.usage.completion_tokens,
    total_cost: calculateCost(model, data.usage.prompt_tokens, data.usage.completion_tokens),
  };

  return { tldrs, usage };
}

/**
 * Генерация векторных эмбеддингов для текстов.
 * Использует модель openai/text-embedding-3-small через OpenRouter.
 *
 * @param texts - Массив строк для векторизации
 * @returns Массив векторов (каждый вектор - массив чисел)
 */
export async function generateEmbeddingsBatch(
  texts: string[],
): Promise<{ embeddings: number[][]; usage: LLMUsage }> {
  if (texts.length === 0) {
    return {
      embeddings: [],
      usage: {
        model_id: 'mistralai/mistral-embed-2312',
        prompt_tokens: 0,
        completion_tokens: 0,
        total_cost: 0,
      },
    };
  }

  if (!API_KEYS.OPENROUTER) {
    throw new Error('OPENROUTER_API_KEY is not defined');
  }

  const model = 'mistralai/mistral-embed-2312';

  console.log(`[LLM] Generating embeddings for ${texts.length} items using ${model}...`);

  const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEYS.OPENROUTER}`,
      'HTTP-Referer': 'https://github.com/n3rdfeed',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      input: texts,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenRouter Embedding error: ${JSON.stringify(error)}`);
  }

  const data = await response.json();

  if (!data.data || !Array.isArray(data.data)) {
    console.error('[LLM] Unexpected embedding response format:', JSON.stringify(data));
    throw new Error('Invalid embedding response from OpenRouter');
  }

  // OpenRouter возвращает эмбеддинги в поле data
  const embeddings = data.data.map((item: any) => item.embedding);

  const usage: LLMUsage = {
    model_id: model,
    prompt_tokens: data.usage?.total_tokens || 0,
    completion_tokens: 0,
    total_cost: calculateCost(model, data.usage?.total_tokens || 0, 0),
  };

  return { embeddings, usage };
}

/**
 * Генерация связного дайджеста на основе кластеров (сюжетов).
 *
 * @param clusters - Массив кластеров с метаданными
 * @param model - Модель LLM (рекомендуется gpt-4o или claude-3.5-sonnet)
 * @returns Текст дайджеста и данные об использовании
 */
export async function generateDigest(
  clusters: any[],
  model: string = 'anthropic/claude-3.5-sonnet',
): Promise<{ content: string; usage: LLMUsage }> {
  if (clusters.length === 0) {
    throw new Error('No clusters provided for digest');
  }

  if (!API_KEYS.OPENROUTER) {
    throw new Error('OPENROUTER_API_KEY is not defined');
  }

  // Формируем контекст для редактора
  const digestContext = clusters.map((c, idx) => ({
    rank: idx + 1,
    topic: c.mainPost.name,
    summary: c.mainPost.tldr_ru || c.mainPost.description,
    sources: [
      { type: c.mainPost.source, url: c.mainPost.url, score: c.mainPost.stars },
      ...c.relatedPosts.map((p: any) => ({ type: p.source, url: p.url, score: p.stars })),
    ],
    total_score: c.totalScore.toFixed(1),
  }));

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEYS.OPENROUTER}`,
      'HTTP-Referer': 'https://github.com/n3rdfeed',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: LLM_PROMPTS.DIGEST_EDITOR },
        {
          role: 'user',
          content: `Вот главные сюжеты за последние 12 часов. Сформируй из них дайджест:\n\n${JSON.stringify(
            digestContext,
            null,
            2,
          )}`,
        },
      ],
      temperature: 0.7, // Немного креативности для связности текста
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenRouter Digest error: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;

  const usage: LLMUsage = {
    model_id: model,
    prompt_tokens: data.usage.prompt_tokens,
    completion_tokens: data.usage.completion_tokens,
    total_cost: calculateCost(model, data.usage.prompt_tokens, data.usage.completion_tokens),
  };

  return { content, usage };
}
