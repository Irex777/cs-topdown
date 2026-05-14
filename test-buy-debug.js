
const io = require('socket.io-client');
const URL = 'https://cs.aiwrk.org';

async function run() {
  const s1 = io(URL, { query: { name: 'BuyTest' }, transports: ['polling'] });
  
  let p1Id;
  await new Promise(r => { s1.on('welcome', (d) => { p1Id = d.id; r(); }); setTimeout(() => r(), 5000); });
  console.log('Connected:', p1Id);
  
  s1.emit('join_team', 'T');
  await new Promise(r => setTimeout(r, 500));
  s1.emit('add_bots');
  await new Promise(r => setTimeout(r, 300));
  s1.emit('start_game');
  await new Promise(r => setTimeout(r, 1000));
  console.log('Game start requested');
  
  // Wait for playing state
  await new Promise((resolve) => {
    const handler = (gs) => {
      const state = gs.gameState || gs.state;
      console.log('  state update:', state);
      if (state === 'playing') {
        s1.off('game_state_update', handler);
        s1.off('game_state', handler);
        resolve();
      }
    };
    s1.on('game_state_update', handler);
    s1.on('game_state', handler);
    setTimeout(resolve, 25000);
  });
  
  console.log('In playing state, testing buy...');
  await new Promise(r => setTimeout(r, 500));
  
  // Try buying immediately
  console.log('Sending buy kevlar...');
  s1.emit('buy', 'kevlar');
  await new Promise(r => setTimeout(r, 500));
  
  // Check state
  const state = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
    setTimeout(() => resolve(null), 2000);
  });
  
  if (state && state.players[p1Id]) {
    const me = state.players[p1Id];
    console.log('Result: money=$' + me.money + ' armor=' + me.armor + ' alive=' + me.alive);
    console.log('roundTimer=' + state.roundTimer + ' gameState=' + state.gameState);
    console.log('buyTimeLeft calc: ROUND_TIME(' + 115 + ') - roundTimer(' + state.roundTimer + ') = ' + (115 - state.roundTimer));
    console.log('FREEZE_TIME = 4, buyTimeLeft > FREEZE_TIME? ' + ((115 - state.roundTimer) > 4));
  }
  
  // Try buying during next freeze
  console.log('\nWaiting for next round freeze...');
  s1.on('game_state_update', (gs) => {
    const state = gs.gameState || gs.state;
    if (state === 'freeze') {
      console.log('FREEZE state detected! Buying...');
      s1.emit('buy', 'kevlar');
    }
  });
  
  await new Promise(r => setTimeout(r, 15000));
  
  const finalState = await new Promise((resolve) => {
    const handler = (s) => { s1.off('game_state_update', handler); resolve(s); };
    s1.on('game_state_update', handler);
    setTimeout(() => resolve(null), 2000);
  });
  
  if (finalState && finalState.players[p1Id]) {
    const me = finalState.players[p1Id];
    console.log('Final: money=$' + me.money + ' armor=' + me.armor);
  }
  
  s1.disconnect();
  process.exit(0);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
