// Quick script to start game with existing bots
const io = require('socket.io-client');
const URL = 'https://cs.aiwrk.org';

async function run() {
  const s = io(URL, { query: { name: 'Starter' }, transports: ['websocket', 'polling'], rejectUnauthorized: false });
  await new Promise(r => { s.on('map_data', r); setTimeout(r, 3000); });
  
  // Join CT
  s.emit('join_team', 'CT');
  await new Promise(r => setTimeout(r, 500));
  
  // Start game
  s.emit('start_game');
  console.log('Game started!');
  
  // Wait for combat
  s.on('player_killed', (data) => {
    console.log('☠', data.killerName, '->', data.victimName, '(' + data.weapon + ')');
  });
  
  s.on('round_end', (data) => {
    console.log('Round ended:', data.winner, data.reason, 'T:' + data.tScore + ' CT:' + data.ctScore);
  });
  
  // Keep alive for 60 seconds
  await new Promise(r => setTimeout(r, 60000));
  s.disconnect();
  console.log('Done');
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
