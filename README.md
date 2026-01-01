# N3RDFEED

ML/AI news aggregator from GitHub, HuggingFace, Reddit, and Replicate.

## Stack

- **Framework**: [Hono](https://hono.dev/)
- **Build Tool**: [Vite](https://vitejs.dev/) (with HMR support)
- **Database**: [Supabase](https://supabase.com/) (PostgreSQL)
- **Frontend**: HTML + [Tailwind CSS](https://tailwindcss.com/) + [Mustache](https://github.com/janl/mustache.js)
- **Deployment**: [Vercel](https://vercel.com/)
- **APIs**: GitHub, HuggingFace, Reddit, Replicate

## Key Features (Refactored)

- **Vite Integration**: Fast development with Hot Module Replacement.
- **Deep Content Normalization**: Automatic sanitization of HTML/Markdown from external sources (HuggingFace, etc.) before database ingestion.
- **Smart Scoring**: Custom weighting system for different news sources.
- **Clean Architecture**: Separated fetchers, database logic, and templates.

## Local Dev

1. Install dependencies:

```bash
npm install
```

2. Setup environment variables:

```bash
cp .env.example .env  # fill in SUPABASE_URL, SUPABASE_ANON_KEY, etc.
```

3. Start the development server (Vite):

```bash
npm run dev
```

4. Update content manually (fetches latest news):

```bash
npm run updateContent
```

## Project Structure

- `src/index.ts`: Main entry point and Hono routes.
- `src/config.ts`: Centralized configuration (sources, limits, prompts, API keys).
- `src/templates.ts`: HTML templates (Page and Admin).
- `src/fetchers.ts`: Logic for fetching data from external APIs.
- `src/db.ts`: Supabase client and database operations.
- `src/services/llm.ts`: OpenRouter API integration for TLDR generation.
- `src/validators.ts`: Centralized validation functions.
- `src/utils.ts`: Helper functions (sanitization, time formatting).
- `src/types/`: TypeScript type definitions.
- `src/endpoints/`: OpenAPI endpoints.
- `scripts/`: Utility scripts (updateContent, generateTLDR).

## Deploy

```bash
npm run deploy
```

Manual trigger for content update: `npm run updateContent`.

## DB Structure

```sql
-- 1. Удаление старых таблиц и функций
DROP TABLE IF EXISTS repositories CASCADE;
DROP TABLE IF EXISTS llm_usage CASCADE;
DROP TABLE IF EXISTS app_config CASCADE;
DROP FUNCTION IF EXISTS get_llm_stats;
DROP FUNCTION IF EXISTS repositories_last_modified;

-- 2. Создание таблицы новостей
CREATE TABLE repositories (
    id TEXT NOT NULL,
    source TEXT NOT NULL,
    username TEXT,
    name TEXT NOT NULL,
    name_ru TEXT,              -- DEPRECATED: старые переводы заголовков
    description TEXT,
    description_ru TEXT,       -- DEPRECATED: старые переводы описаний
    tldr_ru TEXT,              -- AI-generated TLDR на русском (2-3 предложения)
    stars INTEGER DEFAULT 0,
    url TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    inserted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (id, source)
);

-- Индексы для оптимизации запросов
CREATE INDEX idx_repositories_source_created ON repositories(source, created_at DESC);
CREATE INDEX idx_repositories_stars ON repositories(stars DESC);
CREATE INDEX idx_repositories_inserted ON repositories(inserted_at DESC);

-- 3. Создание таблицы логов LLM
CREATE TABLE llm_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    model_id TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    total_cost NUMERIC(10, 6) NOT NULL,
    post_id TEXT,
    status TEXT DEFAULT 'success',
    items_count INTEGER DEFAULT 0
);

-- 4. Создание таблицы конфигурации
CREATE TABLE app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Установка модели по умолчанию
INSERT INTO app_config (key, value) VALUES ('active_llm_model', 'openai/gpt-4o-mini');

-- 5. Функция для статистики расходов
CREATE OR REPLACE FUNCTION get_llm_stats(days_limit INTEGER DEFAULT 30)
RETURNS TABLE (
    model_id TEXT,
    total_tokens BIGINT,
    total_usd NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.model_id, 
        SUM(u.prompt_tokens + u.completion_tokens)::BIGINT, 
        SUM(u.total_cost)::NUMERIC
    FROM llm_usage u
    WHERE u.created_at > (NOW() - (days_limit || ' days')::INTERVAL)
    GROUP BY u.model_id;
END;
$$ LANGUAGE plpgsql;

-- 6. Функция для даты последнего обновления
CREATE OR REPLACE FUNCTION repositories_last_modified()
RETURNS TIMESTAMP WITH TIME ZONE AS $$
BEGIN
    RETURN (SELECT MAX(inserted_at) FROM repositories);
END;
$$ LANGUAGE plpgsql;

-- 7. Настройка безопасности (RLS) - УПРОЩЕННЫЕ ПОЛИТИКИ
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;

-- Политики для app_config
CREATE POLICY "service_role_all_config" ON app_config FOR ALL TO service_role USING (true);

-- Политики для llm_usage
CREATE POLICY "service_role_all_usage" ON llm_usage FOR ALL TO service_role USING (true);

-- Политики для repositories
CREATE POLICY "public_select_repos" ON repositories FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "service_role_all_repos" ON repositories FOR ALL TO service_role USING (true);
```

## New Features

### TLDR Generation System

Вместо прямых машинных переводов, система генерирует краткие фактологичные описания (TLDR) на русском языке:

- **Оригинал**: Показывается полное английское описание
- **TLDR**: Краткое (1-2 предложения) описание на русском с сохранением технических терминов
- **Стиль**: Сухо, фактологично, без рекламы и домыслов
- **Генерация**: Автоматически при обновлении контента

**Команды**:
```bash
# Обновление контента (автоматически генерирует TLDR для новых постов)
npm run updateContent

# Генерация TLDR для существующих постов
npm run generateTLDR
```

### Development Environment

Проект поддерживает отдельные БД для разработки и production:

- **Локально** (`npm run dev`): Использует dev БД (`SUPABASE_URL_DEV`)
- **На Vercel**: Использует prod БД (`SUPABASE_URL`)

См. [`DEV-ENVIRONMENT-SETUP.md`](DEV-ENVIRONMENT-SETUP.md) для настройки.
