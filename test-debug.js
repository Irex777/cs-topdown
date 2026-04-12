// Debug bot positions
const io = require('socket.io-client');
const URL = 'https://cs.aiwrk.org';

async function run() {
  const s = io(URL, { query: { name: 'Debug' }, transports: ['websocket', 'polling'], rejectUnauthorized: false });
  await new Promise(r => { s.on('map_data', r); setTimeout(r, 3000); });
  
  s.emit('join_team', 'CT');
  await new Promise(r => setTimeout(r, 500));
  s.emit('add_bots');
  await new Promise(r => setTimeout(r, 500));
  s.emit('start_game');
  await new Promise(r => setTimeout(r, 8000)); // past freeze
  
  // Check 3 samples
  for (let i = 0; i < 3; i++) {
    const state = await new Promise((resolve) => {
      const handler = (st) => { s.off('game_state_update', handler); resolve(st); };
      s.on('game_state_update', handler);
    });
    
    console.log('\n--- Sample ' + (i+1) + ' ---');
    for (const [id, p] of Object.entries(state.players)) {
      if (p.isBot) {
        console.log(p.name + ' (' + p.team + ') x=' + p.x.toFixed(0) + ' y=' + p.y.toFixed(0) + ' hp=' + p.hp + ' alive=' + p.alive + ' wep=' + p.weapons.join(','));
      }
    }
    console.log('Bullets: ' + state.bullets.length);
    await new Promise(r => setTimeout(r, 3000));
  }
  
  s.disconnect();
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
