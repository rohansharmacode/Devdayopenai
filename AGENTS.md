# Notes for coding agents

- Node 22.9+, ES modules, no build step. Front end is plain JS in `public/`.
- Run `npm test` before finishing any change; keep all tests passing and add tests for new behaviour.
- Domain rules live in `src/rota.js` (clock-in, pay, warnings, cover candidates); HTTP routes in `src/app.js`; AI ranking in `src/ai.js`.
- Never commit `.env`, API keys or real personal data. Demo data in `src/seed.js` is fictional.
- Location: only the distance from the site is stored, never raw coordinates. Keep it that way.
