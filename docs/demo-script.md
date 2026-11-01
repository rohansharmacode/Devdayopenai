# Demo video script (target 75 seconds, hard limit 90)

**Setup.** Run `npm run reset`, then `npm start`. Put the manager window on the left and a phone-sized window as Tom on the right. Set Tom's location to "Simulate: at home" before recording. Record at 1080p with no notifications showing.

| Time | On screen | Say |
|---|---|---|
| 0:00 to 0:08 | Manager calendar | "Small cafés run rotas on WhatsApp. RotaBuddy is the rota, the time clock and the payroll maths in one simple app." |
| 0:08 to 0:20 | Tom's phone: tap **Simulate: at work**. It auto clocks in, and the ring goes green with £ ticking. | "Tom arrives at work. He's within 100 metres, so he's clocked in automatically. From home, it refuses." |
| 0:20 to 0:30 | Tom's "My pay", then the Week/Month toggle | "He sees what he's earned this week and this month, live." |
| 0:30 to 0:45 | Tom taps **Can't make it** on Monday, types "Uni exam got moved", taps **Find me cover** | "Tom can't do Monday. The app rules out anyone already working, on holiday or near 48 hours, then AI ranks who's left by skills, availability and hours, and asks the best people." |
| 0:45 to 0:55 | Manager: the red alert, then **Find cover**, showing the ranked list with reasons and the "Ranked by AI" badge | "The manager sees exactly why: Leo has barista and opening skills and is free Monday. Mei is excluded, because she'd break 48 hours." |
| 0:55 to 1:05 | Switch the right window to Leo: **Yes, I'll cover**. The calendar updates. | "Leo accepts with one tap. The rota, Tom's shifts and everyone's pay update." |
| 1:05 to 1:15 | Codex terminal: review findings, or the ICS feature commit | "We built it in Claude Code, then Codex reviewed it, fixed what it found and added calendar export." |
| 1:15 to 1:20 | Repo URL on screen | "RotaBuddy. Rotas that sort themselves out." |

**Before recording**, set `OPENAI_API_KEY` so the badge says "Ranked by AI". Do one dry run first. If venue wifi is slow, record with rules mode and say "ranks" instead of "AI ranks".
