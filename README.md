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
No accounts or build step. Battlefield loads 58 compact recorded sound assets, approximately 552 KiB in total.

> The look follows a golden-hour "ruined city" key art: friendly soldiers, markers and flags are always **blue**, enemies **red** — whichever team you are on.

## Features

- **Real first person**: you see through your soldier's eyes with an animated weapon in your hands — voxel guns built from your
  loadout (optic, muzzle device, grip, magazine), walk bob, sprint pose, aim-down-sights with proper zoom and scopes, recoil
  kick, reload and weapon-switch animations. In tanks, jeeps, boats and helicopters the camera chases from behind. The
  world is built from cubes with real height and dynamic shadows, drawn with three.js (vendored in `src/client/vendor/three`,
  no build step), with a post-processing chain (bloom, grading, vignette, ACES tone mapping, SMAA/MSAA) from the vendored
  `postprocessing` library on Medium and High graphics. Server rigid bodies (rubble, props, grenades) run on Rapier (WASM).
- **Elevated terrain on all seven maps**: River Basin has a river valley and farm hills; Harbor Siege rises from sea-level quays to the upper city; Dune Sea has dune ridges and mesa foothills. Dust has raised markets, Warehouse loading ramps, Foundry an upper furnace yard, and Pit a central depression. Buildings sit on level foundations, shores remain level, and routes have graded slopes. Walking, vehicle bodies and cameras, sight lines, bullets, rockets, grenades and explosions all use the same heightfield. The deployment map shows 2 m contours.
- **Buildings and vegetation at physical heights**: Harbor exteriors have two to four storeys, with taller houses on Riverside and Dunes. Brick courses and windows repeat per storey; roofs, door lintels, bullets and collisions use the same dimensions. Trees vary from 7 to 11 m. Infantry and helicopters can land on roofs.
- **Clear mounted sights**: armed gunner seats keep the protective shield out of first-person view, with the gun below the target area. RMB zoom uses a clear reticle view. The camera follows weapon elevation while the visible muzzle and shots share the same bore; the shield remains visible from outside the vehicle.
- **Real height in the simulation**: look up and down, jump onto sandbags and crates, crouch behind cover. Bullets fly through the
  3D world — cover only stops them below its top edge, so you can shoot over sandbags, hit crouching enemies low, and
  land **headshots** (2x damage). Aircraft can be shot at only by aiming up at them.
- **Physical destruction and interaction**: walls, glazing, rocks, containers, sandbags, fences, crates and trees break under fire and explosives. Unsupported roofs collapse into falling panels; masonry, wood and glass become server-authoritative rigid bodies with mass, friction, collisions and sleeping. Push, carry and throw crates or barrels. Falling debris can injure soldiers, tanks crush obstacles, and blasts excavate permanent terrain craters. Late joiners receive structural and terrain changes. Up to 128 physical pieces are retained; ordinary fragments expire after 90 seconds while map damage persists.
- **Spatial recorded audio**: gunfire, reloads, surface footsteps, material impacts, explosions and continuous motor/rotor loops use recorded samples, with directional HRTF audio, distance filtering, wall occlusion, propagation delay and a limited reverberation tail. See `src/client/assets/audio/CREDITS.md` for sources and processing.
- **Game modes**
  - **Conquest** — capture and hold flags; the team holding more flags bleeds the other's tickets, kills cost tickets.
  - **Rush** — attackers arm / disarm M-COM stations (hold `E`) stage by stage while defenders spend limited tickets.
  - **Team Deathmatch** — first team to the kill target.
- **Classes**: Assault (medkits, grenade launcher), Engineer (rockets, repair tool, mines), Support (ammo, claymores, C4,
  LMGs), Recon (snipers, spawn beacon, motion sensor).
- **Ten weapon models and twelve attachments**: AR-7 assault rifle, BR-12 battle rifle, VX-9 SMG, SG-4 shotgun, MG-60 LMG,
  DMR-14 marksman rifle, SR-50 sniper, P-18 pistol, RL-80 rocket launcher and Stinger anti-air launcher — with Red Dot, Holographic, 4X Scope,
  Sniper Scope, Suppressor, Compensator, Vertical Foregrip, Angled Grip, Laser Module, Flashlight, Extended and Drum magazines.
  Weapons and attachments use Blender models in the loadout cards, HUD and first-person view.
- **Armor**: a plate bar next to your health absorbs half of every hit until it is gone; Support carries the most, Recon the
  least, and ammo crates refill it.
- **Vehicles**: quad, jeep, APC, tank, attack helicopter and boat. Quad, jeep and APC steer through their wheelbases; tanks use differential steering and can pivot in place. Engine force and steering build progressively, tires retain momentum and have less grip on sand, reverse input brakes first, and hills load the engine. Blender wheel nodes steer and spin; the complete chassis and mounted parts settle into terrain pitch, acceleration squat and cornering roll. Driver + gunner seats, mounted turrets, crushing,
  ramming, damage states, repair and stealing empty enemy vehicles.
- **Full menu + HUD**: a cinematic main menu with generated battlefield artwork (Play / Loadout / Customize / Settings), ticket bars and flag icons, compass,
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
| Left click | Fire; throw a carried prop |
| Right click (hold, or toggle in the menu) | Aim down sights / scope (slower, much more accurate); with C4: detonate |
| `Shift` | Sprint on foot; climb in the helicopter |
| `Space` | Jump — hop onto low cover; brake in vehicles |
| `Ctrl` / `C` | Crouch on foot; descend in the helicopter |
| `R` | Reload |
| `G` | Grenade (again to cycle types) · `X` knife |
| `E` | Use: enter / exit vehicle, pick up / drop a crate or barrel, revive, arm / disarm M-COM (hold) |
| `1`–`4` | Primary, sidearm, gadget 1, gadget 2 · mouse wheel cycles · `B` last weapon |
| Vehicle: `1`–`4` / `E` | Switch seat / exit |
| Vehicle: `V` / right click | Switch chase/first-person camera / weapon zoom |
| Helicopter pilot: `Z` | Release flares (four bursts, 12-second cooldown) |
| `Q` | Spot an enemy or point (shown to the team) |
| `V` / middle click | Ping a location (on foot) |
| `L` | Open the loadout editor (applied on next deploy) |
| `Tab` | Scoreboard · `M` big map |
| `Enter` / `U` | Team chat · `Y` all chat |
| `Esc` | Menu: team, squad, volume, sensitivity, field of view, invert Y, toggle aim |
| Dead / spectating | Click cycles players (you see through their eyes) · `H` free camera (`WASD` fly, `Space`/`C` up/down) · `N` toggle the team-sight filter |

Vehicle drivers start in chase view; armed gunner seats start in first person. Mouse movement controls horizontal and vertical aim. `W` accelerates, `S` brakes then reverses, and `A`/`D` steer (strafe in the helicopter). The center crosshair selects the world target; the impact diamond shows where the current barrel points and turns amber while the gun catches up or an obstruction blocks the shot. Vehicle cannon rounds follow the barrel's actual height and pitch. Tank and APC barrels articulate independently of their turrets. Release `W` to coast; use `S` to brake before reversing or `Space` for the service brake. Wheeled vehicles need motion to turn; tanks can pivot with `A`/`D` while stopped.

Switching to a gunner seat opens its first-person sight even after using the driver's chase camera. Gunner mouse aim stays in the world while the driver steers. The jeep HMG sits above the cabin, with the sight camera behind and above its shield; close targets are aimed from the actual gun mount. Right-click zoom preserves the target, and `V` switches views without releasing the mouse.

Helicopters start landed on their pads. Hold `Shift` to climb and `Ctrl`/`C` to descend; releasing them holds world altitude, and `Space` brakes horizontal and vertical motion. Low flight collides with buildings and trees, and descent lands on terrain or rooftops. The HUD shows altitude above ground and vertical speed. Cameras, passengers, rockets and mounted guns follow actual flight height. Exiting in flight leaves you airborne.

Engineers can equip **Stinger AA** in gadget slot 2 (`4`). Hold RMB on an enemy helicopter for 1.4 seconds, then LMB to launch. Acquisition checks horizontal and vertical aim, range, terrain, walls and smoke. A full lock is required to fire. Rockets track aircraft altitude. Pilots receive acquisition and incoming-missile warnings; `Z` releases six flare decoys, breaks locks and diverts incoming Stingers. Flares burn for three seconds, have a 12-second cooldown and four bursts per helicopter life. New aircraft restore the dispenser.

Iron sights have open apertures/notches and aligned front posts. Mounted optics fold the iron sights away. Holographic and red-dot windows stay clear, with small centered reticles; ADS animation keeps the sight axis on the shot direction while moving. Magnified scope views retain their clear reticle overlay.

Field of view defaults to 90° horizontally. Both infantry and vehicle views use that setting; aiming and vehicle weapon zoom narrow the view temporarily.

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
    physics.js rapier.js   rigid bodies on Rapier (chunked terrain heightfield, impact events); vehicles keep the shared deterministic step
  client/      plain ES modules, no build step
    js/game/     prediction, mouse-look + recoil, three.js renderer (render.js world3d.js models3d.js fx3d.js overlay.js, post.js for the effect chain), first-person viewmodel (viewmodel.js), minimap, input
    js/ui/       main menu (home.js), lobby, deploy, loadout editor (kit.js), HUD, settings
  client/assets/ glTF models + PBR textures made in Blender (weapons/ vehicles/ soldier hands attachments props tex/)
tools/         validation, simulation, fuzz, integration and browser (Playwright) helpers
  blender/     the asset pipeline (headless Blender via `pip install bpy`), see below
```

## Development

```bash
npm run dev                               # restart on change
npm test                                  # both games: maps, mechanics, bot sims, fuzz, lag comp, WebSocket integration
npm run test:browser                      # Chrome: models, controls, menus, vehicles, quality levels, map transitions
npm run test:vehicles                     # Chrome: all six drivers, gunner seats, camera switching, zoom and firing while moving
npm run test:deploy                       # Chrome: deployment layouts, map/loadout selection and consecutive matches
npm run test:crew                         # Chrome + second player: contested insertion, truck gunner aim/fire while steering
npm run test:air-defense                  # Chrome: all compatible sights, native ADS/fire, Stinger lock and flare decoys
npm run test:terrain                      # Chrome: all seven terrain surfaces, native movement, slopes and vehicle cameras
npm run test:heights                      # Chrome: object dimensions, takeoff, hover, roof landings and flight cameras
npm run test:physics                      # authoritative rigid bodies, interaction, collapse, craters, clear vehicle spawns and stress
npm run test:physics-browser              # Chrome: native prop controls, visible destruction, audio decoding/mixer and cleanup
node tools/cs/sim.js dust 300 5 hard      # same tools for CS Top-Down live in tools/cs/
npm run maps                              # validate maps (reachability, vehicle spawns); `node tools/preview-maps.js harbor` prints ASCII
node tools/sim.js riverside 300 8 hard conquest   # headless bot match: map, seconds, team size, difficulty, mode
node tools/mechanics.js                   # scripted checks: revive, vehicles, C4, destruction, M-COM…
node tools/botstats.js harbor 300 16      # bot behaviour + tick cost + bandwidth at 16v16
node tools/vehcheck.js 240 10 -v          # vehicle sizes: spawn clearance, can each vehicle reach the flags, bot drivers standing still
CS_DEBUG=1 npm start                      # enables developer commands (teleport, give, enter vehicle, …)
npx eslint src tools                      # lint
```

The deployment workspace separates the spawn list, live tactical map and loadout. Weapons and equipment have separate tabs; attachment categories show one set of choices at a time. The footer confirms the insertion point and combat kit before deploying. New matches clear old input sequence numbers, and spawn placement chooses an open route so holding forward works immediately after deployment.

Enemy ground troops or vehicle crews inside a flag's capture radius block deployment immediately. Squad and beacon insertions within that contested area are blocked too. A selected point that becomes contested stays selected and shows the reason; choose another available point. The server rechecks every request and rejects stale selections. The respawn timer enables deployment only after the server confirms it is ready.

### Blender asset pipeline

Every model in the first-person view, on soldiers, on vehicles and in the world is authored in code with Blender's Python API
and exported to glTF; the game loads them at runtime (`src/client/js/game/assets.js`) and keeps the
procedural voxel models as fallbacks until the files arrive. Low quality retains modeled trees and buildings with simpler materials.

The graphics pass uses generated camouflage, worn metal, brick, concrete and meadow textures, detailed soldier equipment, and natural team uniforms with colored identification patches. Trees and cover are modeled in Blender, including generated oak leaf and bark textures. Houses have pitched/flat roofs, framed windows, chimneys and support-driven roof collapse. All vehicles share the infantry metre scale, with adjusted entry, exits and mounted-gun aiming. Smoke, dust and fire use soft instanced particles. Source images and exact prompts are documented in [`src/client/assets/GENERATED_ASSETS.md`](src/client/assets/GENERATED_ASSETS.md).

Build the refreshed soldier, weapons, vehicles and sleeves through a running Blender MCP connection:

```bash
uvx --from mcp-for-blender python tools/blender/mcp_client.py scene
uvx --from mcp-for-blender python tools/blender/mcp_client.py execute tools/blender/build_frontline.py
uvx --from mcp-for-blender python tools/blender/mcp_client.py execute tools/blender/build_world_v2.py
```

Blender's MCP add-on must be enabled and listening on localhost:9876. The build exports GLBs and saves an editable `output/soldier.blend`. For a background build on macOS, use `/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/blender/build_frontline.py`. Individual builds below also work with a Python environment containing `bpy`.

The world rebuild uses generated 2D vehicle, architecture and prop references, then reconstructs the meshes through Blender MCP. All six vehicles have mechanical detail and articulated mounts. Houses use three facade families, recessed windows, slate roofs, eaves and gutters. Cover includes soft filled sandbags, plank crates, fuel drums and corrugated containers. Packed editable sources and references are saved in `output/models-v2/`; full image prompts are in `src/client/assets/world-v2-prompts.json`. Use `build_world_v2.py` for the current vehicles and world rather than the older builders listed below.

```bash
python3 tools/blender/build_weapons.py       # 9 guns  -> assets/weapons/*.glb   (named empties: muzzle, ads, mount_optic, grip_r …)
python3 tools/blender/build_attachments.py   # 12 attachments + hands.glb
python3 tools/blender/build_characters.py    # soldier.glb (legs swing, weapon mount, camouflage and team identification patches)
python3 tools/blender/build_vehicles.py      # tank jeep apc quad heli boat
python3 tools/blender/build_props.py         # crate, barrels, sandbags, tree -> props.glb
python3 tools/blender/build_textures.py      # seamless PBR sets (albedo/normal/roughness) baked with Cycles -> assets/tex/
python3 tools/blender/montage.py out.png brick:c brick:n --tile   # contact sheet to eyeball tiling
```

The game steps Graphics down one level by itself when it runs under ~24 fps (until you pick a level in Esc → Graphics).

Add `--preview` to a build script to render pictures into `/tmp/bl_preview/`. Units are metres (the game uses 16 px per metre).

Heightfields are defined in `src/shared/elevation.js`. New elevated maps opt in with `elevation: true` and an entry in `ELEVATION_PROFILES`; water vertices and building pads are constrained automatically. The browser uses the same triangles for rendering and collision. The separate original `/cs/` maps remain unchanged.

Adding a map: create `src/shared/maps/yourmap.js` (procedural with `MapBuilder` in `maps/builder.js`, or plain ASCII rows),
register it in `maps/index.js` and run `npm run maps`. Maps declare their `modes`, 7 flags (or `rush` M-COM stages) and
vehicle spawns; bots navigate any map automatically.

Tile legend: `#` bedrock · `B` brick wall · `M` metal · `X` crate · `o` barrel (explodes) · `=` window · `L` low wall ·
`G` glass · `T` tree · `.` `,` `;` `_` floors · `~` deep water · `w` shallows.
