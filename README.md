# Leetfeed / Hype-based

Hello world

## Local Dev

```bash
npm install
cp .dev.vars.example .dev.vars  # fill in values
npm run dev
```

## Deploy

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put REPLICATE_API_TOKEN
npm run deploy
```

Manual trigger: `npm run updateContent`.
