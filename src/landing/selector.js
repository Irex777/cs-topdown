// Keep old invite URLs working whichever game the player chooses.
const room = new URLSearchParams(location.search).get('room');
if (room) {
  for (const game of ['bf', 'cs']) document.getElementById(game).href = `/${game}/?room=${encodeURIComponent(room)}`;
  document.getElementById('inviteNote').hidden = false;
}

// Room counts come from this server; the default copy also works offline.
fetch('/api/rooms').then((response) => {
  if (!response.ok) throw new Error('Room listing unavailable');
  return response.json();
}).then((counts) => {
  for (const game of ['bf', 'cs']) {
    const count = counts[game];
    if (!Number.isSafeInteger(count) || count <= 0) continue;
    const status = document.getElementById(`${game}Live`);
    status.textContent = `${count} public room${count === 1 ? '' : 's'} open · Join the action`;
    status.classList.add('has-rooms');
  }
}).catch(() => {});
