// Constants shared by server and client. Everything here is deterministic game data.

export const TILE = 32;
export const TICK = 60;             // simulation ticks per second
export const DT = 1 / TICK;
export const SNAP_EVERY = 2;        // snapshot every N ticks -> 30 Hz
export const PLAYER_R = 11;
// World scale: 16 px = 1 metre (a soldier is ~28 px / 1.75 m tall, a tile is 2 m).
export const PX_PER_M = 16;
export const BASE_SPEED = 92;       // px/s (5.75 m/s) for a soldier jogging with a knife out
export const SPRINT_MUL = 1.34;
export const CROUCH_SPEED = 0.52;   // speed factor when fully crouched
// Vertical dimension (heights are px above the ground; tile heights `h3` live in gamemap.js TILES).
export const GRAVITY = 900;         // px/s^2
export const JUMP_V = 200;          // px/s: a jump peaks ~22 px (sandbags, barrels and crates can be climbed)
export const STEP_H = 6;            // ledges up to this high are walked over
export const EYE_H = 26;            // eye height above the feet, standing
export const EYE_H_CROUCH = 16;
export const BODY_H = 29;           // hit box height, standing
export const BODY_H_CROUCH = 19;
export const HEAD_FRAC = 0.8;       // top 20% of the body is the head

export const T = 0;                 // team 0: Crimson (red)
export const CT = 1;                // team 1: Azure (blue)
export const SPEC = 2;
export const RED = T, BLUE = CT;
export const TEAM_NAMES = ['Crimson Army', 'Azure Legion', 'Spectators'];
export const TEAM_SHORT = ['CRM', 'AZR', 'SPEC'];
export const otherTeam = (t) => (t === T ? CT : T);

// Bits of the per-tick input command
export const KEY = {
  UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, FIRE: 16, WALK: 32, SCOPE: 64, USE: 128, SPRINT: 256, BRAKE: 512, JUMP: 1024, CROUCH: 2048,
};

export const PHASE = { LOBBY: 0, PRE: 1, LIVE: 2, POST: 3, OVER: 4 };

export const MODES = {
  conquest: { name: 'Conquest', desc: 'Capture and hold flags. Bleed the enemy tickets dry.' },
  rush: { name: 'Rush', desc: 'Attackers arm and blow up M-COM stations stage by stage. Defenders hold the line.' },
  tdm: { name: 'Team Deathmatch', desc: 'First team to the kill target wins. Infantry and light vehicles.' },
};

// Movement feel
export const ACCEL = 11;     // 1/s, responsiveness when a key is held (weightier than the old top-down feel)
export const FRICTION = 15;  // 1/s, responsiveness when no key is held
export const AIR_CONTROL = 0.3;
export const WALK_MUL = 0.5;

// Vision. scope levels: 0 iron sights, 1 = 4x, 2 = 8x, 3 = 12x
export const VISION = {
  near: 190,         // radius of 360° awareness around a player
  range: 1000,       // cone range
  fov: 150 * Math.PI / 180,
  aimRange: 1160,    // aiming down any sights: narrower but longer sight
  aimFov: 110 * Math.PI / 180,
  scopes: [null, { range: 1300, fov: 74 * Math.PI / 180 }, { range: 1700, fov: 56 * Math.PI / 180 }, { range: 2100, fov: 42 * Math.PI / 180 }],
  serverFovPad: 24 * Math.PI / 180,   // server sends slightly more than the client will draw
};

export const RULES = {
  respawnDelay: 6,           // seconds before a dead soldier can redeploy
  spawnProtect: 2.5,
  regenDelay: 5.5,           // seconds without damage before health comes back
  regenRate: 11,             // hp / s
  reviveWindow: 22,          // seconds a body can be revived
  reviveTime: 1.1,
  reviveHp: 40,
  ticketOptions: [150, 250, 400, 600],
  flagRadius: 118,
  flagCapRate: 0.055,        // per second per (player^0.8)
  flagCapMax: 0.3,
  bleedPerExcess: 0.075,     // tickets / s for every flag over half
  matchTime: 30 * 60,
  tdmKills: 100,
  rushTickets: 60,           // attackers' reinforcements
  mcomArmTime: 4,
  mcomDisarmTime: 4,
  mcomFuse: 30,
  mcomHp: 400,
  overTime: 15,
  squadSize: 4,
  spotTime: 9,
  score: {
    kill: 100, assist: 50, capture: 100, neutralize: 50, defend: 50, revive: 75, heal: 10, resupply: 10, repair: 10,
    vehicle: 200, roadkill: 100, spot: 15, arm: 100, disarm: 100, mcom: 200, destroyGadget: 50, beaconSpawn: 20,
  },
};

export const GRENADE = {
  he:    { name: 'Frag Grenade',     max: 3, fuse: 1.7 },
  flash: { name: 'Flashbang',        max: 2, fuse: 1.4 },
  smoke: { name: 'Smoke Grenade',    max: 2, fuse: 1.8 },
  molo:  { name: 'Incendiary',       max: 2, fuse: 1.6 },
};
export const GREN_ORDER = ['he', 'flash', 'smoke', 'molo'];
export const GREN_DRAG = 2.4;          // exponential drag; total travel = v0 / drag
export const GREN_MIN_DIST = 60;
export const GREN_MAX_DIST = 620;
export const HE_RADIUS = 220;
export const HE_DAMAGE = 105;
export const FLASH_RADIUS = 760;
export const FLASH_MAX = 3.6;
export const SMOKE_RADIUS = 92;
export const SMOKE_TIME = 18;
export const FIRE_RADIUS = 84;
export const FIRE_TIME = 7;
export const FIRE_DPS = 34;

export const MAX_PLAYERS_PER_ROOM = 24;
export const NAME_MAX = 16;
export const SQUAD_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];
