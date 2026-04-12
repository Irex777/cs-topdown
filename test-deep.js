// Deep verification test - check actual values
const io = require('socket.io-client');
const URL = 'https://cs.aiwrk.org';

async function run() {
  const s1 = io(URL, { query: { name: 'DeepTest' }, transports: ['websocket', 'polling'], rejectUnauthorized: false });
  
  // Wait for connection + map data
  await new Promise(r => { s1.on('map_data', r); setTimeout(() => r(), 3000); });
  
  // Join T
  s1.emit('join_team', 'T');
  await new Promise(r => setTimeout(r, 800));
  
  // Capture a game state update
  const state = await new Promise((resolve) => {
    s1.on('game_state_update', resolve);
    setTimeout(() => resolve(null), 3000);
  });
  
  if (!state) { console.log('ERROR: No game state received'); s1.disconnect(); return; }
  
  // Find our player
  const myKey = Object.keys(state.players)[0];
  const me = state.players[myKey];
  
  console.log('=== PLAYER STATE ===');
  console.log('Name:', me.name);
  console.log('Team:', me.team);
  console.log('Position: x=' + me.x.toFixed(1) + ' y=' + me.y.toFixed(1));
  console.log('HP:', me.hp);
  console.log('Armor:', me.armor);
  console.log('Alive:', me.alive);
  console.log('Money:', me.money);
  console.log('Weapons:', JSON.stringify(me.weapons));
  console.log('Current weapon:', me.currentWeapon);
  console.log('Ammo:', JSON.stringify(me.ammo));
  console.log('Grenades:', JSON.stringify(me.grenades));
  console.log('Reloading:', me.reloading);
  console.log('');
  
  // Check position is valid (not 0,0)
  if (me.x === 0 && me.y === 0) {
    console.log('BUG: Player at (0,0) - not spawned!');
  } else {
    console.log('OK: Player spawned at valid position');
  }
  
  // Check weapon
  if (me.weapons.length === 0) {
    console.log('BUG: No weapons!');
  } else {
    console.log('OK: Has weapon(s):', me.weapons.join(', '));
  }
  
  // Check ammo
  const wepKey = me.weapons[me.currentWeapon];
  if (wepKey && me.ammo[wepKey]) {
    console.log('OK: Ammo for', wepKey, '-', me.ammo[wepKey].mag, '/', me.ammo[wepKey].reserve);
  }
  
  // Check money
  if (me.money === 800) {
    console.log('OK: Starting money $800');
  } else {
    console.log('NOTE: Money is $' + me.money);
  }
  
  console.log('');
  console.log('=== GAME STATE ===');
  console.log('State:', state.gameState);
  console.log('Round:', state.round);
  console.log('Score: T', state.tScore, '- CT', state.ctScore);
  console.log('Round timer:', state.roundTimer);
  console.log('Bullets:', state.bullets?.length || 0);
  console.log('Active grenades:', state.activeGrenades?.length || 0);
  
  // Now test buying
  console.log('');
  console.log('=== BUY TEST ===');
  
  // Buy kevlar
  s1.emit('buy', 'kevlar');
  await new Promise(r => setTimeout(r, 500));
  
  // Check state after buy
  const state2 = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
    setTimeout(() => resolve(null), 2000);
  });
  
  if (state2) {
    const me2 = state2.players[myKey];
    console.log('After buying kevlar:');
    console.log('  Money: $' + me2.money);
    console.log('  Armor: ' + me2.armor);
    if (me2.money < 800 && me2.armor > 0) {
      console.log('  OK: Money decreased and armor increased');
    } else if (me2.money === 800 && me2.armor === 0) {
      console.log('  BUG: Buy failed - no money change, no armor');
    }
  }
  
  // Test shooting
  console.log('');
  console.log('=== SHOOTING TEST ===');
  const stateBefore = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
  });
  const meBefore = stateBefore.players[myKey];
  const ammoBefore = meBefore.ammo[meBefore.weapons[meBefore.currentWeapon]]?.mag;
  console.log('Ammo before shoot:', ammoBefore);
  
  s1.emit('update_angle', 0.5);
  s1.emit('shoot');
  await new Promise(r => setTimeout(r, 200));
  
  const stateAfter = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
  });
  const meAfter = stateAfter.players[myKey];
  const ammoAfter = meAfter.ammo[meAfter.weapons[meAfter.currentWeapon]]?.mag;
  console.log('Ammo after shoot:', ammoAfter);
  
  if (ammoAfter < ammoBefore) {
    console.log('OK: Ammo decreased after shooting');
  } else {
    console.log('BUG: Ammo did not decrease - shooting not working');
  }
  console.log('Bullets active:', stateAfter.bullets?.length || 0);
  
  // Test movement
  console.log('');
  console.log('=== MOVEMENT TEST ===');
  const posBefore = { x: meAfter.x, y: meAfter.y };
  console.log('Pos before move: x=' + posBefore.x.toFixed(1) + ' y=' + posBefore.y.toFixed(1));
  
  // Send movement for 500ms
  s1.emit('update_input', { up: true, down: false, left: false, right: false });
  s1.emit('update_angle', -1.57); // face up
  await new Promise(r => setTimeout(r, 600));
  s1.emit('update_input', { up: false, down: false, left: false, right: false });
  
  const stateMove = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
  });
  const meMove = stateMove.players[myKey];
  console.log('Pos after move:  x=' + meMove.x.toFixed(1) + ' y=' + meMove.y.toFixed(1));
  
  const moved = Math.abs(meMove.y - posBefore.y) > 1;
  if (moved) {
    console.log('OK: Player moved (dy=' + (meMove.y - posBefore.y).toFixed(1) + ')');
  } else {
    console.log('BUG: Player did not move');
  }
  
  s1.disconnect();
  console.log('\nDone.');
  process.exit(0);
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
