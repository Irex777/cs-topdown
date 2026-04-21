// Shared game constants between server and client

module.exports = {
  // Map
  TILE_SIZE: 32,
  MAP_WIDTH: 80,   // tiles
  MAP_HEIGHT: 60,  // tiles

  // Player
  PLAYER_RADIUS: 12,
  PLAYER_SPEED: 200,      // pixels/sec
  PLAYER_SPRINT_SPEED: 280,
  PLAYER_MAX_HP: 100,
  PLAYER_MAX_ARMOR: 100,
  PLAYER_CROUCH_SPEED: 120, // future use

  // Teams
  TEAM_T: 'T',
  TEAM_CT: 'CT',
  TEAM_SPEC: 'SPEC',

  // Round
  ROUND_TIME: 115,          // seconds
  FREEZE_TIME: 4,           // seconds (buy time)
  BOMB_PLANT_TIME: 3.2,     // seconds
  BOMB_DEFUSE_TIME: 5,      // seconds
  BOMB_TIMER: 40,           // seconds before explosion
  ROUNDS_TO_WIN: 13,
  MAX_ROUNDS: 25,           // 13-12 max
  OVERTAKE_ROUNDS: 4,       // overtime rounds to win

  // Economy
  START_MONEY: 800,
  MAX_MONEY: 16000,
  KILL_REWARD: 300,
  ROUND_WIN_REWARD: 3250,
  ROUND_LOSS_REWARD: 1400,
  LOSS_BONUS_INCREMENT: 500,
  MAX_LOSS_BONUS: 3400,
  BOMB_PLANT_REWARD: 300,
  BOMB_DEFUSE_REWARD: 300,

  // Bomb
  BOMB_BLAST_RADIUS: 400,

  //Weapons
  WEAPONS: {
    // Pistols
    pistol: {
      name: 'P250',
      type: 'pistol',
      price: 300,
      damage: 28,
      fireRate: 6.67,       // rounds/sec
      reloadTime: 2.2,
      magSize: 13,
      reserveAmmo: 26,
      spread: 0.03,
      range: 800,
      moveSpread: 0.06,
      reward: 150,
      fireMode: 'semi',
      recoilPattern: [
        { x: 0, y: -1.5 },
        { x: 0.3, y: -2.0 },
        { x: -0.3, y: -2.5 },
        { x: 0.5, y: -2.0 },
        { x: -0.4, y: -1.8 },
      ],
      movementInaccuracy: 0.06,
      standInaccuracy: 0.015,
      crouchBonus: 0.6,
      armorPenetration: 0.8,
    },
    glock: {
      name: 'Glock-18',
      type: 'pistol',
      price: 0,             // T default
      damage: 24,
      fireRate: 6.67,
      reloadTime: 2.2,
      magSize: 20,
      reserveAmmo: 120,
      spread: 0.04,
      range: 600,
      moveSpread: 0.08,
      reward: 150,
      fireMode: 'semi',       // future: burst mode toggle
      recoilPattern: [
        { x: 0, y: -1.0 },
        { x: 0.4, y: -1.5 },
        { x: -0.4, y: -2.0 },
        { x: 0.3, y: -1.8 },
        { x: -0.3, y: -1.5 },
      ],
      movementInaccuracy: 0.08,
      standInaccuracy: 0.02,
      crouchBonus: 0.65,
      burstMode: false,       // future: toggle to burst (3-round burst)
    },
    usp: {
      name: 'USP-S',
      type: 'pistol',
      price: 0,             // CT default
      damage: 24,
      fireRate: 6.67,
      reloadTime: 2.2,
      magSize: 12,
      reserveAmmo: 24,
      spread: 0.02,
      range: 700,
      moveSpread: 0.05,
      reward: 150,
      fireMode: 'semi',
      recoilPattern: [
        { x: 0, y: -1.2 },
        { x: 0.2, y: -1.8 },
        { x: -0.2, y: -2.0 },
        { x: 0.3, y: -1.6 },
        { x: -0.2, y: -1.4 },
      ],
      movementInaccuracy: 0.05,
      standInaccuracy: 0.01,
      crouchBonus: 0.6,
      suppressor: true,
    },
    deagle: {
      name: 'Desert Eagle',
      type: 'pistol',
      price: 700,
      damage: 55,
      fireRate: 3.33,
      reloadTime: 2.2,
      magSize: 7,
      reserveAmmo: 35,
      spread: 0.025,
      range: 900,
      moveSpread: 0.12,
      reward: 150,
      fireMode: 'semi',
      recoilPattern: [
        { x: 0, y: -3.0 },     // first shot very accurate
        { x: 1.5, y: -5.0 },   // then goes wild
        { x: -2.0, y: -6.0 },
        { x: 2.5, y: -5.5 },
        { x: -1.8, y: -4.5 },
        { x: 1.0, y: -4.0 },
        { x: -0.8, y: -3.5 },
      ],
      movementInaccuracy: 0.12,
      standInaccuracy: 0.01,    // first shot accurate when still
      crouchBonus: 0.5,
      armorPenetration: 0.93,
    },

    // SMGs
    mp9: {
      name: 'MP9',
      type: 'smg',
      price: 1250,
      damage: 21,
      fireRate: 12,
      reloadTime: 3.1,
      magSize: 30,
      reserveAmmo: 120,
      spread: 0.05,
      range: 600,
      moveSpread: 0.10,
      reward: 600,
      fireMode: 'auto',
      recoilPattern: [
        { x: 0, y: -1.2 },
        { x: 0.5, y: -2.0 },
        { x: -0.4, y: -2.5 },
        { x: 0.6, y: -2.2 },
        { x: -0.5, y: -2.8 },
        { x: 0.3, y: -2.5 },
        { x: -0.6, y: -2.0 },
        { x: 0.4, y: -2.3 },
      ],
      movementInaccuracy: 0.10,
      standInaccuracy: 0.03,
      crouchBonus: 0.7,
    },
    mac10: {
      name: 'MAC-10',
      type: 'smg',
      price: 1050,
      damage: 21,
      fireRate: 13.33,
      reloadTime: 3.1,
      magSize: 30,
      reserveAmmo: 100,
      spread: 0.06,
      range: 500,
      moveSpread: 0.12,
      reward: 600,
      fireMode: 'auto',
      recoilPattern: [
        { x: 0, y: -1.0 },
        { x: 0.8, y: -1.8 },
        { x: -0.7, y: -2.5 },
        { x: 1.0, y: -2.0 },
        { x: -0.8, y: -3.0 },
        { x: 0.5, y: -2.8 },
        { x: -1.0, y: -2.2 },
        { x: 0.6, y: -2.5 },
      ],
      movementInaccuracy: 0.12,
      standInaccuracy: 0.04,
      crouchBonus: 0.7,
    },
    p90: {
      name: 'P90',
      type: 'smg',
      price: 2350,
      damage: 19,
      fireRate: 16.67,
      reloadTime: 3.3,
      magSize: 50,
      reserveAmmo: 50,
      spread: 0.04,
      range: 700,
      moveSpread: 0.09,
      reward: 300,
      fireMode: 'auto',
      recoilPattern: [
        { x: 0, y: -0.8 },
        { x: 0.3, y: -1.5 },
        { x: -0.3, y: -2.0 },
        { x: 0.4, y: -1.8 },
        { x: -0.4, y: -2.2 },
        { x: 0.2, y: -2.0 },
        { x: -0.3, y: -1.8 },
        { x: 0.3, y: -2.1 },
        { x: -0.2, y: -1.9 },
        { x: 0.1, y: -2.0 },
      ],
      movementInaccuracy: 0.09,
      standInaccuracy: 0.03,
      crouchBonus: 0.7,
    },

    // Rifles
    ak47: {
      name: 'AK-47',
      type: 'rifle',
      price: 2700,
      damage: 36,
      fireRate: 10,
      reloadTime: 2.5,
      magSize: 30,
      reserveAmmo: 90,
      spread: 0.02,
      range: 1000,
      moveSpread: 0.10,
      reward: 300,
      team: 'T',
      fireMode: 'auto',
      recoilPattern: [
        { x: 0, y: -2.5 },     // first shot accurate
        { x: 0, y: -4.0 },
        { x: 0.5, y: -4.5 },
        { x: -0.5, y: -5.0 },
        { x: 1.0, y: -4.0 },
        { x: -1.2, y: -3.5 },
        { x: 1.5, y: -3.0 },
        { x: -1.5, y: -4.0 },
        { x: 0.8, y: -3.5 },
        { x: -0.5, y: -4.2 },
      ],
      movementInaccuracy: 0.10,
      standInaccuracy: 0.0,
      crouchBonus: 0.5,
      armorPenetration: 0.775,
      oneTapHeadshot: true,    // can one-tap headshot even through helmet
    },
    m4a4: {
      name: 'M4A4',
      type: 'rifle',
      price: 3100,
      damage: 33,
      fireRate: 11,
      reloadTime: 3.1,
      magSize: 30,
      reserveAmmo: 90,
      spread: 0.018,
      range: 1000,
      moveSpread: 0.08,
      reward: 300,
      team: 'CT',
      fireMode: 'auto',
      recoilPattern: [
        { x: 0, y: -2.0 },
        { x: 0, y: -3.5 },
        { x: 0.4, y: -3.8 },
        { x: -0.4, y: -4.0 },
        { x: 0.8, y: -3.5 },
        { x: -0.8, y: -3.0 },
        { x: 1.0, y: -2.8 },
        { x: -1.0, y: -3.2 },
        { x: 0.5, y: -3.0 },
        { x: -0.3, y: -3.5 },
      ],
      movementInaccuracy: 0.08,
      standInaccuracy: 0.0,
      crouchBonus: 0.5,
      armorPenetration: 0.70,
      oneTapHeadshot: false,   // cannot one-tap through helmet
    },
    galil: {
      name: 'Galil AR',
      type: 'rifle',
      price: 1800,
      damage: 30,
      fireRate: 10,
      reloadTime: 2.5,
      magSize: 35,
      reserveAmmo: 90,
      spread: 0.025,
      range: 900,
      moveSpread: 0.09,
      reward: 300,
      team: 'T',
      fireMode: 'auto',
      recoilPattern: [
        { x: 0, y: -1.8 },
        { x: 0.3, y: -3.0 },
        { x: -0.4, y: -3.5 },
        { x: 0.6, y: -3.2 },
        { x: -0.7, y: -3.8 },
        { x: 0.8, y: -3.0 },
        { x: -0.5, y: -3.5 },
        { x: 0.4, y: -3.2 },
      ],
      movementInaccuracy: 0.09,
      standInaccuracy: 0.01,
      crouchBonus: 0.5,
    },
    famas: {
      name: 'FAMAS',
      type: 'rifle',
      price: 2050,
      damage: 27,
      fireRate: 11,
      reloadTime: 3.1,
      magSize: 25,
      reserveAmmo: 75,
      spread: 0.02,
      range: 900,
      moveSpread: 0.08,
      reward: 300,
      team: 'CT',
      fireMode: 'auto',
      recoilPattern: [
        { x: 0, y: -1.5 },
        { x: 0.3, y: -2.8 },
        { x: -0.3, y: -3.2 },
        { x: 0.5, y: -3.0 },
        { x: -0.5, y: -3.5 },
        { x: 0.4, y: -2.8 },
        { x: -0.4, y: -3.0 },
        { x: 0.2, y: -3.2 },
      ],
      movementInaccuracy: 0.08,
      standInaccuracy: 0.01,
      crouchBonus: 0.5,
    },

    // Snipers
    awp: {
      name: 'AWP',
      type: 'sniper',
      price: 4750,
      damage: 120,
      fireRate: 0.75,
      reloadTime: 3.7,
      magSize: 10,
      reserveAmmo: 30,
      spread: 0.001,
      range: 2000,
      moveSpread: 0.25,
      reward: 100,
      fireMode: 'bolt',
      recoilPattern: [
        { x: 0, y: -8.0 },      // massive single-shot kick
      ],
      movementInaccuracy: 0.25,
      standInaccuracy: 0.0,
      crouchBonus: 0.5,
      armorPenetration: 0.975,
      oneShotBody: true,    // one-shots body regardless of armor
    },
    ssg08: {
      name: 'SSG 08',
      type: 'sniper',
      price: 1700,
      damage: 75,
      fireRate: 1.25,
      reloadTime: 3.7,
      magSize: 10,
      reserveAmmo: 90,
      spread: 0.002,
      range: 1800,
      moveSpread: 0.20,
      reward: 100,
      fireMode: 'bolt',
      recoilPattern: [
        { x: 0, y: -5.0 },
      ],
      movementInaccuracy: 0.20,
      standInaccuracy: 0.0,
      crouchBonus: 0.5,
      armorPenetration: 0.85,
    },

    // Shotguns
    nova: {
      name: 'Nova',
      type: 'shotgun',
      price: 1050,
      damage: 14,           // per pellet, 9 pellets * 14 = 126 max
      pellets: 9,
      fireRate: 1.33,
      reloadTime: 4.0,
      magSize: 8,
      reserveAmmo: 32,
      spread: 0.10,
      range: 400,
      moveSpread: 0.15,
      reward: 900,
      fireMode: 'pump',
      recoilPattern: [
        { x: 0, y: -6.0 },      // heavy pump kick
      ],
      movementInaccuracy: 0.15,
      standInaccuracy: 0.05,
      crouchBonus: 0.7,
      damageFalloff: true,       // damage drops sharply with distance
    },

    // Equipment
    kevlar: {
      name: 'Kevlar Vest',
      type: 'armor',
      price: 650,
      armor: 100,
    },
    helmet: {
      name: 'Kevlar + Helmet',
      type: 'armor',
      price: 1000,
      armor: 100,
      helmet: true,
    },
    defuse_kit: {
      name: 'Defuse Kit',
      type: 'utility',
      price: 400,
      defuseTimeMod: 0.5,   // halves defuse time
      team: 'CT',
    },
    he_grenade: {
      name: 'HE Grenade',
      type: 'grenade',
      price: 300,
      maxCarry: 1,
    },
    flashbang: {
      name: 'Flashbang',
      type: 'grenade',
      price: 200,
      maxCarry: 2,
    },
    smoke: {
      name: 'Smoke Grenade',
      type: 'grenade',
      price: 300,
      maxCarry: 1,
    },
  },

  // Grenade constants
  HE_DAMAGE: 80,
  HE_RADIUS: 200,
  FLASH_DURATION: 3.0,     // seconds
  FLASH_RADIUS: 300,
  SMOKE_DURATION: 15,      // seconds
  SMOKE_RADIUS: 100,
  GRENADE_THROW_SPEED: 800,

  // Respawn positions (will be generated per map)
  T_SPAWN: { x: 200, y: 900 },
  CT_SPAWN: { x: 2300, y: 900 },

  // Network
  TICK_RATE: 30,           // server ticks per second
  INTERP_DELAY: 0.05,      // 50ms interpolation
};
