import type { Context } from 'hono';

export interface Post {
  id: string;
  source: string;
  username: string;
  name: string;
  stars: number;
  description: string;
  url: string;
  created_at: string;
}
