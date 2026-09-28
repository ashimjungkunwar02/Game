# Data packs

A pack is content the game does not have to ship. India and Scotland live here, not in `db.js`, and
the game plays them exactly the same way: full squads, real rules, promotion where a second rung
exists, a cup where one does not.

## Using them

**In the game** — HUB → Universe (or the line at the bottom of the create screen). Every country in
the universe is a switch: off means no table, no names in the pool, no rows in your save. Packs listed
in `packs/manifest.js` have a **Download** button, which reads the file sitting next to this one and
installs it. A pack you got from someone else goes in through **Load a pack file** (`.js` or `.json`),
and **Export this selection** writes the leagues you switched on out as a pack you can send back.

**From the command line** — `node tools/make-pack.js IND SCO --apply` carves countries out of `db.js`
into a pack and rewrites `db.js` without them. It refuses to finish unless base + pack equals the old
file exactly (clubs, players, leagues), and it regenerates this folder's `manifest.js`.

Checks: `node tools/validate-db.js --with-packs` validates the composed universe the engine actually
plays in, and `node tools/packs.js` proves a pack behaves like a country — install, remove, toggle,
play three seasons in a six-club league, survive a save round-trip, and reject a malformed file with a
sentence instead of a crash.

## Writing one

A pack is a db.js-shaped object pushed onto a global. No build step, no fetch, no CORS — the game loads
packs with a `<script>` tag, which is why they work from `file://` as happily as from a host.

```js
(window.FC27_PACKS = window.FC27_PACKS || []).push({
  id: 'fc27-my-country',              // [A-Za-z0-9._-], used as the storage key
  name: 'My Country — Premier League',
  version: '2026/27',
  note: 'optional',
  leagues: [{
    code: 'MYP', name: 'My Country', confed: 'UEFA', tv: 0.34,
    note: 'the real rule this file cannot execute, if any',
    divs: [{
      code: 'MPS', name: 'Premier League', rep: 0.42, size: 18, cup: 'My Country Cup',
      clubs: [
        'Northport FC|NOR|68|14500|0.4B',   // Name|SHORT|Strength|capacity|net worth
        'Southgate FC|SOU|66|12000|0.3B'    // exactly the shape db.js uses, one per line
      ]
    }],
    promotion: { auto: 2, playoff: [3, 4, 5, 6], legs: 1, final: 'single', finalName: 'Play-off Final' },
    relegation: { auto: 2 }
  }],
  nations: [],                                   // 'CODE|Name|Strength|Confed' — only for a new country
  players: ['Ada Vermeer|NED|ST|71|24|NOR|78,72,66,74,38,65'],   // optional six attributes
  coaches: ['Rob Neve|MYP|gegenpress|44|NOR']                     // or INTL:<code> for a national job
});
```

Rules the loader enforces (`checkPack`, same file as the test):

- 1 or 2 `divs`, each with **4+ clubs**; a one-rung league moves nobody, which is a real property of
  most national top flights and not an error. Three rungs are rejected because the engine plays two.
- Club `SHORT` codes must be unique in the universe — they are how players, coaches and saves find you.
- Player rows are `Name|NAT|POS|OVR|AGE|clubSHORT[|pace,shooting,passing,dribbling,defending,physical]`.
  Names are the search key, so they have to be unique across the whole universe (the importer dedupes
  by keeping the higher-rated man). `POS` must be one of ST LW RW CAM CM CDM CB LB RB — a `GK` row is
  refused rather than silently turning into an outfielder.
- Every player's OVR must be what the six attributes add up to, per position weight. If you supply a
  tail, the engine will not adjust it; `node tools/import-players.js` is what shifts a set of six to
  reproduce a file's overall.
- A pack with the same league code as `db.js` **replaces** that league rather than doubling it — so a
  January update is a pack, not an edit of the universe file.

The universe panel, the create screen, the pool, the fixture generator, the transfer targets and the
save all read the composed result. Nothing is special-cased for packs, which is the only reason this
folder can hold a country the game has never heard of.

## Refreshing a country from live data (`tools/refresh.js`)

The base `db.js` and every pack here are snapshots. `tools/refresh.js` rebuilds a pack from a live
Wikipedia season article, so a country can be brought up to date without waiting for anyone to upload
a CSV. Run it where there is internet — it needs Node 18+ and nothing else:

```bash
node tools/refresh.js --search="2026 Campeonato Brasileiro Serie A" --out=packs/live-brasil.js
node tools/packs.js                      # the gate must stay green
# then restart the game and toggle Brasil on in HUB → Universe, or Import pack → paste the file
```

What it copies, what it derives, and what it cannot know:

| | |
| --- | --- |
| copied | club names, cities, stadiums, capacities, kit makers, managers |
| derived | each club's strength, from its points in that season's table (a mapping of points, not a rating) |
| not in the source | player ratings — squads are generated by the game's own pipeline, the same path a club with no rows takes |

Two flags matter when a parse looks wrong. `--dump=DIR` writes the wikitext it fetched, the section
headings it saw, the clubs it parsed and the pack it built — read `02-clubs.json` before trusting an
output, since a shrug of "20 clubs" is the failure mode to watch for. `--fixture=FILE --print-pack`
runs the same parser on local text with no network at all, and `--selftest` pins the parser to
`tools/fixtures/wp-brasileirao.txt` (hand-built in Wikipedia's real markup shapes, because this repo's
sandbox has no network to capture a page from):

```bash
node tools/refresh.js --selftest          # 16 checks, run this after touching the parser
```

Wikipedia text is CC BY-SA 4.0: the generated pack's `note` carries the article link and its history
link, so the attribution travels with the file. FBref, Sofascore and Transfermarkt forbid scraping in
their terms; this tool does not use them, and a pack built from them would not be distributable anyway.
An in-progress season has a table but not a settled one — the tool says so out loud and leaves clubs at
70 rather than inventing a rating.
