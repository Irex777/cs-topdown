// CS Top-Down - Shared Mutable State
export const state = {
  // Connection
  socket: null,
  myId: null,

  // Player
  myPlayer: null,
  players: {},
  bullets: [],

  // ADS
  adsActive: false,
  adsZoom: 1.0,
  adsTargetZoom: 1.0,

  // Game state
  gameState: 'waiting',
  roundNumber: 0,
  tScore: 0, ctScore: 0,
  roundTimer: 0, freezeTimer: 0,
  roundHistory: [],
  roundMvp: null,
  lastRoundEnd: null,
  playerCount: 0,

  // Map
  mapData: null,
  bombsites: null,
  mapWidth: 80, mapHeight: 60,
  mapWidthPx: 0, mapHeightPx: 0,
  mapOffscreen: null,
  fogCanvas: null, fogCtx: null,

  // Camera
  camera: { x: 0, y: 0, shakeX: 0, shakeY: 0 },
  freeCamPos: { x: 0, y: 0 },
  freeCamSpeed: 400,

  // Input
  keys: {},
  mouse: { x: 0, y: 0, down: false },

  // Weapons
  serverGrenades: [],
  activeGrenades: [],
  droppedWeapons: [],
  bomb: null,

  // UI state
  showBuyMenu: false,
  chatOpen: false,
  chatTeamOnly: false,
  escMenuOpen: false,
  flashTimer: 0,
  actionProgress: { active: false, type: '', progress: 0 },
  spectating: false,
  spectateTarget: null,
  spectateFreeCam: false,

  // Effects
  effects: [],
  particles: [],
  damageNumbers: [],
  deathAnimations: [],
  shellCasings: [],
  ambientParticles: [],
  soundIndicators: [],
  damageIndicators: [],

  // Death screen
  deathScreenData: null,
  deathScreenTimer: 0,

  // Rendering
  mapCanvas: null,
  vignetteCanvas: null,
  bombGlowCanvas: null,
  muzzleFlashTimers: {},
  prevPositions: {},
  weaponSway: { x: 0, y: 0, targetX: 0, targetY: 0 },
  lastRenderTime: 0,
  centerMessages: [],

  // HUD
  bombHudTimer: 0,
  bulletHoles: [],
  crosshairSpread: 0,
  crosshairTargetSpread: 0,
  lastShotTime: 0,
  lastMoveTime: 0,

  // Misc
  menuParticles: [],
  footstepTimers: {},
  defuseInterval: null,

  // Interpolation
  stateBuffer: [],
  interpDelay: 80,
  lastServerTime: 0,
};
