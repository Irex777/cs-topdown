# Two games, one server

The main page asks what you want to play:

| | URL | What it is |
| --- | --- | --- |
| **Voxel Frontline** | `/bf/` | First-person 3D voxel combined-arms shooter — described below |
| **CS Top-Down** | `/cs/` | The original top-down tactical shooter: bomb defusal, buy menu and economy, fog of war, 25 weapons, grenades, 4 maps (code in `src/cs/`, tools in `tools/cs/`) |

Each game has its own rooms, room codes, invite links and public room list; one Node process serves both
(`src/server/index.js` routes `/bf/*`, `/cs/*` and their WebSockets `/bf/ws`, `/cs/ws`). The Voxel Frontline menu's **Exit** button and the CS home's
"Switch game" link lead back to the picker.

# Voxel Frontline

A first-person **3D voxel combined-arms shooter** for the browser — big destructible maps, Conquest / Rush / Team Deathmatch,
four classes with deep weapon attachments, gadgets, revives, squads and drivable ground, water and air vehicles.
Bots fill every empty slot, so a match is always possible; friends join with a 4-letter room code or an invite link.
No accounts, no build step, all audio synthesised (nothing to download).

> The look follows a golden-hour "ruined city" key art: friendly soldiers, markers and flags are always **blue**, enemies **red** — whichever team you are on.

## Features

- **Real first person**: you see through your soldier's eyes with an animated weapon in your hands — voxel guns built from your
  loadout (optic, muzzle device, grip, magazine), walk bob, sprint pose, aim-down-sights with proper zoom and scopes, recoil
  kick, reload and weapon-switch animations. In tanks, jeeps, boats and helicopters the camera chases from behind. The
  world is built from cubes with real height and dynamic shadows, drawn with three.js (vendored in `src/client/vendor/three`,
  no build step).
- **Real height in the simulation**: look up and down, jump onto sandbags and crates, crouch behind cover. Bullets fly through the
  3D world — cover only stops them below its top edge, so you can shoot over sandbags, hit crouching enemies low, and
  land **headshots** (2x damage). Aircraft can be shot at only by aiming up at them.
- **Full destruction**: every wall, house, sandbag and crate has hit points. Tank shells, rockets, C4, grenades and
  exploding barrels punch holes layer by layer (rubble and debris stay behind). Late joiners receive the changes.
- **Game modes**
  - **Conquest** — capture and hold flags; the team holding more flags bleeds the other's tickets, kills cost tickets.
  - **Rush** — attackers arm / disarm M-COM stations (hold `E`) stage by stage while defenders spend limited tickets.
  - **Team Deathmatch** — first team to the kill target.
- **Classes**: Assault (medkits, grenade launcher), Engineer (rockets, repair tool, mines), Support (ammo, claymores, C4,
  LMGs), Recon (snipers, spawn beacon, motion sensor).
- **Nine weapons and twelve attachments**: AR-7 assault rifle, BR-12 battle rifle, VX-9 SMG, SG-4 shotgun, MG-60 LMG,
  DMR-14 marksman rifle, SR-50 sniper, P-18 pistol and the RL-80 rocket launcher — with Red Dot, Holographic, 4X Scope,
  Sniper Scope, Suppressor, Compensator, Vertical Foregrip, Angled Grip, Laser Module, Flashlight, Extended and Drum magazines.
  Every weapon and attachment is drawn as a voxel model (loadout cards, kill feed, HUD panel and first-person view).
- **Armor**: a plate bar next to your health absorbs half of every hit until it is gone; Support carries the most, Recon the
  least, and ammo crates refill it.
- **Vehicles**: quad, jeep, APC, tank, attack helicopter and boat. Driver + gunner seats, mounted turrets, crushing,
  ramming, damage states, repair and stealing empty enemy vehicles.
- **Full menu + HUD**: a 3D key-art main menu (Play / Loadout / Customize / Settings), ticket bars and flag icons, compass,
  rotating minimap, squad panel, health + armor, weapon panel with fire mode, kill feed with weapon silhouettes, and world markers
  with distances in metres.
- **Battlefield-style flow**: deploy screen with a spawn map (base / flag / squad-mate / beacon), squads of four,
  revive with the defibrillator, health regeneration, spotting, kill feed, score popups, scoreboard.
- **Maps** (all 7 flags, mirrored, generated procedurally and validated): **River Basin** (golden hour), **Harbor Siege** (dusk),
  **Dune Sea** (noon) — plus four small legacy arenas for Team Deathmatch.
- **Bots** (easy → expert) that follow objectives in squads, drive and gun vehicles, revive, repair, fire rockets
  and drop supplies.
- Server-authoritative netcode at 60 Hz with **client prediction** (on foot and vehicle driver) and **lag compensation**.

## Play

```bash
npm install
npm start
```

The server prints the addresses it is reachable on (Local / Network). Open it, pick **Voxel Frontline** on the game picker, enter a nickname and press **Play → Quick play** for an instant Conquest match vs bots, or **Create room**, copy the invite link and send it to friends.
The host tunes map, mode, team size (up to 16v16), bots, difficulty, tickets and vehicles, then starts the match.

### Playing over the internet

One Node process serves both the page and the WebSocket, so anything that exposes port 3000 works:

| Option | How |
| --- | --- |
| Tunnel from your PC | `npx cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000` |
| Any VPS / Raspberry Pi | `npm ci --omit=dev && PORT=3000 node src/server/index.js` (Caddy/nginx for HTTPS) |
| Docker | `docker build -t voxel-frontline . && docker run -p 3000:3000 voxel-frontline` |
| PaaS (Fly.io, Render, Railway, Coolify…) | Deploy the Dockerfile (`render.yaml` and `fly.toml` are included); listens on `$PORT`, health check at `/healthz` |

Keep it at a single instance — all rooms live in that process's memory. Env vars: `PORT` (3000), `HOST` (0.0.0.0).

## Controls

| Key | Action |
| --- | --- |
| `W A S D` | Move relative to where you look (in vehicles: throttle / steer; helicopter: forward / strafe toward the view) |
| Mouse | Look and aim (click the screen once to capture the mouse; `Esc` releases it and opens the menu) |
| Left click | Fire |
| Right click (hold, or toggle in the menu) | Aim down sights / scope (slower, much more accurate); with C4: detonate |
| `Shift` | Sprint (only forward; you cannot shoot while sprinting) |
| `Space` | Jump — hop onto low cover; brake in wheeled vehicles |
| `C` | Crouch (hold): smaller target, slower, steadier aim |
| `R` | Reload |
| `G` | Grenade (again to cycle types) · `X` knife |
| `E` | Use: enter / exit vehicle, revive, arm / disarm M-COM (hold) |
| `1`–`4` | Primary, sidearm, gadget 1, gadget 2 · mouse wheel cycles · `B` last weapon |
| Vehicle: `1`–`4` / `E` | Switch seat / exit |
| `Q` | Spot an enemy or point (shown to the team) |
| `V` / middle click | Ping a location |
| `L` | Open the loadout editor (applied on next deploy) |
| `Tab` | Scoreboard · `M` big map |
| `Enter` / `U` | Team chat · `Y` all chat |
| `Esc` | Menu: team, squad, volume, sensitivity, field of view, invert Y, toggle aim |
| Dead / spectating | Click cycles players (you see through their eyes) · `H` free camera (`WASD` fly, `Space`/`C` up/down) · `N` toggle the team-sight filter |

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
    js/game/     prediction, mouse-look + recoil, three.js renderer (render.js world3d.js models3d.js fx3d.js overlay.js), first-person viewmodel (viewmodel.js), minimap, input
    js/ui/       main menu (home.js + menu3d.js key art), lobby, deploy, loadout editor (kit.js), HUD, settings
  client/assets/ glTF models + PBR textures made in Blender (weapons/ vehicles/ soldier hands attachments props tex/)
tools/         validation, simulation, fuzz, integration and browser (Playwright) helpers
  blender/     the asset pipeline (headless Blender via `pip install bpy`), see below
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
node tools/vehcheck.js 240 10 -v          # vehicle sizes: spawn clearance, can each vehicle reach the flags, bot drivers standing still
CS_DEBUG=1 npm start                      # enables developer commands (teleport, give, enter vehicle, …)
npx eslint src tools                      # lint
```

### Blender asset pipeline

Every model in the first-person view, on soldiers, on vehicles and in the world is authored in code with Blender's Python API
(`pip install bpy`, no GUI needed) and exported to glTF; the game loads them at runtime (`src/client/js/game/assets.js`) and keeps the
procedural voxel models as fallbacks until the files arrive or if Graphics is set to Low.

```bash
python3 tools/blender/build_weapons.py       # 9 guns  -> assets/weapons/*.glb   (named empties: muzzle, ads, mount_optic, grip_r …)
python3 tools/blender/build_attachments.py   # 12 attachments + hands.glb
python3 tools/blender/build_characters.py    # soldier.glb (legs swing, weapon mount; uniform/helmet/vest/accent get re-tinted per team)
python3 tools/blender/build_vehicles.py      # tank jeep apc quad heli boat
python3 tools/blender/build_props.py         # crate, barrels, sandbags, tree -> props.glb
python3 tools/blender/build_textures.py      # seamless PBR sets (albedo/normal/roughness) baked with Cycles -> assets/tex/
python3 tools/blender/montage.py out.png brick:c brick:n --tile   # contact sheet to eyeball tiling
```

The game steps Graphics down one level by itself when it runs under ~24 fps (until you pick a level in Esc → Graphics).

Add `--preview` to a build script to render pictures into `/tmp/bl_preview/`. Units are metres (the game uses 16 px per metre).

Adding a map: create `src/shared/maps/yourmap.js` (procedural with `MapBuilder` in `maps/builder.js`, or plain ASCII rows),
register it in `maps/index.js` and run `npm run maps`. Maps declare their `modes`, 7 flags (or `rush` M-COM stages) and
vehicle spawns; bots navigate any map automatically.

Tile legend: `#` bedrock · `B` brick wall · `M` metal · `X` crate · `o` barrel (explodes) · `=` window · `L` low wall ·
`G` glass · `T` tree · `.` `,` `;` `_` floors · `~` deep water · `w` shallows.
