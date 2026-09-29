# Two games, one server

The main page asks what you want to play:

| | URL | What it is |
| --- | --- | --- |
| **Frontline: Voxel Warfare** | `/bf/` | 2.5D voxel combined-arms shooter — described below |
| **CS Top-Down** | `/cs/` | The original top-down tactical shooter: bomb defusal, buy menu and economy, fog of war, 25 weapons, grenades, 4 maps (code in `src/cs/`, tools in `tools/cs/`) |

Each game has its own rooms, room codes, invite links and public room list; one Node process serves both
(`src/server/index.js` routes `/bf/*`, `/cs/*` and their WebSockets `/bf/ws`, `/cs/ws`). Both home screens have a
"Switch game" link back to the picker.

# Frontline: Voxel Warfare

A 2.5D **voxel combined-arms shooter** for the browser — big destructible maps, Conquest / Rush / Team Deathmatch,
four classes with deep weapon attachments, gadgets, revives, squads and drivable ground, water and air vehicles.
Bots fill every empty slot, so a match is always possible; friends join with a 4-letter room code or an invite link.
No accounts, no build step, all audio synthesised (nothing to download).

> "Frontline: Voxel Warfare" is a placeholder title — change it in `src/client/index.html` and `src/server/index.js`.

## Features

- **2.5D voxel look**: the world is built from blocks with real height (buildings, walls, crates, trees, water, roofs that
  fade when they would hide you); soldiers and vehicles are stacked-sprite voxel models. Everything is drawn on a
  plain 2D canvas with pre-rendered chunks — no WebGL required.
- **Full destruction**: every wall, house, sandbag and crate has hit points. Tank shells, rockets, C4, grenades and
  exploding barrels punch holes layer by layer (rubble and debris stay behind). Late joiners receive the changes.
- **Game modes**
  - **Conquest** — capture and hold flags; the team holding more flags bleeds the other's tickets, kills cost tickets.
  - **Rush** — attackers arm / disarm M-COM stations (hold `E`) stage by stage while defenders spend limited tickets.
  - **Team Deathmatch** — first team to the kill target.
- **Classes**: Assault (medkits, grenade launcher), Engineer (rockets, repair tool, mines), Support (ammo, claymores, C4,
  LMGs), Recon (snipers, spawn beacon, motion sensor).
- **23 weapons + 4 attachment slots** (optic, barrel, underbarrel, magazine) with real trade-offs; underbarrel
  grenade launchers / masterkey shotguns as alternate fire (`F`).
- **Vehicles**: quad, jeep, APC, tank, attack helicopter and boat. Driver + gunner seats, mounted turrets, crushing,
  ramming, damage states, repair and stealing empty enemy vehicles.
- **Battlefield-style flow**: deploy screen with a spawn map (base / flag / squad-mate / beacon), squads of four,
  revive with the defibrillator, health regeneration, spotting, kill feed, score popups, scoreboard.
- **Maps** (all 7 flags, mirrored, generated procedurally and validated): **Riverside Crossing**, **Harbor Siege**,
  **Dune Ridge** — plus four small legacy arenas for Team Deathmatch.
- **Bots** (easy → expert) that follow objectives in squads, drive and gun vehicles, revive, repair, fire rockets
  and drop supplies.
- Server-authoritative netcode at 60 Hz with **client prediction** (on foot and vehicle driver) and **lag compensation**.

## Play

```bash
npm install
npm start
```

The server prints the addresses it is reachable on (Local / Network). Open it, pick **Frontline** on the game picker, enter a nickname and hit
**Quick play** for an instant Conquest match vs bots, or **Create room**, copy the invite link and send it to friends.
The host tunes map, mode, team size (up to 16v16), bots, difficulty, tickets and vehicles, then starts the match.

### Playing over the internet

One Node process serves both the page and the WebSocket, so anything that exposes port 3000 works:

| Option | How |
| --- | --- |
| Tunnel from your PC | `npx cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000` |
| Any VPS / Raspberry Pi | `npm ci --omit=dev && PORT=3000 node src/server/index.js` (Caddy/nginx for HTTPS) |
| Docker | `docker build -t frontline . && docker run -p 3000:3000 frontline` |
| PaaS (Fly.io, Render, Railway, Coolify…) | Deploy the Dockerfile (`render.yaml` and `fly.toml` are included); listens on `$PORT`, health check at `/healthz` |

Keep it at a single instance — all rooms live in that process's memory. Env vars: `PORT` (3000), `HOST` (0.0.0.0).

## Controls

| Key | Action |
| --- | --- |
| `W A S D` | Move (in vehicles: throttle / steer; helicopter: forward / strafe) |
| `Shift` | Sprint |
| `C` | Walk (quieter, more accurate) |
| Mouse | Aim — the camera leans toward the cursor |
| Left click | Fire |
| Right click (hold) | Aim down sights / zoom (scoped movement is slower). With C4: detonate |
| `R` | Reload |
| `F` | Toggle alternate fire (grenade launcher / masterkey) |
| `E` | Use: enter / exit vehicle, revive, arm / disarm M-COM (hold), capture context actions |
| `1`–`6` | Primary, sidearm, gadget 1, gadget 2, grenade (again to cycle), knife · `X` last weapon · mouse wheel |
| Vehicle: `1`–`4` / `E` | Switch seat / exit |
| `Space` | Brake (vehicles) |
| `Q` | Spot an enemy or point (shown to the team) |
| `L` | Open the loadout editor (applied on next deploy) |
| `Tab` | Scoreboard · `M` big map |
| `Enter` / `U` | Team chat · `Y` all chat |
| `Esc` | Menu (team, volume, leave) |
| Dead / spectating | Click cycles players · `G` free camera · `N` toggle fog of war |

## Project layout

```
src/
  landing/     the game picker page
  cs/          the original CS Top-Down game (client/ server/ shared/), same layout as below
  shared/      Frontline rules used by BOTH server and browser
    constants.js weapons.js vehicles.js gamemap.js movement.js vision.js maps/…
  server/      authoritative simulation (Node, `ws`)
    index.js     HTTP static files + WebSocket + rooms manager + 60 Hz loop
    room.js      lobby, settings, teams, bots, message routing
    game.js      spawning, squads, corpses / revive, deploy, per-match map
    modes/       conquest.js rush.js tdm.js
    combat.js    hitscan + lag compensation, damage, kills
    vehicles.js  projectiles.js gadgets.js grenades.js world.js (explosions, tile damage)
    snapshot.js  bot/{brain,nav}.js
  client/      plain ES modules, no build step
    js/game/     prediction, renderer (terrain.js voxel.js render.js fx.js), fog of war, minimap, input
    js/ui/       home, lobby, deploy / loadout, HUD
tools/         validation, simulation, fuzz, integration and browser (Playwright) helpers
```

## Development

```bash
npm run dev                               # restart on change
npm test                                  # both games: maps, mechanics, bot sims, fuzz, lag comp, WebSocket integration
node tools/cs/sim.js dust 300 5 hard      # same tools for CS Top-Down live in tools/cs/
npm run maps                              # validate maps (reachability, vehicle spawns); `node tools/preview-maps.js harbor` prints ASCII
node tools/sim.js riverside 300 8 hard conquest   # headless bot match: map, seconds, team size, difficulty, mode
node tools/mechanics.js                   # scripted checks: revive, vehicles, C4, destruction, M-COM…
node tools/botstats.js harbor 300 16      # bot behaviour + tick cost + bandwidth at 16v16
CS_DEBUG=1 npm start                      # enables developer commands (teleport, give, enter vehicle, …)
npx eslint src tools                      # lint
```

Adding a map: create `src/shared/maps/yourmap.js` (procedural with `MapBuilder` in `maps/builder.js`, or plain ASCII rows),
register it in `maps/index.js` and run `npm run maps`. Maps declare their `modes`, 7 flags (or `rush` M-COM stages) and
vehicle spawns; bots navigate any map automatically.

Tile legend: `#` bedrock · `B` brick wall · `M` metal · `X` crate · `o` barrel (explodes) · `=` window · `L` low wall ·
`G` glass · `T` tree · `.` `,` `;` `_` floors · `~` deep water · `w` shallows.
