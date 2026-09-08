# Procurement Agent

AI-powered vendor selection agent for procurement teams.

## Deploy on Railway

1. Push this folder to a GitHub repo
2. Go to railway.app → New Project → Deploy from GitHub
3. Select your repo
4. Go to Variables → Add:
   ```
   ANTHROPIC_KEY = your-api-key-here
   ```
5. Railway auto-deploys. Done.

## Local Development

```bash
npm install
npm run build
npm start
```

Open http://localhost:3000
