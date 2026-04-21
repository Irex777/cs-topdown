// CS Top-Down - State Interpolation
import { state } from './state.js';

export const STATE_BUFFER_SIZE = 10;
export let interpDelay = 80; // ms

function lerp(a, b, t) { return a + (b - a) * t; }

export function getInterpolatedState() {
  if (state.stateBuffer.length < 2) return state.stateBuffer[state.stateBuffer.length - 1] || null;

  const now = performance.now();
  const renderTime = now - interpDelay;

  // Find the two states to interpolate between
  let older = null, newer = null;
  for (let i = 0; i < state.stateBuffer.length - 1; i++) {
    if (state.stateBuffer[i]._recvTime <= renderTime && state.stateBuffer[i + 1]._recvTime >= renderTime) {
      older = state.stateBuffer[i];
      newer = state.stateBuffer[i + 1];
      break;
    }
  }

  if (!older || !newer) {
    // Not enough buffered states yet or we fell behind — use latest
    return state.stateBuffer[state.stateBuffer.length - 1];
  }

  const t = (renderTime - older._recvTime) / (newer._recvTime - older._recvTime);
  const alpha = Math.max(0, Math.min(1, t));

  // Interpolate player positions
  const interpPlayers = {};
  for (const id of Object.keys(newer.players)) {
    const np = newer.players[id];
    const op = older.players[id];
    if (op) {
      interpPlayers[id] = {
        ...np,
        x: lerp(op.x, np.x, alpha),
        y: lerp(op.y, np.y, alpha),
        angle: lerp(op.angle, np.angle, alpha),
      };
    } else {
      interpPlayers[id] = np; // New player, no previous state
    }
  }
  return { ...newer, players: interpPlayers };
}
