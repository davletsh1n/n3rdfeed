/**
 * @file types/api.ts
 * @description Типы для внешних API (GitHub, HuggingFace, Reddit, Replicate, OpenRouter)
 */

/**
 * GitHub API Types
 */
export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
    id: number;
    avatar_url: string;
  };
  html_url: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  stargazers_count: number;
  language: string | null;
}

export interface GitHubSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubRepository[];
}

/**
 * HuggingFace API Types
 */
export interface HuggingFaceModel {
  _id: string;
  id: string;
  author: string;
  lastModified: string;
  likes: number;
  downloads: number;
  pipeline_tag?: string;
  tags?: string[];
  siblings?: Array<{
    rfilename: string;
  }>;
}

/**
 * Reddit API Types
 */
export interface RedditPost {
  data: {
    id: string;
    title: string;
    author: string;
    subreddit: string;
    score: number;
    created_utc: number;
    permalink: string;
    link_flair_text?: string;
    url: string;
  };
}

export interface RedditResponse {
  data: {
    children: RedditPost[];
    after: string | null;
    before: string | null;
  };
}

/**
 * Replicate API Types
 */
export interface ReplicateModel {
  url: string;
  owner: string;
  name: string;
  description: string | null;
  run_count: number;
  latest_version: {
    id: string;
    created_at: string;
  } | null;
}

/**
 * OpenRouter API Types
 */
export interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterChatResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: OpenRouterUsage;
}

export interface OpenRouterBalanceData {
  limit: number;
  usage: number;
  is_free_tier: boolean;
  rate_limit: {
    requests: number;
    interval: string;
  };
}

export interface OpenRouterBalanceResponse {
  data: OpenRouterBalanceData;
}

/**
 * Supabase RPC Types
 */
export interface LLMStatsRow {
  model_id: string;
  total_tokens: number;
  total_usd: number;
}

export interface LLMLogRow {
  id: string;
  created_at: string;
  model_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_cost: number;
  post_id: string | null;
  status: string;
  items_count: number;
}

/**
 * Admin Panel Types
 */
export interface AdminStats {
  model: string;
  tokens: string;
  cost: string;
}

export interface AdminLog {
  time: string;
  model_id: string;
  tokens: string;
  cost: string;
}

export interface AdminModel {
  id: string;
  name: string;
  prompt: number;
  completion: number;
  active: boolean;
}
