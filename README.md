# Shift+

**The rota app your team actually wants to open.** Simple rotas, proximity clock-in, live pay and an AI shift-cover finder for small businesses, wrapped in a game: every on-time arrival, covered shift, 5-star review and tip earns XP that hatches and grows your own pet, and the team competes in a weekly league.

Built in one day at the DevDay Exchange Community Hackathon, London, 1 November 2026.

Small cafés, shops and salons run their rotas on WhatsApp groups and spreadsheets. When someone can't make a shift, the owner spends the morning texting people who are already working, on holiday or about to go over their hours. Shift+ keeps the rota, clocks people in when they actually arrive, adds up pay as they go, and when a shift is dropped it works out who can really cover it and asks them. The game layer rewards exactly the behaviour a small business needs: turning up on time, covering colleagues and delighting customers.

![Manager view: weekly rota, alerts and live pay](docs/manager.png)

## The core journey

1. **The manager** builds the week on a calendar: drag to add a shift, drag to move it, click to reassign.
2. **A worker arrives at work.** The phone view sees they're within 100 m of the site and clocks them in automatically. If they're further away, clock-in is refused and the app says how far they are.
3. **Pay adds up live:** this shift, this week and this month, with what they'll earn if they work their rota.
4. **The worker taps "Can't make it"** on a future shift. Shift+ finds everyone who could cover it: no clashing shift, not on time off, wouldn't break 48 hours. It ranks them with AI on skills, usual availability and hours left, writes a reason for each, and asks the top three.
5. **A colleague taps "I'll cover it".** They earn +50 XP as a "Shift Hero" (+25 more if it's last-minute), their pet levels up with confetti, and they climb the team league. The calendar, both people's rotas and the pay projections update for everyone.

### The game

| Action | XP |
|---|---|
| Clock in on time (within 5 min, and on site) | +20 |
| Finish a shift | +10 |
| Cover a colleague's shift | +50, or +75 if within 24h |
| 5-star / 4-star customer review | +30 / +15 |
| Customer tip | +2 per £1 |
| Every 5 on-time arrivals in a row | +25 streak bonus |

- **Pets.** Everyone has an original pet: a bunny, fox, cat, dino, axolotl or frog. It starts as an **Egg**, then becomes a **Hatchling** at level 2, a **Buddy** at level 4 and a **Legend** at level 7, gaining a scarf and then a crown. Its mood follows your recent activity. It bounces with joy after you earn XP and naps if you've been away. Tap it for a boop.
- **Team league.** A rolling 7-day XP table with medals, so new starters can win any week.
- **Badges.** Early Bird, Shift Hero, Super Hero, Crowd Favourite, Tip Magnet and On Fire.
- **Customer review page** (`/review.html`). Customers tap who served them, give stars and an optional tip, and see that person's pet do a happy dance. In a café this would be a QR code at the till. It's a demo, so no money moves.
- **No penalties.** Being late just earns less XP. The game rewards good behaviour rather than punishing people.

| On-time clock-in: +20 XP | Be a hero: cover request | Level up! |
|---|---|---|
| ![](docs/worker-clock.png) | ![](docs/worker-ask.png) | ![](docs/levelup.png) |

| Manager: AI-ranked cover | Customer review and tip page |
|---|---|
| ![](docs/cover.png) | ![](docs/review.png) |

### Also included

- **Time off requests.** Approving one automatically opens cover requests for any shifts it clashes with.
- **Hours warnings.** The app flags anyone rota'd over the 48-hour UK Working Time limit, or over the hours they said they want.
- **Week/month pay table and CSV export** for the accountant.
- **Late clock-ins** are logged with minutes late.
- **Two-window demo mode.** Pick who you are from the "Viewing as" menu, and the views stay in sync every 4 seconds.

## Run it

You need Node.js 22.9 or later.

```bash
git clone https://github.com/rohansharmacode/Devdayopenai.git
cd Devdayopenai
npm install
cp .env.example .env     # optional: add OPENAI_API_KEY for AI ranking
npm start                # http://localhost:3000
```

- Open two windows: http://localhost:3000/?as=manager and http://localhost:3000/?as=s2 (Tom). Staff ids are s1 to s6, or use the "Viewing as" menu.
- In Tom's window, tap **Simulate: at home**, then **Simulate: at work**. He clocks in automatically. **Use my GPS** uses your real location; the site is a fixed demo point in Shoreditch.
- Tap **Can't make it** on Tom's Monday shift, then switch a window to **Leo Martins** and accept.
- `npm run reset` (or **Reset demo data** in the manager view) re-seeds the data for the current week.

### Test it as a phone app

- **Chrome or Edge DevTools.** Press F12, then Ctrl+Shift+M, and pick an iPhone or Pixel from the device list. To test real proximity, open the ⋮ menu → More tools → Sensors and set Location to latitude `51.5246`, longitude `-0.0786` (on site), or anywhere else (off site). Then tap **My GPS**.
- **Your own phone on the same Wi-Fi.** Open `http://<your-laptop-IP>:3000/?as=s2` (find the IP with `ipconfig` on Windows). Use **Add to Home Screen** for a full-screen app with the Shift+ icon. Phones only share GPS with HTTPS sites, so use the **At work** and **At home** buttons there.

**No API key?** Everything still works. Cover ranking falls back to transparent rules and the UI says "Ranked by rules". With a key, the badge reads "Ranked by AI".

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | none | Enables AI ranking of cover candidates |
| `OPENAI_MODEL` | `gpt-6-astra` | Model used for ranking |
| `PORT` | `3000` | HTTP port |
| `DB_FILE` | `data/db.json` | Where data is stored |

### Tests

```bash
npm test
```

There are 23 tests covering XP rules, levels and pet stages, the leaderboard, the public review endpoint (validation, tip caps, no private fields exposed), distance, clock-in rules, pay maths, CSV, 48-hour warnings, cover eligibility, permissions, the full drop-rank-accept journey (with a fake OpenAI endpoint), time off opening cover requests, and the AI fallback paths.

## How the AI is used

`src/ai.js` calls the OpenAI **Responses API** with **Structured Outputs** (a strict JSON schema), so the result is always `{ ranked: [{ staffId, reason }], message }`.

- **Hard rules run first, in code.** These are clashes, time off and the 48-hour limit, and the model only ever sees people who are allowed to work. It can't put someone into an illegal shift.
- **The model does the judgement call**: trading off skills, availability, hours and cost, explaining it in a sentence, and drafting the message to the top pick.
- **Model output is validated.** Unknown IDs are dropped, and anyone the model skipped is appended in rule order.
- **Data minimisation.** The model gets first names and work facts only, never surnames, contact details or locations.
- **There's a 15-second timeout**, with a rule-based fallback and a visible note when it's used.

## How Codex helped

The app was built in Claude Code. Codex did the final pass. The concrete result is below.

<!-- CODEX-EXAMPLE: fill in after running the steps in docs/codex-final-steps.md -->
_To be filled in with the Codex review findings, the fix commit and the feature Codex added._

## Privacy and safety

- **Location.** The browser's coordinates are sent once per check, used to work out the distance, and thrown away. Only the distance in metres is stored.
- **Demo data.** All people and the café are fictional. No real personal data is in the repo.
- **Secrets.** Keys live in `.env`, which is git-ignored.
- **Not production auth.** The "Viewing as" menu is a demo switch. A real deployment needs proper accounts, with workers only able to act as themselves.

## Project layout

```
src/time.js    date helpers (UK weeks start Monday)
src/seed.js    fictional café, 6 staff, 2 weeks of shifts generated around today
src/rota.js    clock-in, pay, hour warnings, cover candidates (pure functions)
src/ai.js      OpenAI Responses API ranking with rule fallback
src/app.js     Express API
src/game.js    XP ledger, levels, pet stages and moods, streaks, badges, leaderboard
public/        plain HTML/CSS/JS front end (FullCalendar, Fredoka + Nunito fonts)
public/pets.js original SVG pets, drawn in code
public/review.html, review.js  customer review and tip page
test/          node:test suites
```

## What's next

- Real accounts, plus SMS or WhatsApp notifications for cover asks.
- A shift-swap marketplace between staff.
- A rewards shop: spend XP on pet accessories, or on perks like first pick of next week's shifts.
- Team quests, such as "no late arrivals all week", that level up everyone's pets together.
- AI-drafted next-week rota from demand and last week's patterns.
- Holiday accrual, and a minimum-wage check against current UK rates.
- A Postgres store for more than one site.

## Credits

- [Express](https://expressjs.com/) (MIT) for the HTTP server.
- [FullCalendar](https://fullcalendar.io/) 6 (MIT) for the calendar views, served from `node_modules`.
- [Fredoka](https://fonts.google.com/specimen/Fredoka) and [Nunito](https://fonts.google.com/specimen/Nunito) (SIL Open Font License), served from the `@fontsource-variable` packages.
- The pets, icons, confetti and all CSS were written from scratch for this project. Badge icons are system emoji.
- The OpenAI Responses API powers cover ranking.
- Built with Claude Code (Anthropic) and OpenAI Codex during the hackathon. No templates or pre-existing project code were used.
- The idea was inspired by enterprise workforce tools such as Rotageek, simplified for very small teams. Shift+ has no affiliation with them and uses none of their code or assets.

## Licence

MIT, see [LICENSE](LICENSE).
