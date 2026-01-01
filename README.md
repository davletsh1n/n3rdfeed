# N3RDFEED

ML/AI news aggregator from GitHub, HuggingFace, Reddit, and Replicate.

## Stack

- **Framework**: [Hono](https://hono.dev/) (Node.js)
- **Runtime**: [Node.js](https://nodejs.org/) with [tsx](https://tsx.is/)
- **Database**: [Supabase](https://supabase.com/) (PostgreSQL)
- **Frontend**: HTML + [Tailwind CSS](https://tailwindcss.com/) + [Mustache](https://github.com/janl/mustache.js)
- **Deployment**: [Vercel](https://vercel.com/)
- **APIs**: GitHub, HuggingFace, Reddit, Replicate

## Local Dev

1. Install dependencies:

```bash
npm install
```

2. Setup environment variables:

```bash
cp .env.example .env  # fill in values
```

3. Start the server:

```bash
npm run dev
```

4. Update content (can be run independently):

```bash
npm run updateContent
```

## Deploy

```bash
npm run deploy
```

Manual trigger: `npm run updateContent`.
