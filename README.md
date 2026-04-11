# CS Top-Down

Top-down Counter-Strike style LAN shooter for 10v10 team matches.

## Quick Start

```bash
npm install
npm start
```

Then open `http://localhost:3000` in your browser.

## LAN Play

1. Start the server on one machine: `npm start`
2. Find your local IP (e.g. `192.168.1.100`)
3. Other players open `http://192.168.1.100:3000` in their browser
4. Everyone picks a team and clicks START GAME

## Controls

| Key | Action |
|-----|--------|
| WASD | Move |
| Mouse | Aim |
| Left Click | Shoot |
| R | Reload |
| B | Buy Menu (during freeze time) |
| 1-4 | Switch weapons |
| E | Plant bomb (T) / Defuse bomb (CT) |
| G | Throw HE grenade |
| F | Throw Flashbang |
| C | Throw Smoke |
| Tab | Scoreboard |
| Enter | Chat |

## CS Features

- **Teams**: Terrorists (T) vs Counter-Terrorists (CT), up to 10v10
- **Rounds**: First to 13 wins, 115s per round, 5s freeze time
- **Economy**: Kill rewards, round win/loss bonuses, money cap $16000
- **Weapons**: Pistols, SMGs, Rifles, Snipers, Shotguns - all with CS-accurate stats
- **Equipment**: Kevlar, Helmet, Defuse Kit
- **Grenades**: HE, Flashbang, Smoke
- **Bomb**: Plant at A or B, 40s timer, defuse with/without kit
- **Headshots**: Extra damage, helmet absorbs first HS
- **Half-time**: Teams swap at round 13
- **Buy Menu**: Team-specific weapons (AK for T, M4 for CT, etc.)
- **Minimap**: Shows allies and map layout
- **Kill Feed**: Real-time kill notifications with headshot indicators
- **Scoreboard**: TAB to view all player stats

## Deploy with Docker

```bash
docker build -t cs-topdown .
docker run -p 3000:3000 cs-topdown
```
