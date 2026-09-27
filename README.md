# Football Career 27

A deep, text-driven **football player career mode** — one file, no build step, no backend.
Start at 17 on the fringe of a bottom-division first team, finish with a legacy grade.
Mobile-first, designed to be installed to a phone home screen.

```
index.html            the entire game (HTML + CSS + ES6, Tailwind via CDN)
tools/simulate.js     headless balance harness — plays thousands of careers against the real engine
```

Open `index.html` directly, or serve it:

```bash
python3 -m http.server 8080 --bind 0.0.0.0
```

## The loop

One week = one decision ladder.

1. **Home** — next three fixtures, current form, manager objectives. Hit `PROCEED TO NEXT MATCH`.
2. **Matchday** — the ticker stops at 3–4 decision windows (1 if you come off the bench, 0 if you are
   in neither). Every option is resolved against the *attribute* it tests, on graded bands
   (clinical / good / error / miss), not a coin flip. Rating is live and visible the whole time.
3. **Report** — rating, objectives, payslip after tax, Manager Trust delta, popularity delta, injuries.
4. **Week resolution** — recovery, upkeep, portfolio mark-to-market, transfer window, a random life event
   (press, nightlife, a hospital visit, a hamstring that won't go away).

Between matches: **Training** (drills + skill points), **Career** (contract, agent, offers, nation),
**Lifestyle** (estates, cars, recovery gear, investments), **Hub** (live 20-club league, golden boot race,
trophy room, the world).

## Systems worth knowing about

| System | Model |
| --- | --- |
| **OVR** | position-weighted mean of six attributes — an ST and a CB with the same numbers are not the same player |
| **Selection** | Manager Trust with hysteresis: 75 to become a starter, 65 to keep it; 40/35 for the bench. Your OVR *over* your club's level is added to the promotion check, so outgrowing a club forces the manager's hand instead of rotting you on the bench |
| **Match checks** | `pc = clamp(38 + (attr−30)×1.05, 38, 94) − risk + form − fatigue − low-energy`; bands decide the outcome. Chance volume is capped by *team* quality, and a third shot from range is punished — shooting every time is not dominant |
| **Rating → trust** | non-linear (a 6.2 is a −4, an 8.5 is a +13), a winner +4, a brace +6, a red −8, capped at ±12 per week, halved for under-21s, and a reserve is never punished for not playing |
| **Energy** | cap scales with Physical (96–114). Recovery +45/wk base, capped gear bonus, match −25 (−14 sub, −6 unused), drill −18, low energy <30% costs 12% on every check and raises injury risk |
| **Development** | 7 attribute points per season from training, blocked above a potential-derived ceiling; big minutes at a good rating unlock a couple more. Age curve grows to ~25, peaks 27–29, then declines (Pace first) |
| **Market value** | `f(OVR) × ageMult × leagueTier × contractYears × form`, clamped to sane football economics — this is what clubs bid against |
| **Money** | gross wage → 45% tax → upkeep (cars, villas, staff, agent retainer) → sponsor income scaled by popularity. Portfolio marked every 4 weeks; expected value is close to zero and volatility is the product |
| **Injuries / bans** | 5 yellows = 1 match, a red = 2; injuries are more likely tired, congested, older, and mitigated by a physio retainer |

## Persistence

Autosaves to `localStorage` on every action, plus export/import of a base64 save code in Settings.
`gameState` is a single flat object with no functions or DOM in it, so saving is `JSON.stringify`.

## Testing the numbers

```bash
node tools/simulate.js
```

It boots the real script out of `index.html` under a stubbed DOM, plays full careers (worst-case
bottom club, best-case elite club, a centre-back), and sweeps 6 positions × 4 clubs × 7 seasons.
Every week asserts invariants — table integrity (`W+D+L = P`, goals-for = goals-against), a plausible
goals-per-game, energy inside its cap, role inside its set, attribute and value ceilings, retirement
actually happening. Any sim regression shows up there first, not on a phone.

## Deliberate choices

- **Names are fictionalised by default.** Leagues, clubs and stars are original (`Northgate United`,
  `K. Marbée`) so the world can be balanced around the simulation instead of around reality — and so
  nothing is infringing. `Settings → Real names` flips the labels to the real-world equivalents the
  game is modelled on; it changes display strings only, never the numbers.
- **Single file, CDN Tailwind.** Right for a prototype of this kind: zero build, shareable as a file.
  All the layout-critical CSS (glass cards, dock, safe-area insets, the match ticker) lives in a
  `<style>` block so the game still looks like itself if the CDN is blocked.

## Known edges

- Random events are 19 hand-written templates with a weighted engine behind them; the engine makes
  adding more a data job, but content volume is what a game like this actually lives on.
- Only your league is fully simulated each week; the other four advance their scorers and tables
  coarsely until you transfer into one.
- No sound, no online leaderboard, no achievements screen — all cheap to bolt on now that the state
  and the feed exist.
