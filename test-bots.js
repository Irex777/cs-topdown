// Full bot integration test
const io = require('socket.io-client');
const URL = 'https://cs.aiwrk.org';

async function run() {
  console.log('=== BOT INTEGRATION TEST ===\n');
  const errors = [];
  let passed = 0;

  // Connect player
  const s1 = io(URL, { query: { name: 'BotTester' }, transports: ['websocket', 'polling'], rejectUnauthorized: false });
  await new Promise((r, j) => { s1.on('map_data', r); setTimeout(() => j('connect timeout'), 8000); });
  console.log('✓ Connected');

  // Join T
  s1.emit('join_team', 'T');
  await new Promise(r => setTimeout(r, 500));
  console.log('✓ Joined T');

  // Add bots
  s1.emit('add_bots');
  const botResult = await new Promise((resolve) => {
    s1.once('bots_added', resolve);
    setTimeout(() => resolve(null), 3000);
  });
  if (botResult) {
    console.log('✓ Bots added: T=' + botResult.t + ' CT=' + botResult.ct);
    if (botResult.t > 0 && botResult.ct > 0) passed++;
    else errors.push('Bots not added to both teams');
  } else {
    errors.push('bots_added event not received');
  }

  // Check game state for bots
  const state1 = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
    setTimeout(() => resolve(null), 3000);
  });

  const playerList = state1 ? Object.values(state1.players) : [];
  const bots = playerList.filter(p => p.isBot);
  const tBots = bots.filter(p => p.team === 'T');
  const ctBots = bots.filter(p => p.team === 'CT');
  console.log('Total players:', playerList.length, '(Bots: ' + bots.length + ', T bots: ' + tBots.length + ', CT bots: ' + ctBots.length + ')');
  
  if (bots.length >= 6) { passed++; console.log('✓ At least 6 bots spawned'); }
  else errors.push('Expected 6+ bots, got ' + bots.length);

  // Check bots have weapons and valid positions
  let botsArmed = 0, botsSpawned = 0;
  for (const b of bots) {
    if (b.weapons && b.weapons.length > 0) botsArmed++;
    if (b.x !== 0 && b.y !== 0) botsSpawned++;
  }
  console.log('Bots armed:', botsArmed + '/' + bots.length, '| Bots spawned:', botsSpawned + '/' + bots.length);
  if (botsArmed === bots.length) { passed++; console.log('✓ All bots have weapons'); }
  else errors.push('Not all bots armed: ' + botsArmed + '/' + bots.length);
  if (botsSpawned === bots.length) { passed++; console.log('✓ All bots spawned at valid positions'); }
  else errors.push('Not all bots spawned: ' + botsSpawned + '/' + bots.length);

  // Start game
  s1.emit('start_game');
  await new Promise(r => setTimeout(r, 2000));
  console.log('✓ Game started');

  // Wait for freeze to end
  console.log('→ Waiting for freeze time...');
  await new Promise(r => setTimeout(r, 6000));

  // Check bots are moving
  const state2 = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
    setTimeout(() => resolve(null), 3000);
  });

  // Record positions
  const positions1 = {};
  if (state2) {
    for (const [id, p] of Object.entries(state2.players)) {
      positions1[id] = { x: p.x, y: p.y };
    }
  }

  // Wait and check movement
  await new Promise(r => setTimeout(r, 1000));

  const state3 = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
    setTimeout(() => resolve(null), 3000);
  });

  let botsMoved = 0;
  if (state3) {
    for (const [id, p] of Object.entries(state3.players)) {
      if (!p.isBot || !p.alive) continue;
      const prev = positions1[id];
      if (prev && (Math.abs(p.x - prev.x) > 5 || Math.abs(p.y - prev.y) > 5)) {
        botsMoved++;
      }
    }
  }
  console.log('Bots moved in 1s:', botsMoved + '/' + bots.length);
  if (botsMoved > 0) { passed++; console.log('✓ Bots are moving'); }
  else errors.push('No bots moved');

  // Check if any combat happened (kill feed)
  let gotKill = false;
  s1.on('player_killed', (data) => {
    gotKill = true;
    console.log('☠ Kill:', data.killerName, 'killed', data.victimName, 'with', data.weapon, data.headshot ? '(HS)' : '');
  });

  // Wait for combat
  console.log('→ Waiting for bot combat (5s)...');
  await new Promise(r => setTimeout(r, 5000));

  if (gotKill) { passed++; console.log('✓ Bot combat happening'); }
  else console.log('NOTE: No kills in 5s (may need more time)');

  // Check bullets are being fired
  const state4 = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
    setTimeout(() => resolve(null), 2000);
  });
  if (state4 && state4.bullets && state4.bullets.length > 0) {
    passed++; console.log('✓ Bullets active: ' + state4.bullets.length);
  } else {
    console.log('NOTE: No bullets in state (bots may be out of range)');
  }

  // Test remove bots
  s1.emit('remove_bots');
  const removeResult = await new Promise((resolve) => {
    s1.once('bots_removed', resolve);
    setTimeout(() => resolve(null), 3000);
  });
  if (removeResult) {
    console.log('✓ Removed ' + removeResult.count + ' bots');
    passed++;
  }

  // Verify bots removed
  const state5 = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
    setTimeout(() => resolve(null), 2000);
  });
  const remainingBots = state5 ? Object.values(state5.players).filter(p => p.isBot).length : -1;
  if (remainingBots === 0) { passed++; console.log('✓ All bots removed'); }
  else errors.push('Bots remaining: ' + remainingBots);

  // Cleanup
  s1.disconnect();

  console.log('\n========== RESULTS ==========');
  console.log('Passed: ' + passed);
  if (errors.length > 0) {
    console.log('Failed: ' + errors.length);
    errors.forEach(e => console.log('  ✗ ' + e));
  } else {
    console.log('No failures!');
  }
  process.exit(errors.length > 0 ? 1 : 0);
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
