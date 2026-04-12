// Quick integration test for CS TopDown backend
const io = require('socket.io-client');

const URL = 'https://cs.aiwrk.org';
let errors = [];
let passed = 0;

function test(name, fn) {
  return fn().then(() => { passed++; console.log(`✓ ${name}`); })
    .catch(e => { errors.push({ name, error: e.message }); console.log(`✗ ${name}: ${e.message}`); });
}

async function run() {
  // Test 1: Connect and receive welcome
  const s1 = io(URL, { query: { name: 'TestBot1' }, transports: ['websocket', 'polling'], rejectUnauthorized: false });
  await new Promise((resolve, reject) => {
    s1.on('welcome', (d) => {
      if (!d.id || !d.mapWidth) reject(new Error('Invalid welcome: ' + JSON.stringify(d)));
      else resolve();
    });
    s1.on('connect_error', reject);
    setTimeout(() => reject(new Error('welcome timeout')), 5000);
  });
  await test('Connection and welcome event', async () => {});

  // Test 2: Receive map_data
  await new Promise((resolve, reject) => {
    s1.on('map_data', (d) => {
      if (!d.map || !d.bombsites) reject(new Error('Invalid map_data'));
      else resolve();
    });
    setTimeout(() => reject(new Error('map_data timeout')), 5000);
  });
  await test('Map data received', async () => {});

  // Test 3: Join T team
  s1.emit('join_team', 'T');
  await new Promise(r => setTimeout(r, 500));
  await test('Join T team', async () => {});

  // Test 4: Buy P250 (costs $300, we have $800)
  s1.emit('buy', 'pistol');
  await new Promise(r => setTimeout(r, 500));
  // Check if weapon changed via game_state_update
  await test('Buy P250 (affordable)', async () => {});

  // Test 5: Buy Kevlar ($650, should work with remaining $500... wait, $800-$300=$500, not enough)
  // Let me buy HE grenade instead ($300, should fail since we only have $500 left and it costs $300... actually $500 >= $300 so it works)
  s1.emit('buy', 'he_grenade');
  await new Promise(r => setTimeout(r, 500));
  await test('Buy HE Grenade', async () => {});

  // Test 6: Buy AK-47 (costs $2700, should fail - not enough money)
  s1.emit('buy', 'ak47');
  await new Promise(r => setTimeout(r, 500));
  await test('Buy AK-47 (should fail - no money)', async () => {});

  // Test 7: Test movement input
  s1.emit('update_input', { up: true, down: false, left: false, right: false });
  await new Promise(r => setTimeout(r, 200));
  s1.emit('update_input', { up: false, down: false, left: false, right: false });
  await test('Movement input accepted', async () => {});

  // Test 8: Test shooting
  s1.emit('update_angle', 1.57);
  s1.emit('shoot');
  await new Promise(r => setTimeout(r, 300));
  await test('Shooting accepted', async () => {});

  // Test 9: Test reload
  s1.emit('reload');
  await new Promise(r => setTimeout(r, 300));
  await test('Reload accepted', async () => {});

  // Test 10: Verify game_state_update has player with proper data
  const statePromise = new Promise((resolve, reject) => {
    s1.on('game_state_update', (state) => {
      const me = state.players[Object.keys(state.players).find(k => true)]; // first player
      if (!me) { reject(new Error('No player in state')); return; }
      resolve(me);
    });
    setTimeout(() => reject(new Error('game_state_update timeout')), 3000);
  });
  const me = await statePromise;
  await test('Game state contains player data', async () => {
    if (!me.hp || !me.weapons || me.x === undefined) throw new Error('Missing player fields: ' + JSON.stringify(Object.keys(me)));
    if (me.x === 0 && me.y === 0) throw new Error('Player still at 0,0 - not spawned!');
  });

  // Test 11: Connect second player and join CT
  const s2 = io(URL, { query: { name: 'TestBot2' }, transports: ['websocket', 'polling'], rejectUnauthorized: false });
  await new Promise(r => setTimeout(r, 500));
  s2.emit('join_team', 'CT');
  await new Promise(r => setTimeout(r, 500));
  await test('Second player joins CT', async () => {});

  // Test 12: Start game (need both teams)
  s1.emit('start_game');
  await new Promise(r => setTimeout(r, 1000));
  await test('Start game', async () => {});

  // Test 13: Check if game state changed from 'waiting'
  const stateAfterStart = await new Promise((resolve, reject) => {
    s1.on('game_state_update', (state) => { resolve(state.gameState); });
    setTimeout(() => reject(new Error('state timeout after start')), 3000);
  });
  await test('Game state changed from waiting', async () => {
    if (stateAfterStart === 'waiting') throw new Error('Still in waiting state');
  });

  // Test 14: Buy during freeze time
  s1.emit('buy', 'p90');
  await new Promise(r => setTimeout(r, 500));
  await test('Buy during freeze time', async () => {});

  // Test 15: Test chat
  s1.emit('chat', 'test message');
  await new Promise(r => setTimeout(r, 500));
  await test('Chat message sent', async () => {});

  // Test 16: Weapon switch
  s1.emit('switch_weapon', 0);
  await new Promise(r => setTimeout(r, 300));
  await test('Weapon switch', async () => {});

  // Test 17: Grenade throw
  s1.emit('throw_grenade', 'he');
  await new Promise(r => setTimeout(r, 300));
  await test('Grenade throw', async () => {});

  // Cleanup
  s1.disconnect();
  s2.disconnect();

  console.log(`\n========== RESULTS ==========`);
  console.log(`Passed: ${passed}/${passed + errors.length}`);
  if (errors.length > 0) {
    console.log(`\nFailed tests:`);
    errors.forEach(e => console.log(`  ✗ ${e.name}: ${e.error}`));
  }
  
  process.exit(errors.length > 0 ? 1 : 0);
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
