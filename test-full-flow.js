// Full game flow test with 2 players
const io = require('socket.io-client');
const URL = 'https://cs.aiwrk.org';

async function run() {
  console.log('=== FULL GAME FLOW TEST ===\n');

  // Connect player 1 (T)
  const s1 = io(URL, { query: { name: 'PlayerT' }, transports: ['websocket', 'polling'], rejectUnauthorized: false });
  await new Promise((r, j) => { s1.on('map_data', r); setTimeout(() => j('s1 connect timeout'), 5000); });
  console.log('✓ Player 1 connected');
  s1.emit('join_team', 'T');
  await new Promise(r => setTimeout(r, 500));
  console.log('✓ Player 1 joined T');

  // Connect player 2 (CT)
  const s2 = io(URL, { query: { name: 'PlayerCT' }, transports: ['websocket', 'polling'], rejectUnauthorized: false });
  await new Promise((r, j) => { s2.on('map_data', r); setTimeout(() => j('s2 connect timeout'), 5000); });
  console.log('✓ Player 2 connected');
  s2.emit('join_team', 'CT');
  await new Promise(r => setTimeout(r, 500));
  console.log('✓ Player 2 joined CT');

  // Start game
  s1.emit('start_game');
  console.log('→ Start game requested');
  await new Promise(r => setTimeout(r, 1500));

  // Check game state
  const state1 = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
    setTimeout(() => resolve(null), 3000);
  });

  if (state1) {
    console.log('Game state:', state1.gameState);
    console.log('Round:', state1.round);
    if (state1.gameState === 'freeze') {
      console.log('✓ Game started in freeze state');
    } else if (state1.gameState === 'playing') {
      console.log('✓ Game started (already past freeze)');
    } else {
      console.log('BUG: Game state is', state1.gameState, '- expected freeze/playing');
    }
  }

  // Wait for freeze to end
  console.log('\n→ Waiting for freeze time to end...');
  await new Promise(r => setTimeout(r, 6000));

  // Check state after freeze
  const state2 = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
    setTimeout(() => resolve(null), 3000);
  });

  if (state2) {
    console.log('State after freeze:', state2.gameState);
    if (state2.gameState === 'playing') {
      console.log('✓ Game is now playing');
    }
  }

  // P1 buys AK
  s1.emit('buy', 'ak47');
  await new Promise(r => setTimeout(r, 500));
  console.log('→ Player 1 buys AK-47');

  // P2 buys M4
  s2.emit('buy', 'm4a4');
  await new Promise(r => setTimeout(r, 500));
  console.log('→ Player 2 buys M4A4');

  // Get positions
  const state3 = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
  });

  const p1 = Object.values(state3.players).find(p => p.name === 'PlayerT');
  const p2 = Object.values(state3.players).find(p => p.name === 'PlayerCT');
  console.log('\nP1:', p1?.name, 'team:', p1?.team, 'pos:', p1?.x?.toFixed(0), p1?.y?.toFixed(0), 'hp:', p1?.hp, 'money:', p1?.money, 'weapons:', p1?.weapons);
  console.log('P2:', p2?.name, 'team:', p2?.team, 'pos:', p2?.x?.toFixed(0), p2?.y?.toFixed(0), 'hp:', p2?.hp, 'money:', p2?.money, 'weapons:', p2?.weapons);

  // P1 shoots at P2 direction
  if (p1 && p2) {
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    console.log('\n→ P1 aiming at P2, angle:', angle.toFixed(2));
    
    // Move P1 closer to P2 for reliable hit
    s1.emit('update_angle', angle);
    s1.emit('update_input', { up: false, down: false, left: false, right: false });
    
    // Fire many shots
    for (let i = 0; i < 30; i++) {
      s1.emit('shoot');
      await new Promise(r => setTimeout(r, 100));
    }

    const stateAfter = await new Promise((resolve) => {
      const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
      s1.on('game_state_update', handler);
    });
    const p2after = Object.values(stateAfter.players).find(p => p.name === 'PlayerCT');
    console.log('P2 HP after shots:', p2after?.hp, 'alive:', p2after?.alive);
    
    if (p2after && p2after.hp < 100) {
      console.log('✓ P2 took damage from P1 shooting');
    } else {
      console.log('NOTE: P2 did not take damage (may be too far / walls blocking)');
    }

    if (p2after && !p2after.alive) {
      console.log('✓ P2 was killed!');
    }
  }

  // Check for round end
  const roundEnd = await new Promise((resolve) => {
    s1.on('round_end', (data) => resolve(data));
    setTimeout(() => resolve(null), 4000);
  });
  if (roundEnd) {
    console.log('\n✓ Round ended:', roundEnd.winner, 'wins -', roundEnd.reason);
    console.log('Score: T', roundEnd.tScore, '- CT', roundEnd.ctScore);
  }

  // Test chat
  s1.emit('chat', 'gg');
  const chatMsg = await new Promise((resolve) => {
    s2.on('chat', (data) => resolve(data));
    setTimeout(() => resolve(null), 2000);
  });
  if (chatMsg) {
    console.log('\n✓ Chat received:', chatMsg.name + ':', chatMsg.message);
  }

  // Test restart
  console.log('\n→ Testing restart...');
  s1.emit('restart_game');
  await new Promise(r => setTimeout(r, 1000));
  
  const stateRestart = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
    setTimeout(() => resolve(null), 2000);
  });
  if (stateRestart) {
    console.log('After restart - State:', stateRestart.gameState, 'Round:', stateRestart.round, 'Score:', stateRestart.tScore + '-' + stateRestart.ctScore);
    if (stateRestart.gameState === 'waiting' && stateRestart.round === 0) {
      console.log('✓ Game restarted successfully');
    }
  }

  // Cleanup
  s1.disconnect();
  s2.disconnect();
  console.log('\n=== ALL TESTS COMPLETE ===');
  process.exit(0);
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
