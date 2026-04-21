// CS Top-Down - Constants
export const GAME_VERSION = '3.0';
export const PLAYER_RADIUS = 12;
export const TILE_SIZE = 32;
export const TILE_WALL = 1, TILE_CRATE = 2, TILE_BS_A = 3, TILE_BS_B = 4;
export const TILE_T_SPAWN = 5, TILE_CT_SPAWN = 6, TILE_DOOR = 7;
export const WEAPONS = {
  pistol:{name:'P250',type:'pistol'},glock:{name:'Glock-18',type:'pistol'},
  usp:{name:'USP-S',type:'pistol'},deagle:{name:'Desert Eagle',type:'pistol'},
  mp9:{name:'MP9',type:'smg'},mac10:{name:'MAC-10',type:'smg'},p90:{name:'P90',type:'smg'},
  ak47:{name:'AK-47',type:'rifle'},m4a4:{name:'M4A4',type:'rifle'},
  galil:{name:'Galil AR',type:'rifle'},famas:{name:'FAMAS',type:'rifle'},
  awp:{name:'AWP',type:'sniper'},ssg08:{name:'SSG 08',type:'sniper'},
  nova:{name:'Nova',type:'shotgun'},knife:{name:'Knife',type:'knife'},
};
export const WEAPON_ICONS = {
  pistol:'🔫',glock:'🔫',usp:'🔫',deagle:'🔫',
  mp9:'🔫',mac10:'🔫',p90:'🔫',
  ak47:'🎯',m4a4:'🎯',galil:'🎯',famas:'🎯',
  awp:'🔭',ssg08:'🔭',nova:'💥',knife:'🗡️',
};
export const BUY_ITEMS = {
  'Pistols':[{key:'pistol',name:'P250',price:300},{key:'deagle',name:'Desert Eagle',price:700}],
  'SMGs':[{key:'mp9',name:'MP9',price:1250,team:'CT'},{key:'mac10',name:'MAC-10',price:1050,team:'T'},{key:'p90',name:'P90',price:2350}],
  'Rifles':[{key:'galil',name:'Galil AR',price:1800,team:'T'},{key:'famas',name:'FAMAS',price:2050,team:'CT'},{key:'ak47',name:'AK-47',price:2700,team:'T'},{key:'m4a4',name:'M4A4',price:3100,team:'CT'}],
  'Snipers':[{key:'ssg08',name:'SSG 08',price:1700},{key:'awp',name:'AWP',price:4750}],
  'Shotguns':[{key:'nova',name:'Nova',price:1050}],
  'Equipment':[{key:'kevlar',name:'Kevlar Vest',price:650},{key:'helmet',name:'Kevlar + Helmet',price:1000},{key:'defuse_kit',name:'Defuse Kit',price:400,team:'CT'}],
  'Grenades':[{key:'he_grenade',name:'HE Grenade',price:300},{key:'flashbang',name:'Flashbang',price:200},{key:'smoke',name:'Smoke Grenade',price:300}],
};
export const ADS_ZOOM_LEVELS = { pistol: 0.7, rifle: 0.55, smg: 0.65, sniper: 0.35, shotgun: 0.75 };

// Additional constants used across modules
export const STATE_BUFFER_SIZE = 10;
export const MAX_DAMAGE_INDICATORS = 8;
export const DEATH_SCREEN_DURATION = 4; // seconds
export const FOG_VISIBILITY_RADIUS = 600;
