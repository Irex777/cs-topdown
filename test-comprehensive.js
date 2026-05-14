
const io = require('socket.io-client');
const URL = 'https://cs.aiwrk.org';

async function run() {
  console.log('=== COMPREHENSIVE GAME TEST ===\n');
  
  // Connect 2 players
  const s1 = io(URL, { query: { name: 'TestT' }, transports: ['polling'], rejectUnauthorized: false });
  const s2 = io(URL, { query: { name: 'TestCT' }, transports: ['polling'], rejectUnauthorized: false });
  
  let p1Id, p2Id;
  
  // Wait for welcome events
  await Promise.all([
    new Promise(r => s1.on('welcome', (d) => { p1Id = d.id; r(); })),
    new Promise(r => s2.on('welcome', (d) => { p2Id = d.id; r(); })),
    new Promise(r => setTimeout(r, 5000)),
  ]);
  
  console.log('P1 connected:', p1Id ? 'YES (id=' + p1Id + ')' : 'NO');
  console.log('P2 connected:', p2Id ? 'YES (id=' + p2Id + ')' : 'NO');
  
  if (!p1Id || !p2Id) { console.log('FAIL: Connection'); process.exit(1); }
  
  // Join teams
  s1.emit('join_team', 'T');
  s2.emit('join_team', 'CT');
  await new Promise(r => setTimeout(r, 1000));
  console.log('\nTeams joined');
  
  // Add bots to fill teams
  s1.emit('add_bots');
  await new Promise(r => setTimeout(r, 500));
  
  // Start game
  s1.emit('start_game');
  await new Promise(r => setTimeout(r, 1000));
  console.log('Game started');
  
  // Wait for freeze to end or game to start
  const waitForState = (targetState, timeout = 15000) => new Promise((resolve) => {
    const handler = (gs) => {
      if (gs.gameState === targetState || gs.state === targetState) {
        s1.off('game_state_update', handler);
        resolve(gs);
      }
    };
    s1.on('game_state_update', handler);
    s1.on('game_state', handler);
    setTimeout(() => resolve(null), timeout);
  });
  
  // Wait for playing state (after freeze)
  let playingState = await waitForState('playing', 20000);
  if (!playingState) {
    // Maybe we're already playing or need to wait for freeze
    console.log('Waiting for playing state...');
    await new Promise(r => setTimeout(r, 5000));
  }
  
  // Get current state
  const currentState = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
    setTimeout(() => resolve(null), 3000);
  });
  
  if (!currentState) {
    console.log('FAIL: No game state received');
    s1.disconnect(); s2.disconnect();
    process.exit(1);
  }
  
  console.log('\n=== GAME STATE ===');
  console.log('State:', currentState.gameState);
  console.log('Round:', currentState.round);
  console.log('Score: T', currentState.tScore, '- CT', currentState.ctScore);
  console.log('Players:', Object.keys(currentState.players).length);
  console.log('Bullets:', currentState.bullets?.length || 0);
  
  const me = currentState.players[p1Id];
  if (!me) {
    console.log('FAIL: Player 1 not in state. Keys:', Object.keys(currentState.players));
    s1.disconnect(); s2.disconnect(); process.exit(1);
  }
  
  console.log('\n=== PLAYER 1 STATE ===');
  console.log('Team:', me.team, '| HP:', me.hp, '| Alive:', me.alive);
  console.log('Pos:', me.x.toFixed(1), me.y.toFixed(1));
  console.log('Money:', me.money, '| Weapons:', JSON.stringify(me.weapons));
  console.log('Armor:', me.armor, '| Helmet:', me.helmet);
  
  // === BUY TEST ===
  console.log('\n=== BUY TEST ===');
  const moneyBefore = me.money;
  s1.emit('buy', 'kevlar');
  await new Promise(r => setTimeout(r, 500));
  
  const buyState = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
    setTimeout(() => resolve(null), 2000);
  });
  
  if (buyState && buyState.players[p1Id]) {
    const afterBuy = buyState.players[p1Id];
    console.log('After buying kevlar: money=$' + afterBuy.money + ' armor=' + afterBuy.armor);
    if (afterBuy.armor > 0) console.log('  OK: Buy works');
    else console.log('  BUG: Buy failed (gameState=' + currentState.gameState + ')');
  }
  
  // === SHOOT TEST ===
  console.log('\n=== SHOOT TEST ===');
  const preShoot = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
  });
  const preMe = preShoot.players[p1Id];
  const wepKey = preMe.weapons[preMe.currentWeapon] || 'glock';
  const ammoBefore = preMe.ammo[wepKey]?.mag || 0;
  console.log('Ammo before:', ammoBefore, '(' + wepKey + ')');
  
  s1.emit('update_angle', 1.0);
  for (let i = 0; i < 3; i++) {
    s1.emit('shoot');
    await new Promise(r => setTimeout(r, 150));
  }
  await new Promise(r => setTimeout(r, 500));
  
  const postShoot = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
    setTimeout(() => resolve(null), 2000);
  });
  
  if (postShoot && postShoot.players[p1Id]) {
    const postMe = postShoot.players[p1Id];
    const postWep = postMe.weapons[postMe.currentWeapon] || 'glock';
    const ammoAfter = postMe.ammo[postWep]?.mag || 0;
    console.log('Ammo after:', ammoAfter);
    if (ammoAfter < ammoBefore) console.log('  OK: Shooting works');
    else console.log('  BUG: Ammo did not decrease');
    console.log('  Bullets in flight:', postShoot.bullets?.length || 0);
  }
  
  // === MOVEMENT TEST ===
  console.log('\n=== MOVEMENT TEST ===');
  const moveState1 = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
  });
  const moveMe1 = moveState1.players[p1Id];
  console.log('Pos before:', moveMe1.x.toFixed(1), moveMe1.y.toFixed(1));
  
  s1.emit('update_input', { up: true, down: false, left: false, right: false, shoot: false, reload: false });
  s1.emit('update_angle', -1.57); // face up
  await new Promise(r => setTimeout(r, 1000));
  s1.emit('update_input', { up: false, down: false, left: false, right: false, shoot: false, reload: false });
  
  const moveState2 = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
    setTimeout(() => resolve(null), 2000);
  });
  
  if (moveState2 && moveState2.players[p1Id]) {
    const moveMe2 = moveState2.players[p1Id];
    console.log('Pos after:', moveMe2.x.toFixed(1), moveMe2.y.toFixed(1));
    const dx = Math.abs(moveMe2.x - moveMe1.x);
    const dy = Math.abs(moveMe2.y - moveMe1.y);
    if (dx > 1 || dy > 1) console.log('  OK: Movement works (dx=' + dx.toFixed(1) + ' dy=' + dy.toFixed(1) + ')');
    else console.log('  BUG: Player did not move');
  }
  
  // === WEAPON SWITCH TEST ===
  console.log('\n=== WEAPON SWITCH TEST ===');
  s1.emit('buy', 'ak47');
  await new Promise(r => setTimeout(r, 500));
  
  const weaponState = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
    setTimeout(() => resolve(null), 2000);
  });
  
  if (weaponState && weaponState.players[p1Id]) {
    const ws = weaponState.players[p1Id];
    console.log('After buying AK-47: weapons=' + JSON.stringify(ws.weapons) + ' current=' + ws.currentWeapon);
    if (ws.weapons.includes('ak47')) console.log('  OK: Weapon buy works');
    else console.log('  BUG: AK-47 not in weapons');
  }
  
  // === RELOAD TEST ===
  console.log('\n=== RELOAD TEST ===');
  // Fire some shots first
  for (let i = 0; i < 10; i++) {
    s1.emit('shoot');
    await new Promise(r => setTimeout(r, 100));
  }
  await new Promise(r => setTimeout(r, 200));
  
  const preReload = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
  });
  const preR = preReload.players[p1Id];
  const preWep = preR.weapons[preR.currentWeapon] || 'glock';
  const preMag = preR.ammo[preWep]?.mag || 0;
  console.log('Mag before reload:', preMag);
  
  s1.emit('reload');
  await new Promise(r => setTimeout(r, 2500)); // wait for reload
  
  const postReload = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
    setTimeout(() => resolve(null), 3000);
  });
  
  if (postReload && postReload.players[p1Id]) {
    const postR = postReload.players[p1Id];
    const postWep = postR.weapons[postR.currentWeapon] || 'glock';
    const postMag = postR.ammo[postWep]?.mag || 0;
    console.log('Mag after reload:', postMag);
    if (postMag > preMag) console.log('  OK: Reload works');
    else console.log('  BUG: Reload did not refill mag (reloading=' + postR.reloading + ')');
  }
  
  s1.disconnect();
  s2.disconnect();
  console.log('\n=== TEST COMPLETE ===');
  process.exit(0);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
