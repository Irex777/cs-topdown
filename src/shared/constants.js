// Constants shared by server and client. Everything here is deterministic game data.

export const TILE = 32;
export const TICK = 60;             // simulation ticks per second
export const DT = 1 / TICK;
export const SNAP_EVERY = 2;        // snapshot every N ticks -> 30 Hz
export const PLAYER_R = 11;
export const BASE_SPEED = 205;      // px/s with a knife out

export const T = 0;
export const CT = 1;
export const SPEC = 2;
export const TEAM_NAMES = ['Terrorists', 'Counter-Terrorists', 'Spectators'];
export const TEAM_SHORT = ['T', 'CT', 'SPEC'];
export const otherTeam = (t) => (t === T ? CT : T);

// Bits of the per-tick input command
export const KEY = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, FIRE: 16, WALK: 32, SCOPE: 64, USE: 128 };

export const PHASE = { LOBBY: 0, FREEZE: 1, LIVE: 2, POST: 3, OVER: 4 };

// Movement feel
export const ACCEL = 16;     // 1/s, responsiveness when a key is held
export const FRICTION = 20;  // 1/s, responsiveness when no key is held
export const WALK_MUL = 0.5;

// Vision
export const VISION = {
  near: 96,          // radius of 360° awareness around a player
  range: 980,        // cone range
  fov: 112 * Math.PI / 180,
  scopeRange: 1500,
  scopeFov: 62 * Math.PI / 180,
  lightScopeRange: 1200,
  lightScopeFov: 84 * Math.PI / 180,
  serverFovPad: 24 * Math.PI / 180,   // server sends slightly more than the client will draw
};

export const RULES = {
  freezeTime: 8,
  roundTime: 115,
  postTime: 5,
  buyTime: 20,           // seconds after freeze during which buying is still allowed
  plantTime: 3.2,
  defuseTime: 10,
  defuseTimeKit: 5,
  bombTimer: 40,
  bombRadius: 380,
  bombDamage: 500,
  startMoney: 800,
  maxMoney: 16000,
  winMoney: 3250,
  lossBase: 1400,
  lossStep: 500,
  lossMax: 3400,
  plantTeamBonus: 800,
  plantReward: 300,
  defuseReward: 300,
  teamkillPenalty: 300,
  overtimeMoney: 10000,
  overtimeRounds: 6,
  respawnDelay: 3,       // deathmatch
  dmTime: 600,
  dmKills: 40,
};

export const GRENADE = {
  he:    { name: 'HE Grenade',       price: 300, max: 1, fuse: 1.7 },
  flash: { name: 'Flashbang',        price: 200, max: 2, fuse: 1.4 },
  smoke: { name: 'Smoke Grenade',    price: 300, max: 1, fuse: 1.8 },
  molo:  { name: 'Molotov',          price: 400, max: 1, fuse: 1.6 },
};
export const GREN_ORDER = ['he', 'flash', 'smoke', 'molo'];
export const MAX_GRENADES = 4;
export const GREN_DRAG = 2.4;          // exponential drag; total travel = v0 / drag
export const GREN_MIN_DIST = 60;
export const GREN_MAX_DIST = 620;
export const HE_RADIUS = 230;
export const HE_DAMAGE = 98;
export const FLASH_RADIUS = 760;
export const FLASH_MAX = 3.6;
export const SMOKE_RADIUS = 78;
export const SMOKE_TIME = 16;
export const FIRE_RADIUS = 84;
export const FIRE_TIME = 7;
export const FIRE_DPS = 34;

export const armorCost = { kevlar: 650, helmet: 1000, helmetUpgrade: 350, kit: 400 };

export const MAX_PLAYERS_PER_ROOM = 16;
export const NAME_MAX = 16;
