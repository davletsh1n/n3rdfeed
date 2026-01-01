-- Скрипт для очистки dev БД перед тестированием
-- ВНИМАНИЕ: Выполняйте ТОЛЬКО в dev проекте Supabase!

-- Очистка таблицы repositories
TRUNCATE TABLE repositories CASCADE;

-- Очистка таблицы llm_usage
TRUNCATE TABLE llm_usage CASCADE;

-- Проверка что таблицы пустые
SELECT COUNT(*) as repositories_count FROM repositories;
SELECT COUNT(*) as llm_usage_count FROM llm_usage;

-- Должно вернуть:
-- repositories_count: 0
-- llm_usage_count: 0
