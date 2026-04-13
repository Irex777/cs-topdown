const C = require('./shared/constants');
const ROUNDS_TO_WIN = C.ROUNDS_TO_WIN;

// Simulate endRound at 12-12 score
let tScore = 12, ctScore = 12;
const winner = 'T';

let willBeGameOver = false;
if (winner === 'T') {
  willBeGameOver = (tScore + 1) >= ROUNDS_TO_WIN;
} else {
  willBeGameOver = (ctScore + 1) >= ROUNDS_TO_WIN;
}

console.log('Score before:', tScore + '-' + ctScore, '| ROUNDS_TO_WIN:', ROUNDS_TO_WIN);
console.log('Winner of round:', winner);
console.log('willBeGameOver:', willBeGameOver);

// After orig increments score:
tScore++;
console.log('Score after:', tScore + '-' + ctScore);
console.log('tScore >= ROUNDS_TO_WIN:', tScore >= ROUNDS_TO_WIN);
console.log('Auto-restart will trigger:', willBeGameOver ? 'YES' : 'NO');
