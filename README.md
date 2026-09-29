# CS Top-Down

A top-down, Counter-Strike-style team shooter for playing with friends in the browser.
Plant the bomb, hold the site, out-play the other team — with fog of war, a real economy,
grenades that matter, and bots that fill any empty slot so a game is always possible.

- **Bomb defusal** (T vs CT) with buy menu, economy, halftime and overtime — or **Team Deathmatch**
- **Fog of war**: you only see what your character can see (vision cone + walls + smoke)
- **25 weapons, 4 grenades** (HE, flash, smoke, molotov), armor, defuse kits, scoped snipers
- **Bots** (easy → expert) that buy, execute strategies, throw grenades, plant and defuse
- **3 maps**: Dust (large 5v5), Warehouse (symmetric, medium), Pit (small arena)
- **Rooms with a 4-letter code and invite link** — friends join in one click, no accounts
- **Spectating**, team chat, pings, kill feed, scoreboard, radar, 100% synthesised audio (no downloads)
- Server-authoritative netcode with **client-side prediction** and **lag compensation**

## Play with friends

```bash
npm install
npm start
```

The server prints the addresses it is reachable on:

```
Local:    http://localhost:3000
Network:  http://192.168.1.23:3000   <- friends on your Wi-Fi/LAN use this
```

1. Open the page, pick a nickname, hit **Create room**.
2. Click **Copy invite link** and send it to your friends. (Or give them the 4-letter code.)
3. Everyone picks a team. Tune the match settings (map, rounds, team size, bots, friendly fire).
4. The host presses **Start match**. Empty slots are filled with bots; if a friend joins later, a bot makes room for them at the next round.

You can also hit **Quick play vs bots** for an instant 5v5 on your own.

### Playing over the internet

The game is a single Node process serving both the page and the WebSocket, so anything that can expose port 3000 works:

| Option | How |
| --- | --- |
| Tunnel from your PC (easiest) | `npx cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`, then share the HTTPS link it prints |
| Any VPS / Raspberry Pi | `npm ci --omit=dev && PORT=3000 node src/server/index.js` (put it behind Caddy/nginx for HTTPS if you like) |
| Docker | `docker build -t cs-topdown . && docker run -p 3000:3000 cs-topdown` |
| PaaS (Fly.io, Render, Railway…) | Deploy the Dockerfile (a `render.yaml` blueprint and `fly.toml` are included); the app listens on `$PORT` and has a `/healthz` endpoint |

Environment variables: `PORT` (default 3000), `HOST` (default `0.0.0.0`).
The server keeps everything in memory; rooms disappear shortly after the last player leaves.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` | Move |
| `Shift` | Walk (silent, more accurate) |
| Mouse | Aim — the camera leans toward the cursor |
| Left click | Fire / throw grenade toward the cursor |
| Right click (hold) | Scope with SSG 08 / AWP / SG 553 / AUG: see farther, move slower |
| `R` | Reload |
| `E` | Hold to plant / defuse, tap to pick up a weapon |
| `B` | Buy menu (`1`–`6` picks a column, then an item number). `X` re-buys your last loadout |
| `1` `2` `3` `4` | Primary, pistol, knife, grenades (press `4` again to cycle types) · `Q` last weapon · mouse wheel |
| `G` | Drop weapon |
| `Tab` | Scoreboard · `M` big map |
| `Enter` / `U` team chat · `Y` all chat | |
| `V` or middle click | Ping a location for your team |
| `Esc` | Menu: change team, volume, view size, leave |
| Dead? | Click or `Space` cycles through teammates. Spectators: `F` free camera, `N` toggle fog |

## How the round works

- Freeze time (8 s) → live round (1:55). T must plant at site A or B (hold `E` on the site, 3.2 s); the bomb explodes after 40 s. CTs win by eliminating the T team, defusing (10 s, 5 s with a kit) or running out the clock.
- Money: $800 to start, $3,250 for a win, loss bonus $1,400 growing to $3,400, +$300 for plant/defuse, kill rewards by weapon (SMG $600, shotgun $900, knife $1,500…). Survivors keep their equipment.
- Halftime swaps sides. If the score is tied after all rounds, overtime is played (first to +4 with $10,000 each, sides swap every 3 rounds).
- Buying is allowed in your spawn zone during freeze time and for the first 20 s of a round.
- Friendly fire is optional (off by default); grenades and bullets don't hurt teammates unless it is on.

## Project layout

```
src/
  shared/     game rules used by BOTH server and browser
    constants.js  weapons.js  gamemap.js  movement.js  vision.js  maps/…
  server/     authoritative simulation (Node, `ws`)
    index.js    HTTP static files + WebSocket + rooms manager + 60 Hz loop
    room.js     lobby, settings, teams, bots, message routing
    game.js     rounds, economy, bomb, drops, buying
    combat.js   hitscan + lag compensation, damage, kills, weapon switching
    grenades.js snapshot.js  bot/{brain,nav}.js
  client/     plain ES modules, no build step
    js/game/    prediction & interpolation, renderer, fog-of-war, fx, minimap, input
    js/ui/      home, lobby, HUD / buy menu / scoreboard
tools/        simulation, balance, fuzz, integration and browser (Playwright) test helpers
```

How it works in one paragraph: clients send their inputs 60 times per second; the server steps the
same movement code the client uses (so prediction matches exactly), resolves shooting against
positions rewound to what the shooter was seeing, and sends each player a 30 Hz snapshot that
only contains what their team can currently see. The browser interpolates other players ~100 ms
in the past and draws the fog-of-war polygon with an exact tile ray-caster.

## Development

```bash
npm run dev          # restart on change
npm test             # map validation, bot simulation, fuzzing, WebSocket integration test
npm run maps         # validate maps (spawns & both sites reachable); `node tools/preview-maps.js dust` prints ASCII
node tools/sim.js dust 300 5 hard        # headless bot match: map, seconds, team size, difficulty
node tools/balance.js dust 6 5 normal    # win-rate / plant-rate statistics
CS_DEBUG=1 npm start                     # enables developer commands (teleport, give weapon, …) for testing
npx eslint src tools                      # lint
```

Adding a map: create `src/shared/maps/yourmap.js` (see `pit.js` — a tiny rectangle DSL or plain ASCII rows),
register it in `maps/index.js`, and run `npm run maps` to check connectivity. Bots navigate any map automatically.

Legend for map tiles: `#` wall · `X` crate · `o` barrel · `=` fence/window (see-through) · `L` low barrier ·
`.` `,` floor · `a` `b` bombsites · `t` `c` spawn zones.
