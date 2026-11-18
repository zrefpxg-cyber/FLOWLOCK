const GAME_ROOMS_KEY = 'flowlock_game_rooms';
const GAME_DEFINITIONS = {
  snakes: { name: 'บันไดงู', capacity: 4 },
  checkers: { name: 'หมากฮอส', capacity: 2 },
  property: { name: 'เกมเศรษฐี', capacity: 4 }
};

function readGameRooms() {
  try {
    const rooms = JSON.parse(localStorage.getItem(GAME_ROOMS_KEY) || '[]');
    return Array.isArray(rooms) ? rooms : [];
  } catch (error) {
    return [];
  }
}

function saveGameRooms(rooms) {
  try {
    localStorage.setItem(GAME_ROOMS_KEY, JSON.stringify(rooms));
    return true;
  } catch (error) {
    return false;
  }
}

function makeRoomCode(rooms) {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.some((room) => room.code === code));
  return code;
}

function gameRoomUrl(room) {
  return `game-room.html?room=${encodeURIComponent(room.code)}`;
}

function showGameMessage(element, text, isError = true) {
  if (!element) return;
  element.textContent = text;
  element.className = isError ? 'msg' : 'msg ok';
}

function makeInitialState(game, members) {
  if (game === 'snakes') return { positions: members.map(() => 0), turn: 0, die: null, winner: null };
  if (game === 'checkers') {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 8; col += 1) if ((row + col) % 2 === 1) board[row][col] = 'b';
    }
    for (let row = 5; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) if ((row + col) % 2 === 1) board[row][col] = 'a';
    }
    return { board, turn: 0, winner: null };
  }
  return { positions: members.map(() => 0), money: members.map(() => 1500), owners: Array(16).fill(null), turn: 0, die: null, pendingBuy: null, winner: null };
}

function setupGamesPage() {
  if (!requireAuth()) return;

  const dialog = document.getElementById('gameModeDialog');
  const gameName = document.getElementById('selectedGameName');
  const joinForm = document.getElementById('joinGameForm');
  const joinMessage = document.getElementById('joinGameMessage');
  let selectedGame = '';

  document.querySelectorAll('.game-open').forEach((button) => {
    button.addEventListener('click', () => {
      selectedGame = button.dataset.game;
      gameName.textContent = GAME_DEFINITIONS[selectedGame].name;
      dialog.showModal();
    });
  });

  document.querySelector('.dialog-close')?.addEventListener('click', () => dialog.close());

  document.getElementById('normalModeButton')?.addEventListener('click', () => {
    createGameRoom(selectedGame, 'normal', joinMessage);
  });

  document.getElementById('textModeButton')?.addEventListener('click', () => {
    createGameRoom(selectedGame, 'text', joinMessage);
  });

  if (joinForm) joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = document.getElementById('joinGameCode').value.trim();
    const rooms = readGameRooms();
    const room = rooms.find((item) => item.code === code);
    if (!room) {
      showGameMessage(joinMessage, 'ไม่พบห้องนี้');
      return;
    }
    if (room.members.includes(getSession())) {
      window.location.href = gameRoomUrl(room);
      return;
    }
    if (room.members.length >= room.capacity || room.status === 'finished') {
      showGameMessage(joinMessage, 'ห้องนี้เต็มหรือจบเกมแล้ว');
      return;
    }
    if (room.invited.length && !room.invited.includes(getSession())) {
      showGameMessage(joinMessage, 'ห้องนี้รับเฉพาะผู้เล่นที่ได้รับเชิญ');
      return;
    }
    room.members.push(getSession());
    room.invited = room.invited.filter((name) => name !== getSession());
    if (!saveGameRooms(rooms)) {
      showGameMessage(joinMessage, 'เข้าห้องไม่สำเร็จ');
      return;
    }
    window.location.href = gameRoomUrl(room);
  });

  if (window.location.hash === '#join') document.getElementById('joinGameCode')?.focus();
}

function createGameRoom(game, mode, message) {
  const rooms = readGameRooms();
  const definition = GAME_DEFINITIONS[game];
  if (!definition) return;
  const host = getSession();
  const room = {
    code: makeRoomCode(rooms), game, mode, host,
    capacity: definition.capacity, members: [host], invited: [], status: 'lobby',
    textEntries: {}, state: null, createdAt: Date.now()
  };
  rooms.push(room);
  if (!saveGameRooms(rooms)) {
    showGameMessage(message, 'สร้างห้องไม่สำเร็จ');
    return;
  }
  window.location.href = gameRoomUrl(room);
}

function setupGameRoomPage() {
  if (!requireAuth()) return;

  const code = new URLSearchParams(window.location.search).get('room');
  const roomCode = document.getElementById('gameRoomCode');
  const title = document.getElementById('gameRoomTitle');
  const status = document.getElementById('gameRoomStatus');
  const people = document.getElementById('gameRoomPeople');
  const inviteSelect = document.getElementById('gameInviteFriend');
  const inviteForm = document.getElementById('gameInviteForm');
  const startButton = document.getElementById('startGameButton');
  const lobby = document.getElementById('gameLobby');
  const boardWrap = document.getElementById('gameBoardWrap');
  const textChallengePanel = document.getElementById('textChallengePanel');
  const textChallengeForm = document.getElementById('textChallengeForm');
  const textChallengeInput = document.getElementById('textChallengeInput');
  const textChallengeStatus = document.getElementById('textChallengeStatus');
  const winnerMessages = document.getElementById('winnerMessages');
  const message = document.getElementById('gameRoomMessage');
  const currentUser = getSession();
  let selectedPiece = null;

  const loadRoom = () => readGameRooms().find((room) => room.code === code);
  const persist = (room) => {
    const rooms = readGameRooms();
    const index = rooms.findIndex((item) => item.code === room.code);
    if (index < 0) return false;
    rooms[index] = room;
    return saveGameRooms(rooms);
  };

  const draw = () => {
    const room = loadRoom();
    if (!room || !room.members.includes(currentUser)) {
      title.textContent = 'เข้าห้องไม่ได้';
      status.textContent = 'ไม่พบห้อง หรือคุณยังไม่ได้เข้าร่วม';
      lobby.hidden = true;
      boardWrap.hidden = true;
      return;
    }
    title.textContent = GAME_DEFINITIONS[room.game].name;
    roomCode.textContent = room.code;
    document.getElementById('gameRoomShare').value = `${location.origin}${location.pathname.replace(/game-room\.html$/, 'games.html')}`;
    people.innerHTML = room.members.map((name, index) => `<span class="room-person">${escapeHtml(name)}${name === room.host ? ' · เจ้าของห้อง' : ''}${room.state && room.state.turn === index ? ' · ตาของคุณ' : ''}</span>`).join('');
    fillInviteSelect(inviteSelect, room);
    lobby.hidden = room.status !== 'lobby';
    boardWrap.hidden = room.status !== 'playing' && room.status !== 'finished';
    const textEntries = room.textEntries || {};
    const hasAllTextEntries = room.members.every((member) => typeof textEntries[member] === 'string' && textEntries[member].trim());
    const textEntryCount = room.members.filter((member) => typeof textEntries[member] === 'string' && textEntries[member].trim()).length;
    const canStart = room.members.length >= 2 && (room.mode !== 'text' || hasAllTextEntries);
    startButton.hidden = room.host !== currentUser || room.status !== 'lobby' || !canStart;
    textChallengePanel.hidden = room.mode !== 'text' || room.status !== 'lobby';
    textChallengeStatus.textContent = `ส่งข้อความแล้ว ${textEntryCount}/${room.members.length} คน`;
    if (document.activeElement !== textChallengeInput) textChallengeInput.value = textEntries[currentUser] || '';
    status.textContent = room.status === 'lobby'
      ? `รอผู้เล่น · ${room.members.length}/${room.capacity} คน${room.mode === 'text' ? ` · ส่งข้อความ ${textEntryCount}/${room.members.length}` : ''}`
      : room.status === 'finished' ? `จบเกม · ผู้ชนะ ${room.members[room.state.turn] || room.state.winner}` : 'เกมกำลังดำเนินอยู่';
    renderWinnerMessages(winnerMessages, room, currentUser);
    if (boardWrap.hidden) return;
    if (!room.state) room.state = makeInitialState(room.game, room.members);
    renderGame(room, boardWrap, currentUser, persist, draw, () => selectedPiece, (value) => { selectedPiece = value; });
  };

  if (!code) {
    title.textContent = 'ไม่พบรหัสห้อง';
    return;
  }

  document.getElementById('copyGameCode').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(roomCode.textContent);
      showGameMessage(message, 'คัดลอกรหัสห้องแล้ว', false);
    } catch (error) {
      showGameMessage(message, 'คัดลอกรหัสไม่สำเร็จ');
    }
  });

  inviteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const room = loadRoom();
    const friend = inviteSelect.value;
    if (!room || room.host !== currentUser || !friend) return;
    if (room.members.length >= room.capacity) {
      showGameMessage(message, 'ห้องเต็มแล้ว');
      return;
    }
    if (!room.invited.includes(friend) && !room.members.includes(friend)) room.invited.push(friend);
    if (!persist(room)) showGameMessage(message, 'ส่งคำเชิญไม่สำเร็จ');
    else showGameMessage(message, `เชิญ ${friend} แล้ว ส่งรหัสห้อง ${room.code} ให้เพื่อน`, false);
    draw();
  });

  textChallengeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const room = loadRoom();
    const text = textChallengeInput.value.trim();
    if (!room || room.status !== 'lobby' || room.mode !== 'text' || !room.members.includes(currentUser)) return;
    if (!text) {
      showGameMessage(message, 'กรุณาพิมพ์ข้อความก่อนส่ง');
      return;
    }
    if (/https?:\/\/|www\./i.test(text)) {
      showGameMessage(message, 'โหมดนี้รับเฉพาะข้อความ ไม่รับ URL หรือลิงก์');
      return;
    }
    room.textEntries = room.textEntries || {};
    room.textEntries[currentUser] = text;
    if (!persist(room)) {
      showGameMessage(message, 'บันทึกข้อความไม่สำเร็จ พื้นที่จัดเก็บของเบราว์เซอร์อาจไม่เพียงพอ');
      return;
    }
    showGameMessage(message, 'ส่งข้อความแล้ว รอผู้เล่นทุกคนส่งให้ครบก่อนเริ่มเกม', false);
    draw();
  });

  startButton.addEventListener('click', () => {
    const room = loadRoom();
    const textEntries = room?.textEntries || {};
    const hasAllTextEntries = room?.members.every((member) => typeof textEntries[member] === 'string' && textEntries[member].trim());
    if (!room || room.host !== currentUser || room.members.length < 2 || (room.mode === 'text' && !hasAllTextEntries)) return;
    room.state = makeInitialState(room.game, room.members);
    room.status = 'playing';
    persist(room);
    draw();
  });

  window.addEventListener('storage', draw);
  draw();
}

function renderWinnerMessages(container, room, currentUser) {
  if (!container) return;
  const winnerIndex = room.state?.winner;
  const winner = Number.isInteger(winnerIndex) ? room.members[winnerIndex] : null;
  if (room.status !== 'finished' || room.mode !== 'text' || winner !== currentUser) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }
  const entries = room.members.map((member) => ({ member, text: room.textEntries?.[member] })).filter((entry) => typeof entry.text === 'string');
  container.hidden = false;
  container.innerHTML = `<p class="eyebrow">WINNER REWARD</p><h2>คุณชนะ รับข้อความจากผู้เล่น</h2>${entries.map((entry) => `<article class="winner-message"><strong>${escapeHtml(entry.member)}</strong><p>${escapeHtml(entry.text)}</p></article>`).join('')}`;
}

function fillInviteSelect(select, room) {
  const friends = getFriendsForCurrentUser().filter((friend) =>
    !room.members.includes(friend.name) && !room.invited.includes(friend.name)
  );
  select.innerHTML = friends.length
    ? friends.map((friend) => `<option value="${escapeHtml(friend.name)}">${escapeHtml(friend.name)}</option>`).join('')
    : '<option value="">ไม่มีเพื่อนให้เชิญ</option>';
  document.getElementById('sendGameInvite').disabled = !friends.length || room.members.length >= room.capacity;
}

function renderGame(room, container, currentUser, persist, draw, getSelected, setSelected) {
  if (room.game === 'snakes') renderSnakes(room, container, currentUser, persist, draw);
  if (room.game === 'checkers') renderCheckers(room, container, currentUser, persist, draw, getSelected, setSelected);
  if (room.game === 'property') renderProperty(room, container, currentUser, persist, draw);
}

function renderSnakes(room, container, currentUser, persist, draw) {
  const state = room.state;
  const active = state.winner === null && room.members[state.turn] === currentUser;
  const cells = [];
  for (let row = 0; row < 10; row += 1) {
    const boardRow = 9 - row;
    const start = boardRow * 10 + 1;
    for (let col = 0; col < 10; col += 1) {
      const number = boardRow % 2 === 0 ? start + col : start + 9 - col;
      const pawns = state.positions.map((position, index) => position === number
        ? `<span title="${escapeHtml(room.members[index])}">${['🔴', '🔵', '🟢', '🟡'][index]}</span>` : '').join('');
      cells.push(`<div class="board-cell"><small>${number}</small><div class="board-pawns">${pawns}</div></div>`);
    }
  }
  container.innerHTML = `<h2>บันไดงู · ช่อง ${state.positions.map((position, index) => `${escapeHtml(room.members[index])}: ${position}`).join(' · ')}</h2>
    <div class="game-board snakes-board">${cells.join('')}</div>
    <div class="game-controls"><span class="dice-face">${state.die || '⚄'}</span><button id="rollGameDice" class="btn" type="button" ${active ? '' : 'disabled'}>ทอยลูกเต๋า</button><span>${state.winner === null ? `ตาของ ${escapeHtml(room.members[state.turn])}` : `ผู้ชนะ: ${escapeHtml(room.members[state.winner])}`}</span></div>`;
  document.getElementById('rollGameDice').addEventListener('click', () => {
    if (!active) return;
    const die = Math.floor(Math.random() * 6) + 1;
    let position = state.positions[state.turn];
    if (position + die <= 100) position += die;
    const ladders = { 4: 14, 9: 31, 20: 38, 28: 84, 40: 59, 51: 67, 63: 81, 71: 91 };
    const snakes = { 17: 7, 54: 34, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 99: 78 };
    position = ladders[position] || snakes[position] || position;
    state.positions[state.turn] = position;
    state.die = die;
    if (position === 100) {
      state.winner = state.turn;
      room.status = 'finished';
    } else state.turn = (state.turn + 1) % room.members.length;
    persist(room);
    draw();
  });
}

function checkerMoves(board, row, col) {
  const piece = board[row][col];
  if (!piece) return [];
  const side = piece.toLowerCase();
  const directions = piece === side ? (side === 'a' ? [-1] : [1]) : [-1, 1];
  const moves = [];
  directions.forEach((rowStep) => [-1, 1].forEach((colStep) => {
    const nextRow = row + rowStep;
    const nextCol = col + colStep;
    if (nextRow < 0 || nextRow > 7 || nextCol < 0 || nextCol > 7) return;
    if (!board[nextRow][nextCol]) moves.push({ row: nextRow, col: nextCol });
    else if (board[nextRow][nextCol].toLowerCase() !== side) {
      const jumpRow = nextRow + rowStep;
      const jumpCol = nextCol + colStep;
      if (jumpRow >= 0 && jumpRow < 8 && jumpCol >= 0 && jumpCol < 8 && !board[jumpRow][jumpCol]) {
        moves.push({ row: jumpRow, col: jumpCol, capture: { row: nextRow, col: nextCol } });
      }
    }
  }));
  return moves;
}

function renderCheckers(room, container, currentUser, persist, draw, getSelected, setSelected) {
  const state = room.state;
  const side = room.members.indexOf(currentUser) === 0 ? 'a' : 'b';
  const active = state.winner === null && room.members[state.turn] === currentUser;
  const cells = [];
  state.board.forEach((row, rowIndex) => row.forEach((piece, colIndex) => {
    const selected = getSelected();
    const isSelected = selected && selected.row === rowIndex && selected.col === colIndex;
    const symbol = !piece ? '' : piece.toLowerCase() === 'a' ? (piece === 'a' ? '🔴' : '👑') : (piece === 'b' ? '⚪' : '♔');
    cells.push(`<button class="checkers-cell ${(rowIndex + colIndex) % 2 ? 'dark' : 'light'} ${isSelected ? 'selected' : ''}" data-row="${rowIndex}" data-col="${colIndex}" type="button" ${active ? '' : 'disabled'}>${symbol}</button>`);
  }));
  container.innerHTML = `<h2>หมากฮอส · ตาของ ${escapeHtml(room.members[state.turn])}</h2><div class="game-board checkers-board">${cells.join('')}</div>${state.winner ? `<p class="trade-note">ผู้ชนะ: ${escapeHtml(room.members[state.winner])}</p>` : '<p class="trade-intro">เลือกหมากของคุณ แล้วเลือกช่องทแยงที่เดินได้ · กินหมากด้วยการกระโดดข้าม</p>'}`;
  container.querySelectorAll('.checkers-cell').forEach((button) => button.addEventListener('click', () => {
    if (!active || room.members[state.turn] !== currentUser) return;
    const row = Number(button.dataset.row);
    const col = Number(button.dataset.col);
    const selected = getSelected();
    if (selected) {
      const move = checkerMoves(state.board, selected.row, selected.col).find((item) => item.row === row && item.col === col);
      if (move) {
        let piece = state.board[selected.row][selected.col];
        state.board[selected.row][selected.col] = null;
        if (move.capture) state.board[move.capture.row][move.capture.col] = null;
        if ((piece === 'a' && row === 0) || (piece === 'b' && row === 7)) piece = piece.toUpperCase();
        state.board[row][col] = piece;
        const other = side === 'a' ? 'b' : 'a';
        if (!state.board.flat().some((item) => item && item.toLowerCase() === other)) {
          state.winner = room.members.indexOf(currentUser);
          room.status = 'finished';
        } else state.turn = (state.turn + 1) % 2;
        setSelected(null);
        persist(room);
        draw();
        return;
      }
    }
    const piece = state.board[row][col];
    if (piece && piece.toLowerCase() === side) setSelected({ row, col });
    else setSelected(null);
    draw();
  }));
}

const PROPERTY_TILES = [
  { name: 'เริ่มต้น', emoji: '🏁', kind: 'start', cost: 0 },
  { name: 'สวนส้ม', emoji: '🍊', kind: 'property', cost: 100 },
  { name: 'ถนนริมคลอง', emoji: '🌉', kind: 'property', cost: 120 },
  { name: 'รับโบนัส', emoji: '🎁', kind: 'event', cost: 0 },
  { name: 'ตลาดนัด', emoji: '🛍️', kind: 'property', cost: 140 },
  { name: 'สวนสาธารณะ', emoji: '🌳', kind: 'property', cost: 160 },
  { name: 'สถานีรถไฟ', emoji: '🚉', kind: 'property', cost: 180 },
  { name: 'รับโบนัส', emoji: '🎁', kind: 'event', cost: 0 },
  { name: 'คาเฟ่', emoji: '☕', kind: 'property', cost: 200 },
  { name: 'โรงหนัง', emoji: '🎬', kind: 'property', cost: 220 },
  { name: 'ท่าเรือ', emoji: '🚢', kind: 'property', cost: 240 },
  { name: 'รับโบนัส', emoji: '🎁', kind: 'event', cost: 0 },
  { name: 'โรงแรม', emoji: '🏨', kind: 'property', cost: 260 },
  { name: 'ห้างสรรพสินค้า', emoji: '🏬', kind: 'property', cost: 280 },
  { name: 'สนามกีฬา', emoji: '🏟️', kind: 'property', cost: 300 },
  { name: 'รับโบนัส', emoji: '🎁', kind: 'event', cost: 0 }
];

const PROPERTY_TRACK = [
  [0, 0], [0, 1], [0, 2], [0, 3], [0, 4],
  [1, 4], [2, 4], [3, 4], [4, 4], [4, 3],
  [4, 2], [4, 1], [4, 0], [3, 0], [2, 0], [1, 0]
];

const PROPERTY_DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

function renderProperty(room, container, currentUser, persist, draw) {
  const state = room.state;
  const active = state.winner === null && room.members[state.turn] === currentUser;
  const tiles = PROPERTY_TILES.map((tile, index) => {
    const [row, col] = PROPERTY_TRACK[index];
    const owner = state.owners[index];
    const occupants = state.positions.map((position, player) => position === index
      ? `<span class="property-pawn" title="${escapeHtml(room.members[player])}">${['🔴', '🔵', '🟢', '🟡'][player]}</span>` : '').join('');
    const currentPlayerHere = state.positions[state.turn] === index;
    const ownerLabel = owner !== null ? ` · ${escapeHtml(room.members[owner])}` : '';
    const costLabel = tile.cost ? `${tile.cost} เหรียญ${ownerLabel}` : 'ช่องพิเศษ';
    return `<div class="property-tile ${currentPlayerHere ? 'current' : ''}" data-kind="${tile.kind}" style="grid-row:${row + 1};grid-column:${col + 1}">
      <span class="property-order">${index === 0 ? 'เริ่ม' : index}</span>
      <span class="property-emoji" aria-hidden="true">${tile.emoji}</span>
      <strong class="property-name">${escapeHtml(tile.name)}</strong>
      <small>${costLabel}</small>
      <span class="property-pawns">${occupants}</span>
    </div>`;
  }).join('');
  const playerScores = room.members.map((name, index) => `<div class="player-score">${escapeHtml(name)}: ${state.money[index]} เหรียญ${state.turn === index ? ' · ตาคุณ' : ''}</div>`).join('');
  const pending = state.pendingBuy !== null && room.members[state.turn] === currentUser;
  container.innerHTML = `<h2>เกมเศรษฐี · เดินตามเข็มนาฬิกา</h2><div class="game-board property-board">${tiles}
    <div class="property-center"><p class="eyebrow">START · FINISH</p><strong>วงรอบทรัพย์สิน</strong><span class="property-direction" aria-label="เดินตามเข็มนาฬิกา">↻ ตามเข็มนาฬิกา</span>
      <div class="player-scores">${playerScores}</div><span id="propertyDieFace" class="dice-face property-die" aria-hidden="true">${state.die ? PROPERTY_DICE_FACES[state.die - 1] : '🎲'}</span>
      <span id="propertyDieResult" class="property-die-result" aria-live="polite">${state.die ? `ได้ ${state.die} แต้ม` : 'รอทอยลูกเต๋า'}</span>
      <span class="property-turn">ตาของ ${escapeHtml(room.members[state.turn])}</span>
    </div>
  </div>
    <div class="game-controls"><button id="propertyRoll" class="btn" type="button" ${active && !pending ? '' : 'disabled'}>ทอยลูกเต๋า</button>
    ${pending ? '<button id="propertyBuy" class="mini-btn" type="button">ซื้อที่ดิน</button><button id="propertySkip" class="mini-btn" type="button">ผ่าน</button>' : ''}</div>
    ${state.winner !== null ? `<p class="trade-note">ผู้ชนะ: ${escapeHtml(room.members[state.winner])}</p>` : '<p class="trade-intro">ลงช่องที่ดินเพื่อซื้อ หรือจ่ายค่าเช่าให้เจ้าของ</p>'}`;
  document.getElementById('propertyRoll').addEventListener('click', () => {
    if (!active || state.pendingBuy !== null) return;
    const rollButton = document.getElementById('propertyRoll');
    const dieFace = document.getElementById('propertyDieFace');
    const dieResult = document.getElementById('propertyDieResult');
    rollButton.disabled = true;
    dieFace.classList.add('rolling');
    dieResult.textContent = 'กำลังทอย…';
    let animationFrame = 0;
    const animation = setInterval(() => {
      dieFace.textContent = PROPERTY_DICE_FACES[Math.floor(Math.random() * PROPERTY_DICE_FACES.length)];
      animationFrame += 1;
      if (animationFrame >= 10) clearInterval(animation);
    }, 70);

    setTimeout(() => {
      clearInterval(animation);
      dieFace.classList.remove('rolling');
      const die = Math.floor(Math.random() * 6) + 1;
      const player = state.turn;
      const before = state.positions[player];
      const position = (before + die) % PROPERTY_TILES.length;
      if (before + die >= PROPERTY_TILES.length) state.money[player] += 200;
      state.positions[player] = position;
      state.die = die;
      dieResult.textContent = `ได้ ${die} แต้ม`;
      const owner = state.owners[position];
      const property = PROPERTY_TILES[position];
      if (property.cost && owner === null) state.pendingBuy = position;
      else {
        if (property.cost && owner !== player) {
          const rent = Math.ceil(property.cost / 4);
          state.money[player] -= rent;
          state.money[owner] += rent;
          if (state.money[player] < 0) {
            state.money[player] = 0;
            state.winner = owner;
            room.status = 'finished';
          }
        }
        state.turn = (state.turn + 1) % room.members.length;
      }
      persist(room);
      draw();
    }, 760);
  });
  if (pending) {
    document.getElementById('propertyBuy').addEventListener('click', () => {
      const player = state.turn;
      const property = PROPERTY_TILES[state.pendingBuy];
      if (state.money[player] >= property.cost) {
        state.money[player] -= property.cost;
        state.owners[state.pendingBuy] = player;
      }
      state.pendingBuy = null;
      state.turn = (state.turn + 1) % room.members.length;
      persist(room);
      draw();
    });
    document.getElementById('propertySkip').addEventListener('click', () => {
      state.pendingBuy = null;
      state.turn = (state.turn + 1) % room.members.length;
      persist(room);
      draw();
    });
  }
}

if (['app', 'games'].includes(document.body?.dataset.page)) setupGamesPage();
if (document.body?.dataset.page === 'game-room') setupGameRoomPage();