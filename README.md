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
- `src/fetchers.ts`: Logic for fetching data from external APIs.
- `src/db.ts`: Supabase client and database operations.
- `src/utils.ts`: Helper functions (sanitization, time formatting).
- `src/templates/`: HTML templates for the frontend.

## Deploy

```bash
npm run deploy
```

Manual trigger for content update: `npm run updateContent`.
