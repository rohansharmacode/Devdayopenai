# Final steps in Codex (about 30 to 40 minutes)

The app was built in Claude Code. These steps give Codex a real, visible job at the end and produce the "How Codex helped" example for the submission. Run them on your laptop inside the repo. Commit after each step so each change has its own commit you can link to.

## 0. Set up (5 min)

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh   # or follow https://learn.chatgpt.com/codex/cli
git clone https://github.com/rohansharmacode/Devdayopenai.git && cd Devdayopenai
npm install && npm test                # expect 18 passing
codex                                                  # choose "Sign in with ChatGPT"
```

Codex reads `AGENTS.md` in the repo root for project rules.

## 1. Code review (10 min)

In the Codex CLI, run `/review`, choose **custom instructions**, and paste:

> Review the whole codebase (src/, public/, test/) as if it were going to a real café tomorrow. Focus on correctness of pay and clock-in maths, timezone/DST bugs, permission checks in src/app.js, XSS in public/app.js, and anything that could let a worker take a shift they shouldn't. Give prioritised findings with file and line.

Screenshot the findings, because that screenshot is your evidence.

## 2. Let Codex fix the top findings (10 min)

> Fix the top 3 findings from your review. Add or update a test for each one in test/. Run npm test and make sure everything passes. Keep changes small.

Then commit with `git commit -am "Codex: fix review findings"`.

## 3. Let Codex add one small feature (10 to 15 min)

> Add an "Add to my calendar" feature: a GET /api/staff/:id/shifts.ics endpoint that returns that person's upcoming shifts as a valid iCalendar feed (VCALENDAR/VEVENT, UTC times, stable UIDs, CRLF line endings). Workers can only fetch their own feed, and the manager can fetch anyone's. Add a "Add to my calendar" link in the worker view's "My rota" card that downloads it. Add tests for the ICS output and the permissions. Run npm test.

Commit with `git commit -am "Codex: add iCalendar feed for worker shifts"`.

## 4. Record the example (5 min)

In README.md, replace the `CODEX-EXAMPLE` placeholder with:

- One finding Codex caught in review, in a sentence, and the fix commit link.
- The feature Codex added, with its commit link, and a note that the tests went from 18 to N passing.
- Optionally, a screenshot of the Codex session in `docs/`.

If you'd rather, paste the review output into the thread and I'll write this section for you.
