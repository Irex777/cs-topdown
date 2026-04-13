const io = require('socket.io-client');

const socket = io('https://cs.aiwrk.org', {
  transports: ['polling', 'websocket'],
  reconnection: false,
});

socket.on('connect', () => {
  console.log('Connected:', socket.id);
  // Wait for welcome
});

socket.on('welcome', (data) => {
  console.log('Game state:', data.gameState);
  console.log('Round:', data.round);
  console.log('T score:', data.tScore);
  console.log('CT score:', data.ctScore);
  socket.disconnect();
  process.exit(0);
});

socket.on('game_state_update', (state) => {
  console.log('State update:', JSON.stringify({ state: state.state, round: state.round, tScore: state.tScore, ctScore: state.ctScore }));
});

setTimeout(() => {
  console.log('Timeout - no response');
  socket.disconnect();
  process.exit(1);
}, 10000);
