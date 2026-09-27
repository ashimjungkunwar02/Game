# Football Career 27

A mobile-first, text-driven **footballer career** sim. One HTML file, one data file, no build step,
no backend, no account. You are not the manager and you are not the club: you are the player, and
everything in the game is something a player can actually influence — minutes, body, money, image,
contract, country.

```
open index.html            …or:  python3 -m http.server 8080   →  http://localhost:8080
```

Everything persists to `localStorage` after every action; save codes export/import as text.

---

## Start

Open `index.html` — that is the whole app. It needs exactly two files in one folder (`index.html`
+ `db.js`) and nothing else: the universe arrives through a plain `<script src="db.js">` tag, so
there is no `fetch`, no CORS rule and no build step — it runs from `file://` as happily as from a
static server (`python3 -m http.server 8080`). Fonts and Tailwind come from CDNs; after a warm
cache the game still plays offline, just plainer-looking.

Two ways in, both from the same universe:

| Mode | You are | What you pick |
|---|---|---|
| **A — Real Player Career** | An existing professional from the 2026/27 pool — 3,125 real players with their real attributes, in a searchable browser, and the same names are your rivals for the Golden Boot. You take over his attributes, age, club, wage and contract situation and play out what is left of his career. | The player |
| **B — Create Your Own** | A 16–22 year old with a blank name. | Club (any of 192 clubs across 10 divisions), position, nationality, starting OVR budget and difficulty |

Difficulty is not cosmetic: `amateur` / `pro` / `elite` scale how fast manager favour moves, how
much bigger injuries get, and how much money is on the table.

## The universe lives in `db.js`

`index.html` contains the engine and every screen. `db.js` contains the *world* — and the engine
reads nothing else about real football. To ship a newer dataset you replace `db.js`; the
simulation never needs to change. Rows are deliberately compact `|`-delimited strings:

```
nations:  "CODE|Name|Strength|Confed"              strength 40–92
clubs:    "Name|SHORT|Strength|capacity|networth"   strength 55–92
players:  "Name|NAT|POS|OVR|AGE|clubSHORT[|pace,shooting,passing,dribbling,defending,physical]"
            the attribute tail is optional: with it, that player's six are real; without it,
            the game models them from OVR + position + a name-seeded variance
coaches:  "Name|NAT|Tactic|Age|clubSHORT"            …or INTL:<NATCODE> for a national job
leagues:  { code, name, confed, tv, divs: [[top division rows], [second division rows]],
            promotion: { auto, playoff, legs, cross, gapRule, final, finalName },
            relegation: { … } }
```

Shipped: **5 leagues × 2 divisions (192 clubs, 10 divisions), 3,125 real players — every one of them
with the six attributes the export carried — 99 real coaches with a tactical identity, 150 national
teams, per-position attribute templates, and a real international calendar.** Named first XIs exist
for 174 of the 192 clubs; the other 18 (mostly second-tier sides the export does not list) are filled
by the generator, which is what the game has always done. Regens are generated from name parts as seasons go by, so new names keep arriving.
Nothing in the engine is hard-coded to a club or a league, so an out-of-date file cannot silently
half-work: `node tools/validate-db.js` reads the dataset the way the engine does and fails loudly on
a broken one — division `size` must equal the number of club rows, codes must be unique, every
player's club code and position template must exist, every tactic must resolve, play-off seeds must
sit inside the division, and a World Cup cycle must actually be four years apart.

Rules are read *from* the data, not hard-coded: promotion, relegation, play-off format, number of
legs, cross-division ties and the "big gap, no play-off" test all come from each league's entry.
So the Championship settles 3rd v 6th and 4th v 5th over two legs with a one-off final at Wembley,
the Bundesliga plays its `Relegations-Playoff` against 2. Bundesliga's 3rd, Serie B only plays off
when the gap is under five points, and the Premier League just drops three.

### How the player export got in

`players.csv` at the repo root is the supplied dataset (19,789 men's and women's rows, EA FC 27
column names). `tools/import-players.js` is the only thing that reads it:

```
node tools/import-players.js players.csv                      # report only, nothing written
node tools/import-players.js players.csv --report=map.txt     # every club pairing, one line each
node tools/import-players.js players.csv --strengths          # db strength vs the imported best XI
node tools/import-players.js - --squad=14 < export.csv        # stdin, thinner squads
node tools/import-players.js players.csv --apply              # rewrite db.js
```

What it decides, and why:

- **Gender is a filter, not a column.** Rows the file marks as women's football are dropped
  (1,940 of them); a blank gender is kept, because most men's exports have no such column.
- **A club is matched by alias, then by name inside its own country's leagues.** `TOT → spurs`,
  `MUN → man utd`, `INT → Lombardia FC` (the export ships some Serie A clubs anonymised). Fuzzy
  matching across countries is how Barcelona briefly acquired Barcelona SC of Guayaquil, so the
  matcher will now only accept a name match from a league belonging to that club's country, and
  reserve/B teams never qualify. 175 of 192 clubs pair up.
- **OVR is the file's overall, attributes are the file's profile.** Our position weights read
  3.1 points off the export's overall on average, so each imported six is shifted as a set until
  the game's own formula reproduces that player's overall. Real strengths and real weaknesses
  survive; a takeover does not jump the moment the game recalculates.
- **Squad cap, not full rosters.** 18 outfielders per club (min 17, median 25 rows per squad) keeps
  db.js at ~198 KB and every division populated; fringe names are the first to go.
- **Age comes from `birthdate`, measured at the snapshot date** (2026-07-01), not from a column that
  may be missing.
- **Nations are added as needed.** The file knows 150 countries; the ten leagues knew 70. The
  importer appends the missing nation rows to `db.js`, with strength from a ladder over that
  country's best imported player, so `NATION[code]` never misses and a Guinean or Kosovar can be
  called up.
- **One name, one player.** Duplicates across clubs are dropped (the search box and a takeover key
  off the name).
- **`club.str` is left alone.** Where the imported best XI averages higher than the strength the
  game set, `--strengths` shows the gap (31 clubs sit more than 5 out, all of them lower-division).
  Strength also carries balance meaning in the engine — the value, wage and trust models are
  calibrated on it — so it is a deliberate choice, not an oversight, to leave it and let the report
  speak.

`--apply` rewrites exactly two arrays in `db.js` (`players:` and `nations:`) and never touches the
leagues, rules or clubs. `node tools/validate-db.js` is the check afterwards.

## What the game actually simulates

**Attributes → OVR → minutes.** Six attributes, each with a mechanical job (pace creates the
chance, shooting converts it, passing unlocks the press, dribbling wins the one-v-one, defending
and physical keep you on the pitch). OVR is position-weighted, so the same numbers make a different
player at CB and at RW.

**Manager trust gates everything.** Trust 0–100 with hysteresis: 75 to walk into the XI, 65 to hold
it, 40 to make the bench, 35 to fall out of the squad. A reserve gets zero prompts, a sub gets one,
a starter gets three or four. The match rating moves trust, and a bad week at a big club is a real
thing that happens to you.

**The match is interactive.** A live ticker with graded outcome bands (clinical / good / error /
miss) built from a `checkSuccess` roll that knows the attribute, the difficulty, the opponent's
tier, your fatigue and your last three ratings. Shooting a third time in one game is harder and the
gaffer notices. Every prompt changes your rating, and your rating changes your life.

**Stamina is a career risk, not a bar.** Fatigue accumulates across consecutive 90s, raises injury
probability, and degrades every check. A bad tackle can end with anything from a twisted ankle (two
weeks) to an ACL tear (seven months, permanent damage). While you are hurt the game becomes a
**medical wing**: each week you can buy a specialist, an elite rehab programme or immediate surgery
— real money, off the same account as the car — to cut recovery time and shrink the permanent loss.

**Contracts have clauses you negotiate.** Release clause, loyalty bonus, and performance subsidies
(€/goal, €/clean sheet) that pay on their own. Whether the club accepts is a function of your
leverage — agent tier, trust, goals, international standing, your role. A release clause also means
a bid at that number *cannot* be refused, which cuts both ways.

**Transfers, loans, windows.** January and June windows, a pool of realistic suitors, loan moves
with a wage haircut and guaranteed minutes, free agency when your deal runs out, and a mid-season
move that keeps your season stats and swaps your table rather than resetting anything.

**Decline and retraining.** From 31 the legs go first. `Retrain` spends three skill points to move
your game inside your position — trading pace or physical for passing, vision and touch — which is
how a career gets lengthened. Playstyle is derived, not chosen: Enforcer, Regista, Glass Cutter,
Target Man, Old Head.

**Nations, and Tournament Mode.** A real ladder (youth → call-up → regular → captain) gated on OVR
and trust, Nations League as a grouped mini-league inside the autumn windows, qualifying in the
spring ones, friendlies in the gaps. World Cups every four years, Euros and the equivalent trophy on
every other continent. In a tournament summer the end of the domestic season hands over into
**Tournament Mode**: group, then knockout, one match a week, and you go home when you lose.

**Everything else that makes a career.** 38 weighted weekly events (agents, boardrooms, tabloids,
injury markets, loan recalls, relegation fights, a regens chase, a vet clinic), press conferences
with answers that land in the feed, away days where you choose how the 40 hours are spent, a
lifestyle marketplace where cars and property buy popularity and popularity buys sponsors, recovery
gear that buys energy, a volatile investment portfolio, social posts, yellow cards and bans, a
season review with awards and the Golden Boot race, trophies and honours, and a Hall of Fame
epitaph at the end.

**Coach Rebirth.** Retire at 35–38 and the career does not have to stop: your player asset converts
into a *manager* save on the same universe state — same club, same table, same squad you played in
with you, a board-confidence number that drops when you lose and ends the save when it hits the
floor.

## Balance model (the numbers the sim is built on)

```
OVR      Σ(attr × weight), weights per position (ST .18/.30/.10/.16/.02/.24 … CB .14/.06/.14/.06/.38/.22)
trust    rating <5.5 −10 · <6.5 −4 · <7.5 +2 · <8.5 +7 · ≥8.5 +13, × difficulty
success  clamp(38 + (attr−30)·1.02) − difficulty − opponent tier − fatigue/4.4 + form + energy/morale/chemistry
goal     0.36 · chanceMult · (1+tactic) · 0.86^(shots−2), clamped .12–.58
xG       clamp((1.44 + ΔSTR·0.045 + home) · tactic nudges, .3, 3.7) per club per match
value    ((ovr−46)/49)^4.2 × €140M × age × tier × division × contract × form → €75K … €235M
wages    capped at €900K/wk gross, 45% tax; sponsors pop²×2.6; agents take a cut of wage and fees
energy   cap 96–114 (physical), −25 per 90, recovery 45+…/wk; fatigue 0–100, drives injuries
injury   severity weight = fatigue·1.35 + age + challenge, bucketed into 9 injuries (1–28 weeks)
```

## Testing

No browser is needed to know whether the game is broken. Three node scripts run the *real* code out
of `index.html` under a DOM stub:

```
node tools/check.js       syntax of the inline script
node tools/validate-db.js  the universe file: schema, uniqueness, ranges, play-off rules
node tools/pool-coverage.js  how many real named players each of the 192 clubs carries — the
                            gap a supplied export is meant to close (tools/import-players.js
                            turns any FIFA/FBref-shaped CSV into db.js rows, men's only)
node tools/simulate.js      plays scripted careers + a 36-config sweep (6 positions × 6 clubs
                            across 5 countries × 7 seasons) and checks invariants every week:
                            table integrity, games played, goals/game, apps, energy, fatigue,
                            OVR/trust ranges, then a save round-trip
node tools/uismoke.js       renders every tab and every modal and calls ~50 handlers, so a
                            click that would throw in a browser throws here instead
node tools/pageorder.js     walks index.html's <script> tags in document order and executes them the
                            way an HTML parser would — external files included. It fails if the page
                            does not load db.js before the engine reads window.FC27_DB. Every other tool concatenates
                            the two files by hand, so this is the only one that can catch a page that forgot its own
                            data (which happened: v1.5 split the world out and never added the tag)
```

Current state: **DB valid (192 clubs, 3,125 players, 99 coaches, 150 nations)**, sweep clean across
36 careers / 11,592 simulated weeks, UI smoke clean, save round-trips — the state is ~650 KB of it
and the stored save ~112 KB, because the pool is written back as a delta against `db.js` (only the
players whose rating, age or season tally moved, plus regens) rather than 3,125 objects per write. Careers come out looking like careers — a 17-year-old at a Championship club fighting
to hold a bench spot, a 96-OVR takeover at a top club scoring 28–50 a season across all
competitions, a centre-half with 15 goals in eight seasons and a knee problem.

## Deliberate choices

- **Real numbers where the export has them.** An imported player keeps his six attributes; a generated
  one and the 18 uncovered clubs keep the modelled ones. The two coexist because the only contract the
  engine has with the data is `Name|NAT|POS|OVR|AGE|club`, and the attribute tail is optional.
- **The men's game only.** No women's competitions and no mixed pools: the universe is the men's
  divisions, and any supplied dataset is filtered to them on the way in (`tools/import-players.js`
  drops the rows a file marks as women's and keeps everything else, blank gender included).
- **Real names by default.** Clubs, players, coaches, leagues and national teams are the real 2026/27
  set, held in `db.js`. Names you invent are not the product here; the universe is.
- **Regens.** Retired and near-retired names are replaced over the seasons, so the pool keeps
  turning while you play: new surnames arrive at 16–18 and old ones fall out of the roster.
- **Player-side economy.** Value €75K → €235M, wages capped at €900K/week. A career should feel rich,
  not like owning the league.
- **One file.** The engine and the UI stay in `index.html`; only the world data is external. Tailwind
  comes from the CDN. No framework, no bundler, no dependencies to install.
- **Text is the game.** There are no sprites and no video: the pitch is in the writing, and the
  interface is a glass night-stadium shell with a bottom tab bar, built to read like a native app on
  a phone.
