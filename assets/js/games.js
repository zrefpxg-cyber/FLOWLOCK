const GAME_DEFINITIONS = {
  snakes: { name: 'บันไดงู', capacity: 4 },
  checkers: { name: 'หมากฮอส', capacity: 2 },
  property: { name: 'เกมเศรษฐี', capacity: 4 }
};

function gameRoomUrl(room) {
  return `game-room.html?room=${encodeURIComponent(room.code)}`;
}

function getSharedGameRoomId(code) {
  return `game-${code}`;
}

function getGameParticipantIds(room) {
  const botIds = new Set(room.botIds || []);
  return Array.from(new Set([
    ...(room.memberIds || []).filter((id) => !botIds.has(id)),
    ...(room.invitedIds || [])
  ]));
}

function showGameMessage(element, text, isError = true) {
  if (!element) return;
  element.textContent = text;
  element.className = isError ? 'msg' : 'msg ok';
}

/* =====================================================================
   FLOWLOCK GAME FX — แอนิเมชันลูกเต๋า 3D / การเดินหมาก / เอฟเฟกต์ชนะ
   ===================================================================== */
const FX_REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FX_COLORS = ['#ff5a76', '#4aa3ff', '#3ddc97', '#ffd24a'];
const FX_OFFSETS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const gameMemory = {};

const fxWait = (ms) => new Promise((resolve) => setTimeout(resolve, FX_REDUCED ? Math.min(ms, 30) : ms));

function fxAnimate(element, keyframes, options) {
  if (!element || !element.animate || FX_REDUCED) return Promise.resolve();
  return element.animate(keyframes, options).finished.catch(() => {});
}

/* ---------- busy lock: กัน re-render ขณะกำลังเล่นแอนิเมชัน ---------- */
function fxSetBusy(container, promise) {
  container._busy = promise;
  const release = () => {
    if (container._busy !== promise) return;
    container._busy = null;
    const deferred = container._deferDraw;
    container._deferDraw = null;
    if (deferred) deferred();
  };
  promise.then(release, release);
}

async function fxWaitForIdle(container) {
  while (container && container._busy) await container._busy;
}

async function runLocalMove(container, room, persist, draw, work) {
  const job = (async () => { await work(); await persist(room); })();
  fxSetBusy(container, job.catch(() => {}));
  try {
    await job;
  } catch (error) {
    showGameMessage(document.getElementById('gameRoomMessage'), error.message || 'บันทึกสถานะเกมไม่สำเร็จ');
  }
  draw();
}

window.addEventListener('resize', () => {
  const wrap = document.getElementById('gameBoardWrap');
  if (wrap && wrap._relayout) wrap._relayout();
}, { passive: true });

/* ---------- ลูกเต๋า 3 มิติ ---------- */
const DICE_PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const DICE_ORIENT = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, -180] };

function diceMarkup(value, size = '52px') {
  const face = Math.min(6, Math.max(1, Number(value) || 5));
  const faces = [1, 2, 3, 4, 5, 6].map((n) =>
    `<i class="die-face df${n}">${Array.from({ length: 9 }, (_, i) => `<b${DICE_PIPS[n].includes(i) ? ' class="on"' : ''}></b>`).join('')}</i>`
  ).join('');
  const [rx, ry] = DICE_ORIENT[face];
  return `<span class="die3d" style="--die:${size}"><span class="die-shadow"></span><span class="die-toss"><span class="die-tilt"><span class="die-cube" style="transform:rotateX(${rx}deg) rotateY(${ry}deg)">${faces}</span></span></span></span>`;
}

async function rollDie(host, value, duration = 1100) {
  const die = host && host.querySelector('.die3d');
  if (!die) return;
  const cube = die.querySelector('.die-cube');
  const toss = die.querySelector('.die-toss');
  const shadow = die.querySelector('.die-shadow');
  const [rx, ry] = DICE_ORIENT[value];
  cube.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
  if (FX_REDUCED) return;

  const turns = () => (Math.random() < 0.5 ? -1 : 1) * 360 * (2 + Math.floor(Math.random() * 2));
  const height = (die.offsetHeight || 52) * 1.6;
  const side = (Math.random() < 0.5 ? -1 : 1) * (die.offsetWidth || 52) * 1.3;
  die.classList.add('rolling');
  die.classList.remove('landed');

  await Promise.all([
    fxAnimate(cube, [
      { transform: `rotateX(${Math.random() * 360}deg) rotateY(${Math.random() * 360}deg) rotateZ(90deg)` },
      { transform: `rotateX(${rx + turns()}deg) rotateY(${ry + turns()}deg) rotateZ(0deg)` }
    ], { duration, easing: 'cubic-bezier(.16,.7,.25,1)' }),
    fxAnimate(toss, [
      { transform: `translate(${side}px, ${-height * 0.2}px) scale(.8)`, offset: 0, easing: 'ease-out' },
      { transform: `translate(${side * 0.35}px, ${-height}px) scale(1.25)`, offset: 0.3, easing: 'ease-in' },
      { transform: 'translate(0, 0) scale(1)', offset: 0.55, easing: 'ease-out' },
      { transform: `translate(${-side * 0.08}px, ${-height * 0.28}px) scale(1.05)`, offset: 0.72, easing: 'ease-in' },
      { transform: 'translate(0, 0) scale(1)', offset: 0.86, easing: 'ease-out' },
      { transform: `translate(0, ${-height * 0.07}px)`, offset: 0.94, easing: 'ease-in' },
      { transform: 'translate(0, 0)', offset: 1 }
    ], { duration }),
    fxAnimate(shadow, [
      { opacity: 0.15, transform: 'scale(.4)', offset: 0 },
      { opacity: 0.1, transform: 'scale(.3)', offset: 0.3 },
      { opacity: 0.6, transform: 'scale(1)', offset: 0.55 },
      { opacity: 0.25, transform: 'scale(.6)', offset: 0.72 },
      { opacity: 0.6, transform: 'scale(1)', offset: 0.86 },
      { opacity: 0.6, transform: 'scale(1)', offset: 1 }
    ], { duration })
  ]);
  die.classList.remove('rolling');
  die.classList.add('landed');
}

/* ---------- เอฟเฟกต์เล็ก ๆ ---------- */
function fxRipple(layer, x, y, color = '#f4d35e') {
  if (FX_REDUCED) return;
  const ring = document.createElement('span');
  ring.className = 'fx-ripple';
  ring.style.cssText = `left:${x}px;top:${y}px;border-color:${color}`;
  layer.appendChild(ring);
  fxAnimate(ring, [
    { transform: 'translate(-50%,-50%) scale(.2)', opacity: 0.9 },
    { transform: 'translate(-50%,-50%) scale(2.6)', opacity: 0 }
  ], { duration: 650, easing: 'ease-out' }).then(() => ring.remove());
}

function fxFloatText(layer, x, y, text, color = '#fff') {
  if (FX_REDUCED) return;
  const label = document.createElement('span');
  label.className = 'fx-float';
  label.textContent = text;
  label.style.cssText = `left:${x}px;top:${y}px;color:${color}`;
  layer.appendChild(label);
  fxAnimate(label, [
    { transform: 'translate(-50%,-10%) scale(.6)', opacity: 0 },
    { transform: 'translate(-50%,-90%) scale(1.15)', opacity: 1, offset: 0.25 },
    { transform: 'translate(-50%,-190%) scale(1)', opacity: 0 }
  ], { duration: 1300, easing: 'ease-out' }).then(() => label.remove());
}

function fxSparks(layer, x, y, color) {
  if (FX_REDUCED) return;
  for (let i = 0; i < 9; i += 1) {
    const dot = document.createElement('span');
    dot.className = 'fx-spark';
    dot.style.cssText = `left:${x}px;top:${y}px;background:${color}`;
    layer.appendChild(dot);
    const angle = (Math.PI * 2 * i) / 9 + Math.random() * 0.5;
    const distance = 22 + Math.random() * 22;
    fxAnimate(dot, [
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(angle) * distance}px), calc(-50% + ${Math.sin(angle) * distance}px)) scale(0)`, opacity: 0 }
    ], { duration: 520 + Math.random() * 200, easing: 'ease-out' }).then(() => dot.remove());
  }
}

function fxConfetti(container) {
  if (FX_REDUCED) return;
  const wrap = document.createElement('div');
  wrap.className = 'confetti-wrap';
  container.appendChild(wrap);
  const palette = [...FX_COLORS, '#a855f7', '#ffffff'];
  for (let i = 0; i < 70; i += 1) {
    const piece = document.createElement('i');
    const size = 6 + Math.random() * 8;
    piece.style.cssText = `left:${Math.random() * 100}%;width:${size}px;height:${size * 0.5}px;background:${palette[i % palette.length]}`;
    wrap.appendChild(piece);
    const drift = (Math.random() - 0.5) * 160;
    fxAnimate(piece, [
      { transform: 'translate(0,-20px) rotate(0deg)', opacity: 1 },
      { transform: `translate(${drift}px, ${container.offsetHeight + 40}px) rotate(${360 + Math.random() * 720}deg)`, opacity: 0.9 }
    ], { duration: 2000 + Math.random() * 1600, delay: Math.random() * 700, easing: 'cubic-bezier(.3,.6,.5,1)', fill: 'backwards' });
  }
  window.setTimeout(() => wrap.remove(), 4600);
}

function fxCelebrate(container, state, mem, wasLive) {
  if (state.winner === null || mem.celebrated) return;
  mem.celebrated = true;
  if (wasLive) fxConfetti(container);
}

/* ---------- หมาก (pawn) บนกระดาน ---------- */
function fxPawnTransform(spot) {
  return `translate(${spot.x}px, ${spot.y}px)`;
}

function makePawnLayer(board, count, anchorOf) {
  const layer = document.createElement('div');
  layer.className = 'pawn-layer';
  board.appendChild(layer);
  const pawns = [];
  const api = { layer, pawns };

  api.cellWidth = () => anchorOf(1).offsetWidth || 30;
  api.center = (position) => {
    const anchor = anchorOf(position);
    return { x: anchor.offsetLeft + anchor.offsetWidth / 2, y: anchor.offsetTop + anchor.offsetHeight / 2 };
  };
  api.spot = (player, position) => {
    const width = api.cellWidth();
    const size = Math.max(14, Math.min(34, width * 0.42));
    const spread = Math.min(width * 0.2, 13);
    const offset = FX_OFFSETS[player % 4];
    const center = api.center(position);
    return { x: center.x + offset[0] * spread - size / 2, y: center.y + offset[1] * spread - size / 2, size };
  };
  api.place = (player, position) => {
    const spot = api.spot(player, position);
    const pawn = pawns[player];
    pawn.style.width = `${spot.size}px`;
    pawn.style.height = `${spot.size}px`;
    pawn.style.transform = fxPawnTransform(spot);
  };
  api.markTurn = (turn, enabled) => {
    pawns.forEach((pawn, index) => pawn.classList.toggle('is-turn', enabled && index === turn));
  };

  for (let i = 0; i < count; i += 1) {
    const pawn = document.createElement('div');
    pawn.className = 'pawn';
    pawn.style.setProperty('--pc', FX_COLORS[i % 4]);
    pawn.innerHTML = '<span class="pawn-body"></span>';
    layer.appendChild(pawn);
    pawns.push(pawn);
  }
  return api;
}

/* กระโดดหนึ่งช่อง */
async function fxHop(api, player, from, to, duration = 240) {
  const pawn = api.pawns[player];
  const a = api.spot(player, from);
  const b = api.spot(player, to);
  const body = pawn.firstElementChild;
  const lift = Math.max(10, a.size * 0.75);
  pawn.style.zIndex = '6';
  pawn.style.transform = fxPawnTransform(b);
  await Promise.all([
    fxAnimate(pawn, [{ transform: fxPawnTransform(a) }, { transform: fxPawnTransform(b) }],
      { duration, easing: 'cubic-bezier(.45,.05,.35,1)' }),
    fxAnimate(body, [
      { transform: 'translateY(0) scale(1,1)', offset: 0 },
      { transform: `translateY(${-lift}px) scale(.92,1.12)`, offset: 0.45 },
      { transform: 'translateY(0) scale(1.22,.78)', offset: 0.85 },
      { transform: 'translateY(0) scale(1,1)', offset: 1 }
    ], { duration: duration + 60, easing: 'ease-out' })
  ]);
  pawn.style.zIndex = '';
}

/* เลื่อนยาว (บันได / งู / ข้ามหลายช่อง) */
async function fxSlide(api, player, from, to, kind = 'plain') {
  const pawn = api.pawns[player];
  const a = api.spot(player, from);
  const b = api.spot(player, to);
  const body = pawn.firstElementChild;
  const duration = kind === 'plain' ? 600 : 1000;
  pawn.style.zIndex = '6';
  pawn.style.transform = fxPawnTransform(b);
  const bodyFrames = kind === 'ladder'
    ? [{ transform: 'scale(1)' }, { transform: 'scale(1.35)', offset: 0.2 }, { transform: 'scale(1.35)', offset: 0.8 }, { transform: 'scale(1)' }]
    : kind === 'snake'
      ? [{ transform: 'rotate(0) scale(1)' }, { transform: 'rotate(-25deg) scale(1.1)', offset: 0.15 }, { transform: 'rotate(25deg) scale(.9)', offset: 0.35 },
        { transform: 'rotate(-25deg) scale(.9)', offset: 0.55 }, { transform: 'rotate(15deg) scale(.95)', offset: 0.8 }, { transform: 'rotate(0) scale(1)' }]
      : [{ transform: 'translateY(0)' }, { transform: `translateY(${-a.size}px)`, offset: 0.5 }, { transform: 'translateY(0)' }];
  await Promise.all([
    fxAnimate(pawn, [{ transform: fxPawnTransform(a) }, { transform: fxPawnTransform(b) }],
      { duration, easing: kind === 'snake' ? 'cubic-bezier(.5,0,.8,.6)' : 'cubic-bezier(.45,.05,.35,1)' }),
    fxAnimate(body, bodyFrames, { duration, easing: 'ease-in-out' })
  ]);
  pawn.style.zIndex = '';
}

/* สั่นเบา ๆ เมื่อเดินไม่ได้ (ทอยเกิน 100) */
function fxShake(api, player) {
  return fxAnimate(api.pawns[player].firstElementChild, [
    { transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' },
    { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }
  ], { duration: 320 });
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

async function setupGamesPage() {
  if (!requireAuth()) return;

  const joinMessage = document.getElementById('joinGameMessage') || document.getElementById('appGameMessage');
  let identity;
  try {
    identity = await getFlowlockIdentity();
  } catch (error) {
    showGameMessage(joinMessage, error.message || 'กรุณาเข้าสู่ระบบใหม่');
    return;
  }
  const currentUser = document.getElementById('currentUser');
  if (currentUser) currentUser.textContent = identity.name;
  if (document.body.dataset.page === 'games') {
    attachLogoutButton(document.getElementById('logoutBtn'), 'login.html');
  }
  const dialog = document.getElementById('gameModeDialog');
  const gameName = document.getElementById('selectedGameName');
  const joinForm = document.getElementById('joinGameForm');
  const invitesContainer = document.getElementById('gameInvites');
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
    createGameRoom(selectedGame, 'normal', joinMessage, identity);
  });

  document.getElementById('textModeButton')?.addEventListener('click', () => {
    createGameRoom(selectedGame, 'text', joinMessage, identity);
  });

  if (joinForm) joinForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = document.getElementById('joinGameCode').value.trim();
    await joinGameRoom(code, identity, joinMessage);
  });

  if (window.location.hash === '#join') document.getElementById('joinGameCode')?.focus();
  if (invitesContainer) {
    const refreshInvites = () => renderGameInvites(invitesContainer, identity);
    refreshInvites();
    window.setInterval(refreshInvites, 3000);
  }
}

async function joinGameRoom(code, identity, message) {
  try {
    const row = await getFlowlockSharedRoom(getSharedGameRoomId(code));
    const room = row?.payload;
    if (!room) {
      showGameMessage(message, 'ไม่พบห้องนี้ หรือคุณไม่ได้รับอนุญาตให้เข้าห้อง');
      return;
    }
    if ((room.memberIds || []).includes(identity.id)) {
      window.location.href = gameRoomUrl(room);
      return;
    }
    if (room.members.length >= room.capacity || room.status === 'finished') {
      showGameMessage(message, 'ห้องนี้เต็มหรือจบเกมแล้ว');
      return;
    }
    if (room.invitedIds.length && !room.invitedIds.includes(identity.id)) {
      showGameMessage(message, 'ห้องนี้รับเฉพาะผู้เล่นที่ได้รับเชิญ');
      return;
    }
    room.members.push(identity.name);
    room.memberIds.push(identity.id);
    room.invited = room.invited.filter((name) => name !== identity.name);
    room.invitedIds = room.invitedIds.filter((id) => id !== identity.id);
    await updateFlowlockSharedRoom(row.id, getGameParticipantIds(room), room, row.updated_at);
    window.location.href = gameRoomUrl(room);
  } catch (error) {
    showGameMessage(message, error.message || 'เข้าห้องไม่สำเร็จ');
  }
}

async function renderGameInvites(container, identity) {
  if (!container) return;

  try {
    const rows = await listFlowlockSharedRooms('game', identity);
    const invites = rows.filter((row) =>
      row.payload.status === 'lobby'
      && (row.payload.invitedIds || []).includes(identity.id)
      && !(row.payload.memberIds || []).includes(identity.id)
    );
    if (!invites.length) {
      container.innerHTML = '<p class="empty-friend">ยังไม่มีคำเชิญเล่นเกม</p>';
      return;
    }

    container.innerHTML = invites.map((row) => `
      <article class="trade-request">
        <div><strong>${escapeHtml(GAME_DEFINITIONS[row.payload.game]?.name || 'เกม')} · ${escapeHtml(row.payload.host)}</strong>
          <span>รอคุณเข้าร่วมห้อง</span></div>
        <div class="game-invite-actions">
          <button class="mini-btn accept-game-invite" type="button" data-room-code="${escapeHtml(row.payload.code)}">เข้าร่วมทีม</button>
          <button class="mini-btn decline-game-invite" type="button" data-room-code="${escapeHtml(row.payload.code)}">ปฏิเสธ</button>
        </div>
      </article>
    `).join('');
    container.querySelectorAll('.accept-game-invite').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        await joinGameRoom(button.dataset.roomCode, identity, container);
        button.disabled = false;
      });
    });
    container.querySelectorAll('.decline-game-invite').forEach((button) => {
      button.addEventListener('click', async () => {
        const card = button.closest('.trade-request');
        const actionButtons = card.querySelectorAll('button');
        actionButtons.forEach((action) => { action.disabled = true; });
        try {
          await declineFlowlockGameInvite(button.dataset.roomCode);
          await renderGameInvites(container, identity);
        } catch (error) {
          const errorMessage = document.createElement('p');
          errorMessage.className = 'msg';
          errorMessage.textContent = error.message || 'ปฏิเสธคำเชิญไม่สำเร็จ';
          card.append(errorMessage);
          actionButtons.forEach((action) => { action.disabled = false; });
        }
      });
    });
  } catch (error) {
    container.innerHTML = `<p class="msg">${escapeHtml(error.message || 'โหลดคำเชิญเกมไม่สำเร็จ')}</p>`;
  }
}

async function createGameRoom(game, mode, message, identity) {
  const definition = GAME_DEFINITIONS[game];
  if (!definition) return;
  const room = {
    code: String(Math.floor(100000 + Math.random() * 900000)),
    game,
    mode,
    host: identity.name,
    hostId: identity.id,
    capacity: definition.capacity,
    members: [identity.name],
    memberIds: [identity.id],
    botIds: [],
    invited: [],
    invitedIds: [],
    visibility: mode === 'normal' ? 'public' : 'invited',
    status: 'lobby',
    state: null,
    createdAt: Date.now()
  };
  try {
    await createFlowlockSharedRoom({
      id: getSharedGameRoomId(room.code),
      kind: 'game',
      ownerId: identity.id,
      participantIds: [identity.id],
      payload: room
    });
    window.location.href = gameRoomUrl(room);
  } catch (error) {
    showGameMessage(message, error.message || 'สร้างห้องไม่สำเร็จ');
  }
}

async function setupGameRoomPage() {
  if (!requireAuth()) return;

  const code = new URLSearchParams(window.location.search).get('room');
  const roomCode = document.getElementById('gameRoomCode');
  const title = document.getElementById('gameRoomTitle');
  const status = document.getElementById('gameRoomStatus');
  const people = document.getElementById('gameRoomPeople');
  const inviteSelect = document.getElementById('gameInviteFriend');
  const inviteForm = document.getElementById('gameInviteForm');
  const addBotButton = document.getElementById('addGameBotButton');
  const startButton = document.getElementById('startGameButton');
  const lobby = document.getElementById('gameLobby');
  const boardWrap = document.getElementById('gameBoardWrap');
  const textChallengePanel = document.getElementById('textChallengePanel');
  const textChallengeForm = document.getElementById('textChallengeForm');
  const textChallengeInput = document.getElementById('textChallengeInput');
  const textChallengeStatus = document.getElementById('textChallengeStatus');
  const winnerMessages = document.getElementById('winnerMessages');
  const message = document.getElementById('gameRoomMessage');
  const currentUserEl = document.getElementById('currentUser');
  attachLogoutButton(document.getElementById('logoutBtn'), 'login.html');
  let selectedPiece = null;
  let identity;
  let friends;
  let room;
  let updatedAt;
  let botTurnScheduled = false;
  let botTurnRunning = false;
  let textStatus = { submitted_count: 0, own_entry: '', revealed_entries: [] };

  if (!code) {
    title.textContent = 'ไม่พบรหัสห้อง';
    return;
  }

  try {
    identity = await getFlowlockIdentity();
    friends = await getFriendsForCurrentUser();
    if (currentUserEl) currentUserEl.textContent = identity.name;
  } catch (error) {
    status.textContent = error.message || 'ไม่สามารถโหลดข้อมูลบัญชีได้';
    return;
  }

  const draw = () => {
    if (!room || !(room.memberIds || []).includes(identity.id)) {
      title.textContent = 'เข้าห้องไม่ได้';
      status.textContent = 'ไม่พบห้อง หรือคุณยังไม่ได้เข้าร่วม';
      lobby.hidden = true;
      boardWrap.hidden = true;
      return;
    }
    title.textContent = GAME_DEFINITIONS[room.game].name;
    roomCode.textContent = room.code;
    document.getElementById('gameRoomShare').value = `${location.origin}${location.pathname.replace(/game-room\.html$/, 'games.html')}`;
    people.innerHTML = room.members.map((name, index) => `<span class="room-person${room.status === 'playing' && room.state && room.state.turn === index ? ' is-turn' : ''}"><i class="p-dot" style="--pc:${FX_COLORS[index % 4]}"></i>${escapeHtml(name)}${name === room.host ? ' · เจ้าของห้อง' : ''}${room.state && room.state.turn === index ? (name === identity.name ? ' · ตาของคุณ' : ' · ถึงตาเดิน') : ''}</span>`).join('');
    fillInviteSelect(inviteSelect, room, friends);
    lobby.hidden = room.status !== 'lobby';
    boardWrap.hidden = room.status !== 'playing' && room.status !== 'finished';
    const textEntryCount = textStatus.submitted_count;
    const canStart = room.members.length >= 2 && (room.mode !== 'text' || textEntryCount >= room.members.length);
    startButton.hidden = room.hostId !== identity.id || room.status !== 'lobby' || !canStart;
    addBotButton.hidden = room.hostId !== identity.id || room.status !== 'lobby'
      || room.mode !== 'normal' || room.members.length + (room.invitedIds || []).length >= room.capacity;
    textChallengePanel.hidden = room.mode !== 'text' || room.status !== 'lobby';
    textChallengeStatus.textContent = `ส่งข้อความแล้ว ${textEntryCount}/${room.members.length} คน`;
    if (document.activeElement !== textChallengeInput) textChallengeInput.value = textStatus.own_entry || '';
    status.textContent = room.status === 'lobby'
      ? `รอผู้เล่น · ${room.members.length}/${room.capacity} คน${room.mode === 'text' ? ` · ส่งข้อความ ${textEntryCount}/${room.members.length}` : ''}`
      : room.status === 'finished' ? `จบเกม · ผู้ชนะ ${room.members[room.state.turn] || room.members[room.state.winner] || room.state.winner}`
        : `เกมกำลังดำเนินอยู่ · ตาของ ${room.members[room.state?.turn] || 'ผู้เล่น'}`;
    renderWinnerMessages(winnerMessages, room, identity.name, textStatus.revealed_entries);
    if (boardWrap.hidden) return;
    if (!room.state) room.state = makeInitialState(room.game, room.members);
    renderGame(room, boardWrap, identity.name, persist, draw, () => selectedPiece, (value) => { selectedPiece = value; });
    scheduleBotTurn();
  };

  const refresh = async (force = false) => {
    try {
      const row = await getFlowlockSharedRoom(getSharedGameRoomId(code));
      if (!row) {
        room = null;
        draw();
        return;
      }
      let changed = false;
      if (force || row.updated_at !== updatedAt) {
        room = row.payload;
        updatedAt = row.updated_at;
        changed = true;
      }
      if (room?.mode === 'text' && room.memberIds.includes(identity.id)) {
        const nextTextStatus = await loadFlowlockGameTextStatus(code);
        if (JSON.stringify(nextTextStatus) !== JSON.stringify(textStatus)) {
          textStatus = nextTextStatus;
          changed = true;
        }
      }
      if (changed) {
        draw();
      }
    } catch (error) {
      status.textContent = error.message || 'โหลดข้อมูลห้องไม่สำเร็จ';
    }
  };
  const persist = async (updatedRoom) => {
    const row = await updateFlowlockSharedRoom(
      getSharedGameRoomId(updatedRoom.code),
      getGameParticipantIds(updatedRoom),
      updatedRoom,
      updatedAt
    );
    room = row.payload;
    updatedAt = row.updated_at;
  };
  const scheduleBotTurn = () => {
    if (botTurnScheduled || botTurnRunning || !room || room.status !== 'playing'
        || identity.id !== room.hostId || !room.state
        || !(room.botIds || []).includes(room.memberIds[room.state.turn])) return;

    botTurnScheduled = true;
    window.setTimeout(async () => {
      await fxWaitForIdle(boardWrap);
      await fxWait(450);
      botTurnScheduled = false;
      if (botTurnRunning || !room || room.status !== 'playing'
          || !(room.botIds || []).includes(room.memberIds[room.state.turn])) return;
      botTurnRunning = true;
      const nextRoom = JSON.parse(JSON.stringify(room));
      const previousUpdatedAt = updatedAt;
      let shouldContinueBots = false;
      try {
        if (!applyBotTurn(nextRoom)) throw new Error('AI ไม่สามารถเดินในสถานะเกมนี้ได้');
        await persist(nextRoom);
        shouldContinueBots = true;
        draw();
      } catch (error) {
        showGameMessage(message, error.message || 'AI เดินไม่สำเร็จ');
        await refresh(true);
        shouldContinueBots = updatedAt !== previousUpdatedAt
          && room?.status === 'playing'
          && (room.botIds || []).includes(room.memberIds[room.state.turn]);
      } finally {
        botTurnRunning = false;
      }
      if (shouldContinueBots) scheduleBotTurn();
    }, 650);
  };

  document.getElementById('copyGameCode').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(roomCode.textContent);
      showGameMessage(message, 'คัดลอกรหัสห้องแล้ว', false);
    } catch (error) {
      showGameMessage(message, 'คัดลอกรหัสไม่สำเร็จ');
    }
  });

  inviteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const friend = friends.find((item) => item.id === inviteSelect.value);
      if (!room || room.hostId !== identity.id || !friend) return;
      if (room.members.length + (room.invitedIds || []).length >= room.capacity) {
        showGameMessage(message, 'ห้องเต็มแล้ว');
        return;
      }
      if (!room.invitedIds.includes(friend.id) && !room.memberIds.includes(friend.id)) {
        room.invited.push(friend.name);
        room.invitedIds.push(friend.id);
        room.visibility = 'invited';
      }
      await persist(room);
      showGameMessage(message, `ส่งคำเชิญถึง ${friend.name} แล้ว`, false);
      draw();
    } catch (error) {
      showGameMessage(message, error.message || 'ส่งคำเชิญไม่สำเร็จ');
    }
  });

  addBotButton.addEventListener('click', async () => {
    if (!room || room.hostId !== identity.id || room.status !== 'lobby'
        || room.mode !== 'normal' || room.members.length + (room.invitedIds || []).length >= room.capacity) return;

    const botId = `bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    room.botIds = room.botIds || [];
    room.botIds.push(botId);
    room.memberIds.push(botId);
    room.members.push(`AI ${room.botIds.length}`);
    try {
      await persist(room);
      showGameMessage(message, 'เพิ่ม AI เข้าทีมแล้ว', false);
      draw();
    } catch (error) {
      showGameMessage(message, error.message || 'เพิ่ม AI ไม่สำเร็จ');
    }
  });

  textChallengeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = textChallengeInput.value.trim();
    if (!room || room.status !== 'lobby' || room.mode !== 'text' || !room.memberIds.includes(identity.id)) return;
    if (!text) {
      showGameMessage(message, 'กรุณาพิมพ์ข้อความก่อนส่ง');
      return;
    }
    if (/https?:\/\/|www\./i.test(text)) {
      showGameMessage(message, 'โหมดนี้รับเฉพาะข้อความ ไม่รับ URL หรือลิงก์');
      return;
    }
    try {
      await saveFlowlockGameText(code, text);
      textStatus = await loadFlowlockGameTextStatus(code);
      showGameMessage(message, 'ส่งข้อความแล้ว รอผู้เล่นทุกคนส่งให้ครบก่อนเริ่มเกม', false);
      draw();
    } catch (error) {
      showGameMessage(message, error.message || 'บันทึกข้อความไม่สำเร็จ');
    }
  });

  startButton.addEventListener('click', async () => {
    if (!room || room.hostId !== identity.id || room.members.length < 2
        || (room.mode === 'text' && textStatus.submitted_count < room.members.length)) return;
    room.state = makeInitialState(room.game, room.members);
    room.status = 'playing';
    try {
      await persist(room);
      draw();
    } catch (error) {
      showGameMessage(message, error.message || 'เริ่มเกมไม่สำเร็จ');
    }
  });

  await refresh(true);
  window.setInterval(() => refresh(), 1500);
  window.setInterval(async () => {
    try {
      friends = await getFriendsForCurrentUser();
      if (room && room.status === 'lobby' && room.hostId === identity.id) {
        fillInviteSelect(inviteSelect, room, friends);
      }
    } catch (error) {
      showGameMessage(message, error.message || 'โหลดรายชื่อเพื่อนไม่สำเร็จ');
    }
  }, 5000);
}

function renderWinnerMessages(container, room, currentUser, revealedEntries) {
  if (!container) return;
  const winnerIndex = room.state?.winner;
  const winner = Number.isInteger(winnerIndex) ? room.members[winnerIndex] : null;
  if (room.status !== 'finished' || room.mode !== 'text' || winner !== currentUser) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }
  const entries = revealedEntries || [];
  container.hidden = false;
  container.innerHTML = `<p class="eyebrow">WINNER REWARD</p><h2>คุณชนะ รับข้อความจากผู้เล่น</h2>${entries.map((entry) => `<article class="winner-message"><strong>${escapeHtml(entry.name)}</strong><p>${escapeHtml(entry.text)}</p></article>`).join('')}`;
}

function fillInviteSelect(select, room, friends) {
  const eligibleFriends = friends.filter((friend) =>
    !room.memberIds.includes(friend.id) && !room.invitedIds.includes(friend.id)
  );
  select.innerHTML = eligibleFriends.length
    ? eligibleFriends.map((friend) => `<option value="${escapeHtml(friend.id)}">${escapeHtml(friend.name)}</option>`).join('')
    : '<option value="">ไม่มีเพื่อนให้เชิญ</option>';
  document.getElementById('sendGameInvite').disabled = !eligibleFriends.length
    || room.members.length + (room.invitedIds || []).length >= room.capacity;
}

function renderGame(room, container, currentUser, persist, draw, getSelected, setSelected) {
  if (container._busy) {
    container._deferDraw = draw;
    return;
  }
  if (room.game === 'snakes') renderSnakes(room, container, currentUser, persist, draw);
  if (room.game === 'checkers') renderCheckers(room, container, currentUser, persist, draw, getSelected, setSelected);
  if (room.game === 'property') renderProperty(room, container, currentUser, persist, draw);
}

async function persistGameAndDraw(room, persist, draw) {
  try {
    await persist(room);
    draw();
  } catch (error) {
    showGameMessage(document.getElementById('gameRoomMessage'), error.message || 'บันทึกสถานะเกมไม่สำเร็จ');
  }
}

const SNAKE_LADDERS = { 4: 14, 9: 31, 20: 38, 28: 84, 40: 59, 51: 67, 63: 81, 71: 91 };
const SNAKE_SNAKES = { 17: 7, 54: 34, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 99: 78 };

function snakeAnchor(board, n) {
  const first = board.querySelector('.board-cell[data-n="1"]');
  if (n >= 1) return board.querySelector(`.board-cell[data-n="${n}"]`);
  return {
    offsetLeft: first.offsetLeft,
    offsetTop: first.offsetTop + first.offsetHeight * 0.95,
    offsetWidth: first.offsetWidth,
    offsetHeight: first.offsetHeight * 0.6
  };
}

function drawSnakesDeco(board, layer, animateIn) {
  const old = layer.querySelector('.board-deco');
  if (old) old.remove();
  const width = board.offsetWidth;
  const height = board.offsetHeight;
  const cell = board.querySelector('.board-cell');
  const cellWidth = cell ? cell.offsetWidth : 40;
  const center = (n) => {
    const anchor = snakeAnchor(board, n);
    return { x: anchor.offsetLeft + anchor.offsetWidth / 2, y: anchor.offsetTop + anchor.offsetHeight / 2 };
  };
  const stroke = Math.max(4, cellWidth * 0.12);
  let svg = '';

  Object.entries(SNAKE_LADDERS).forEach(([from, to]) => {
    const a = center(Number(from));
    const b = center(Number(to));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * stroke * 0.9;
    const ny = (dx / length) * stroke * 0.9;
    svg += `<line class="rail" pathLength="1" x1="${a.x + nx}" y1="${a.y + ny}" x2="${b.x + nx}" y2="${b.y + ny}"/>`
      + `<line class="rail" pathLength="1" x1="${a.x - nx}" y1="${a.y - ny}" x2="${b.x - nx}" y2="${b.y - ny}"/>`;
    const rungs = Math.max(2, Math.floor(length / (cellWidth * 0.42)));
    for (let i = 1; i < rungs; i += 1) {
      const t = i / rungs;
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      svg += `<line class="rung" x1="${px + nx}" y1="${py + ny}" x2="${px - nx}" y2="${py - ny}"/>`;
    }
  });

  Object.entries(SNAKE_SNAKES).forEach(([from, to]) => {
    const head = center(Number(from));
    const tail = center(Number(to));
    const dx = tail.x - head.x;
    const dy = tail.y - head.y;
    const length = Math.hypot(dx, dy) || 1;
    const amp = length * 0.16;
    const px = (-dy / length) * amp;
    const py = (dx / length) * amp;
    const c1 = { x: head.x + dx * 0.33 + px, y: head.y + dy * 0.33 + py };
    const c2 = { x: head.x + dx * 0.66 - px, y: head.y + dy * 0.66 - py };
    const d = `M ${head.x} ${head.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${tail.x} ${tail.y}`;
    svg += `<path class="snake-body" pathLength="1" d="${d}" stroke-width="${stroke * 1.2}"/>`
      + `<path class="snake-scales" d="${d}" stroke-width="${Math.max(1.5, stroke * 0.3)}"/>`
      + `<circle class="snake-head" cx="${head.x}" cy="${head.y}" r="${stroke * 1.1}"/>`
      + `<circle class="snake-eye" cx="${head.x - stroke * 0.4}" cy="${head.y - stroke * 0.3}" r="${stroke * 0.22}"/>`
      + `<circle class="snake-eye" cx="${head.x + stroke * 0.4}" cy="${head.y - stroke * 0.3}" r="${stroke * 0.22}"/>`;
  });

  layer.insertAdjacentHTML('afterbegin',
    `<svg class="board-deco${animateIn ? ' draw-in' : ''}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">${svg}</svg>`);
}

function renderSnakes(room, container, currentUser, persist, draw) {
  const state = room.state;
  const active = state.winner === null && room.members[state.turn] === currentUser;
  const mem = gameMemory[room.code] || (gameMemory[room.code] = {});
  const prev = mem.positions && mem.positions.length === state.positions.length ? mem.positions.slice() : null;
  const changes = prev ? state.positions.map((p, i) => (p !== prev[i] ? i : -1)).filter((i) => i >= 0) : [];
  const animating = !FX_REDUCED && changes.length > 0;
  const needDice = !mem.skipDice;
  const showDiceRoll = animating && changes.length === 1 && needDice && !!state.die;
  const firstTime = !mem.entered;
  mem.skipDice = false;
  mem.entered = true;
  const dieShown = showDiceRoll ? (mem.die || 5) : (state.die || 5);
  mem.positions = state.positions.slice();
  mem.die = state.die;

  const cells = [];
  for (let row = 0; row < 10; row += 1) {
    const boardRow = 9 - row;
    const start = boardRow * 10 + 1;
    for (let col = 0; col < 10; col += 1) {
      const number = boardRow % 2 === 0 ? start + col : start + 9 - col;
      cells.push(`<div class="board-cell" data-n="${number}" style="--d:${(row + col) * 28}ms"><small>${number}</small></div>`);
    }
  }
  container.innerHTML = `<h2>บันไดงู · ช่อง ${state.positions.map((position, index) => `<span class="p-dot" style="--pc:${FX_COLORS[index]}"></span>${escapeHtml(room.members[index])}: ${position}`).join(' · ')}</h2>
    <div class="game-board snakes-board${firstTime ? ' enter' : ''}">${cells.join('')}</div>
    <div class="game-controls"><span class="die-host">${diceMarkup(dieShown, '52px')}</span><button id="rollGameDice" class="btn${active ? ' your-turn' : ''}" type="button" ${active ? '' : 'disabled'}>ทอยลูกเต๋า</button><span>${state.winner === null ? `ตาของ ${escapeHtml(room.members[state.turn])}` : `ผู้ชนะ: ${escapeHtml(room.members[state.winner])}`}</span></div>`;

  const board = container.querySelector('.snakes-board');
  const host = container.querySelector('.die-host');
  const api = makePawnLayer(board, room.members.length, (n) => snakeAnchor(board, n));
  const layoutNow = () => {
    drawSnakesDeco(board, api.layer, false);
    state.positions.forEach((position, player) => api.place(player, position));
    api.markTurn(state.turn, state.winner === null);
  };
  drawSnakesDeco(board, api.layer, firstTime);
  state.positions.forEach((position, player) => api.place(player, animating && changes.includes(player) ? prev[player] : position));
  api.markTurn(state.turn, state.winner === null && !animating);
  container._relayout = () => { if (!container._busy) layoutNow(); };

  const run = async () => {
    try {
      if (showDiceRoll) await rollDie(host, state.die, 850);
      await fxWait(150);
      for (const player of changes) {
        const from = prev[player];
        const to = state.positions[player];
        const die = changes.length === 1 ? state.die : null;
        const landed = die && from + die <= 100 ? from + die : from;
        const explained = die && (to === landed || SNAKE_LADDERS[landed] === to || SNAKE_SNAKES[landed] === to);
        if (explained) {
          if (landed === from) await fxShake(api, player);
          for (let n = from + 1; n <= landed; n += 1) await fxHop(api, player, n - 1, n);
          const landCenter = api.center(landed);
          fxRipple(api.layer, landCenter.x, landCenter.y, FX_COLORS[player]);
          if (to !== landed) {
            const kind = SNAKE_LADDERS[landed] === to ? 'ladder' : 'snake';
            fxFloatText(api.layer, landCenter.x, landCenter.y, kind === 'ladder' ? '🪜 ปีนบันได!' : '🐍 โดนงูกัด!', kind === 'ladder' ? '#3ddc97' : '#ff5a76');
            await fxWait(280);
            await fxSlide(api, player, landed, to, kind);
            const endCenter = api.center(to);
            fxRipple(api.layer, endCenter.x, endCenter.y, kind === 'ladder' ? '#3ddc97' : '#ff5a76');
          }
        } else {
          await fxSlide(api, player, from, to, 'plain');
        }
      }
      if (state.winner !== null) {
        const winCenter = api.center(state.positions[state.winner]);
        fxSparks(api.layer, winCenter.x, winCenter.y, '#ffd24a');
      }
    } finally {
      layoutNow();
      fxCelebrate(container, state, mem, true);
    }
  };

  if (animating) fxSetBusy(container, run());
  else fxCelebrate(container, state, mem, !!prev);

  document.getElementById('rollGameDice').addEventListener('click', () => {
    if (!active || container._busy) return;
    document.getElementById('rollGameDice').disabled = true;
    const die = Math.floor(Math.random() * 6) + 1;
    runLocalMove(container, room, persist, draw, async () => {
      mem.skipDice = true;
      await rollDie(host, die, 1150);
      let position = state.positions[state.turn];
      if (position + die <= 100) position += die;
      position = SNAKE_LADDERS[position] || SNAKE_SNAKES[position] || position;
      state.positions[state.turn] = position;
      state.die = die;
      if (position === 100) {
        state.winner = state.turn;
        room.status = 'finished';
      } else state.turn = (state.turn + 1) % room.members.length;
    });
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

function detectCheckersMove(before, after) {
  const appeared = [];
  const vanished = [];
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const a = before[r][c];
      const b = after[r][c];
      if (!a && b) appeared.push({ r, c, b });
      else if (a && !b) vanished.push({ r, c, a });
    }
  }
  if (appeared.length !== 1) return null;
  const dest = appeared[0];
  const side = dest.b.toLowerCase();
  const src = vanished.find((v) => v.a.toLowerCase() === side
    && Math.abs(v.r - dest.r) === Math.abs(v.c - dest.c) && [1, 2].includes(Math.abs(v.r - dest.r)));
  if (!src) return null;
  const cap = vanished.find((v) => v !== src && v.a.toLowerCase() !== side) || null;
  return { src, dest, cap, promoted: src.a !== dest.b };
}

function renderCheckers(room, container, currentUser, persist, draw, getSelected, setSelected) {
  const state = room.state;
  const side = room.members.indexOf(currentUser) === 0 ? 'a' : 'b';
  const active = state.winner === null && room.members[state.turn] === currentUser;
  const mem = gameMemory[room.code] || (gameMemory[room.code] = {});
  const prevBoard = mem.board || null;
  const firstTime = !mem.entered;
  mem.entered = true;
  mem.board = state.board.map((row) => row.slice());
  const move = prevBoard && !FX_REDUCED ? detectCheckersMove(prevBoard, state.board) : null;
  const selected = getSelected();
  const hints = new Map();
  if (selected && active) {
    checkerMoves(state.board, selected.row, selected.col).forEach((item) => hints.set(`${item.row},${item.col}`, !!item.capture));
  }

  const cells = [];
  state.board.forEach((row, rowIndex) => row.forEach((piece, colIndex) => {
    const isSelected = selected && selected.row === rowIndex && selected.col === colIndex;
    const ghost = move && move.dest.r === rowIndex && move.dest.c === colIndex;
    const hint = hints.has(`${rowIndex},${colIndex}`) ? (hints.get(`${rowIndex},${colIndex}`) ? ' hint capture' : ' hint') : '';
    const body = piece
      ? `<span class="chk-piece ${piece.toLowerCase()}${piece === piece.toUpperCase() ? ' king' : ''}${ghost ? ' ghost' : ''}"></span>` : '';
    cells.push(`<button class="checkers-cell ${(rowIndex + colIndex) % 2 ? 'dark' : 'light'} ${isSelected ? 'selected' : ''}${hint}" style="--d:${(rowIndex + colIndex) * 45}ms" data-row="${rowIndex}" data-col="${colIndex}" type="button" ${active ? '' : 'disabled'}>${body}</button>`);
  }));
  container.innerHTML = `<h2>หมากฮอส · ตาของ ${escapeHtml(room.members[state.turn])}</h2><div class="game-board checkers-board${firstTime ? ' enter' : ''}${active ? ' my-turn' : ''}">${cells.join('')}</div>${state.winner !== null ? `<p class="trade-note">ผู้ชนะ: ${escapeHtml(room.members[state.winner])}</p>` : '<p class="trade-intro">เลือกหมากของคุณ แล้วเลือกช่องทแยงที่เดินได้ · กินหมากด้วยการกระโดดข้าม</p>'}`;

  const board = container.querySelector('.checkers-board');
  const cellAt = (r, c) => board.querySelector(`.checkers-cell[data-row="${r}"][data-col="${c}"]`);

  if (move) {
    const layer = document.createElement('div');
    layer.className = 'pawn-layer';
    board.appendChild(layer);
    const srcCell = cellAt(move.src.r, move.src.c);
    const destCell = cellAt(move.dest.r, move.dest.c);
    layer.style.fontSize = getComputedStyle(destCell).fontSize;
    const size = destCell.offsetWidth * 0.78;
    const spotOf = (cell) => ({ x: cell.offsetLeft + (cell.offsetWidth - size) / 2, y: cell.offsetTop + (cell.offsetHeight - size) / 2 });
    const makePiece = (letter, spot) => {
      const el = document.createElement('span');
      el.className = `chk-piece ${letter.toLowerCase()}${letter === letter.toUpperCase() ? ' king' : ''}`;
      el.style.cssText = `position:absolute;left:0;top:0;width:${size}px;height:${size}px;transform:translate(${spot.x}px,${spot.y}px)`;
      layer.appendChild(el);
      return el;
    };
    const run = async () => {
      try {
        const from = spotOf(srcCell);
        const to = spotOf(destCell);
        const flyer = makePiece(move.src.a, from);
        const duration = move.cap ? 640 : 480;
        const lift = size * (move.cap ? 0.9 : 0.55);
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - lift };
        const capture = async () => {
          if (!move.cap) return;
          await fxWait(duration * 0.5);
          const capCell = cellAt(move.cap.r, move.cap.c);
          const ghostPiece = makePiece(move.cap.a, spotOf(capCell));
          const cx = capCell.offsetLeft + capCell.offsetWidth / 2;
          const cy = capCell.offsetTop + capCell.offsetHeight / 2;
          fxSparks(layer, cx, cy, move.cap.a.toLowerCase() === 'a' ? '#ff5a76' : '#f2ecff');
          await fxAnimate(ghostPiece, [
            { transform: `translate(${spotOf(capCell).x}px,${spotOf(capCell).y}px) scale(1) rotate(0)`, opacity: 1 },
            { transform: `translate(${spotOf(capCell).x}px,${spotOf(capCell).y - size * 0.5}px) scale(0) rotate(200deg)`, opacity: 0 }
          ], { duration: 420, easing: 'ease-in' });
          ghostPiece.remove();
        };
        await Promise.all([
          fxAnimate(flyer, [
            { transform: `translate(${from.x}px,${from.y}px) scale(1)`, offset: 0 },
            { transform: `translate(${mid.x}px,${mid.y}px) scale(1.28)`, offset: 0.5 },
            { transform: `translate(${to.x}px,${to.y}px) scale(1)`, offset: 1 }
          ], { duration, easing: 'cubic-bezier(.4,0,.3,1)' }),
          capture()
        ]);
        flyer.remove();
        const landed = destCell.querySelector('.chk-piece');
        if (landed) {
          landed.classList.remove('ghost');
          landed.classList.add('settle');
          if (move.promoted) landed.classList.add('crowned');
        }
        const dx = destCell.offsetLeft + destCell.offsetWidth / 2;
        const dy = destCell.offsetTop + destCell.offsetHeight / 2;
        fxRipple(layer, dx, dy, move.promoted ? '#ffd24a' : '#f4d35e');
        if (move.promoted) {
          fxSparks(layer, dx, dy, '#ffd24a');
          fxFloatText(layer, dx, dy, '👑 เลื่อนขั้น!', '#ffd24a');
          await fxWait(500);
        } else await fxWait(160);
      } finally {
        container.querySelectorAll('.chk-piece.ghost').forEach((el) => el.classList.remove('ghost'));
        layer.remove();
        fxCelebrate(container, state, mem, true);
      }
    };
    fxSetBusy(container, run());
  } else {
    fxCelebrate(container, state, mem, !!prevBoard);
  }

  container.querySelectorAll('.checkers-cell').forEach((button) => button.addEventListener('click', () => {
    if (container._busy || !active || room.members[state.turn] !== currentUser) return;
    const row = Number(button.dataset.row);
    const col = Number(button.dataset.col);
    const picked = getSelected();
    if (picked) {
      const target = checkerMoves(state.board, picked.row, picked.col).find((item) => item.row === row && item.col === col);
      if (target) {
        let piece = state.board[picked.row][picked.col];
        state.board[picked.row][picked.col] = null;
        if (target.capture) state.board[target.capture.row][target.capture.col] = null;
        if ((piece === 'a' && row === 0) || (piece === 'b' && row === 7)) piece = piece.toUpperCase();
        state.board[row][col] = piece;
        const other = side === 'a' ? 'b' : 'a';
        if (!state.board.flat().some((item) => item && item.toLowerCase() === other)) {
          state.winner = room.members.indexOf(currentUser);
          room.status = 'finished';
        } else state.turn = (state.turn + 1) % 2;
        setSelected(null);
        persistGameAndDraw(room, persist, draw);
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

function renderProperty(room, container, currentUser, persist, draw) {
  const state = room.state;
  const active = state.winner === null && room.members[state.turn] === currentUser;
  const mem = gameMemory[room.code] || (gameMemory[room.code] = {});
  const valid = mem.positions && mem.positions.length === state.positions.length;
  const prev = valid ? { positions: mem.positions.slice(), money: mem.money.slice(), owners: mem.owners.slice() } : null;
  const changes = prev ? state.positions.map((p, i) => (p !== prev.positions[i] ? i : -1)).filter((i) => i >= 0) : [];
  const newOwned = prev ? state.owners.map((o, i) => (o !== prev.owners[i] && o !== null ? i : -1)).filter((i) => i >= 0) : [];
  const moneyChanged = prev ? state.money.some((m, i) => m !== prev.money[i]) : false;
  const animating = !FX_REDUCED && (changes.length > 0 || newOwned.length > 0 || moneyChanged);
  const needDice = !mem.skipDice;
  const showDiceRoll = animating && changes.length === 1 && needDice && !!state.die;
  const dieShown = showDiceRoll ? (mem.die || 5) : (state.die || 5);
  mem.skipDice = false;
  mem.positions = state.positions.slice();
  mem.money = state.money.slice();
  mem.owners = state.owners.slice();
  mem.die = state.die;

  const tiles = PROPERTY_TILES.map((tile, index) => {
    const [row, col] = PROPERTY_TRACK[index];
    const owner = state.owners[index];
    const currentPlayerHere = state.positions[state.turn] === index;
    const ownerLabel = owner !== null ? ` · ${escapeHtml(room.members[owner])}` : '';
    const costLabel = tile.cost ? `${tile.cost} เหรียญ${ownerLabel}` : 'ช่องพิเศษ';
    const classes = ['property-tile', currentPlayerHere ? 'current' : '', owner !== null ? 'owned' : '', state.pendingBuy === index ? 'pending' : ''].filter(Boolean).join(' ');
    return `<div class="${classes}" data-i="${index}" data-kind="${tile.kind}" style="grid-row:${row + 1};grid-column:${col + 1};${owner !== null ? `--owner:${FX_COLORS[owner % 4]};` : ''}">
      <span class="property-order">${index === 0 ? 'เริ่ม' : index}</span>
      <span class="property-emoji" aria-hidden="true">${tile.emoji}</span>
      <strong class="property-name">${escapeHtml(tile.name)}</strong>
      <small>${costLabel}</small>
      <span class="property-pawns"></span>
    </div>`;
  }).join('');
  const playerScores = room.members.map((name, index) => `<div class="player-score${state.turn === index ? ' is-turn' : ''}"><span class="p-dot" style="--pc:${FX_COLORS[index]}"></span>${escapeHtml(name)}: ${state.money[index]} เหรียญ${state.turn === index ? ' · ตาคุณ' : ''}</div>`).join('');
  const pending = state.pendingBuy !== null && room.members[state.turn] === currentUser;
  container.innerHTML = `<h2>เกมเศรษฐี · เดินตามเข็มนาฬิกา</h2><div class="game-board property-board">${tiles}
    <div class="property-center"><p class="eyebrow">START · FINISH</p><strong>วงรอบทรัพย์สิน</strong><span class="property-direction" aria-label="เดินตามเข็มนาฬิกา">↻ ตามเข็มนาฬิกา</span>
      <div class="player-scores">${playerScores}</div><span id="propertyDieHost" class="die-host">${diceMarkup(dieShown, 'clamp(30px, 5vw, 46px)')}</span>
      <span id="propertyDieResult" class="property-die-result" aria-live="polite">${state.die ? `ได้ ${state.die} แต้ม` : 'รอทอยลูกเต๋า'}</span>
      <span class="property-turn">ตาของ ${escapeHtml(room.members[state.turn])}</span>
    </div>
  </div>
    <div class="game-controls"><button id="propertyRoll" class="btn${active && !pending ? ' your-turn' : ''}" type="button" ${active && !pending ? '' : 'disabled'}>ทอยลูกเต๋า</button>
    ${pending ? '<button id="propertyBuy" class="mini-btn" type="button">ซื้อที่ดิน</button><button id="propertySkip" class="mini-btn" type="button">ผ่าน</button>' : ''}</div>
    ${state.winner !== null ? `<p class="trade-note">ผู้ชนะ: ${escapeHtml(room.members[state.winner])}</p>` : '<p class="trade-intro">ลงช่องที่ดินเพื่อซื้อ หรือจ่ายค่าเช่าให้เจ้าของ</p>'}`;

  const board = container.querySelector('.property-board');
  const host = document.getElementById('propertyDieHost');
  const api = makePawnLayer(board, room.members.length, (i) => board.querySelector(`.property-tile[data-i="${i}"]`));
  const count = PROPERTY_TILES.length;
  const layoutNow = () => {
    state.positions.forEach((position, player) => api.place(player, position));
    api.markTurn(state.turn, state.winner === null);
  };
  state.positions.forEach((position, player) => api.place(player, animating && changes.includes(player) ? prev.positions[player] : position));
  api.markTurn(state.turn, state.winner === null && !animating);
  container._relayout = () => { if (!container._busy) layoutNow(); };

  const run = async () => {
    try {
      if (showDiceRoll) {
        await rollDie(host, state.die, 850);
        await fxWait(150);
      }
      for (const player of changes) {
        const from = prev.positions[player];
        const to = state.positions[player];
        const die = changes.length === 1 ? state.die : null;
        if (die && (from + die) % count === to) {
          for (let step = 1; step <= die; step += 1) {
            const a = (from + step - 1) % count;
            const b = (from + step) % count;
            await fxHop(api, player, a, b);
            if (b === 0 && step < die) {
              const passCenter = api.center(0);
              fxRipple(api.layer, passCenter.x, passCenter.y, '#ffd24a');
            }
          }
        } else {
          await fxSlide(api, player, from, to, 'plain');
        }
        const center = api.center(to);
        fxRipple(api.layer, center.x, center.y, FX_COLORS[player]);
      }
      newOwned.forEach((index) => {
        const tile = board.querySelector(`.property-tile[data-i="${index}"]`);
        if (!tile) return;
        tile.classList.add('just-bought');
        const center = api.center(index);
        fxSparks(api.layer, center.x, center.y, FX_COLORS[state.owners[index] % 4]);
      });
      state.money.forEach((money, player) => {
        const diff = money - prev.money[player];
        if (!diff) return;
        const center = api.center(state.positions[player]);
        fxFloatText(api.layer, center.x, center.y, `${diff > 0 ? '+' : ''}${diff}`, diff > 0 ? '#3ddc97' : '#ff5a76');
      });
      await fxWait(450);
    } finally {
      layoutNow();
      fxCelebrate(container, state, mem, true);
    }
  };
  if (animating) fxSetBusy(container, run());
  else fxCelebrate(container, state, mem, !!prev);

  document.getElementById('propertyRoll').addEventListener('click', () => {
    if (!active || state.pendingBuy !== null || container._busy) return;
    const rollButton = document.getElementById('propertyRoll');
    const dieResult = document.getElementById('propertyDieResult');
    rollButton.disabled = true;
    dieResult.textContent = 'กำลังทอย…';
    const die = Math.floor(Math.random() * 6) + 1;
    runLocalMove(container, room, persist, draw, async () => {
      mem.skipDice = true;
      await rollDie(host, die, 1150);
      dieResult.textContent = `ได้ ${die} แต้ม`;
      await fxWait(250);
      const player = state.turn;
      const before = state.positions[player];
      const position = (before + die) % PROPERTY_TILES.length;
      if (before + die >= PROPERTY_TILES.length) state.money[player] += 200;
      state.positions[player] = position;
      state.die = die;
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
    });
  });
  if (pending) {
    document.getElementById('propertyBuy').addEventListener('click', () => {
      if (container._busy) return;
      const player = state.turn;
      const property = PROPERTY_TILES[state.pendingBuy];
      if (state.money[player] >= property.cost) {
        state.money[player] -= property.cost;
        state.owners[state.pendingBuy] = player;
      }
      state.pendingBuy = null;
      state.turn = (state.turn + 1) % room.members.length;
      persistGameAndDraw(room, persist, draw);
    });
    document.getElementById('propertySkip').addEventListener('click', () => {
      if (container._busy) return;
      state.pendingBuy = null;
      state.turn = (state.turn + 1) % room.members.length;
      persistGameAndDraw(room, persist, draw);
    });
  }
}

function applyBotTurn(room) {
  const state = room.state;
  const player = state.turn;
  if (!(room.botIds || []).includes(room.memberIds[player])) return false;

  if (room.game === 'snakes') {
    const die = Math.floor(Math.random() * 6) + 1;
    let position = state.positions[player];
    if (position + die <= 100) position += die;
    const ladders = { 4: 14, 9: 31, 20: 38, 28: 84, 40: 59, 51: 67, 63: 81, 71: 91 };
    const snakes = { 17: 7, 54: 34, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 99: 78 };
    state.positions[player] = ladders[position] || snakes[position] || position;
    state.die = die;
    if (state.positions[player] === 100) {
      state.winner = player;
      room.status = 'finished';
    } else {
      state.turn = (player + 1) % room.members.length;
    }
    return true;
  }

  if (room.game === 'checkers') {
    const side = player === 0 ? 'a' : 'b';
    const moves = [];
    state.board.forEach((row, rowIndex) => row.forEach((piece, colIndex) => {
      if (!piece || piece.toLowerCase() !== side) return;
      checkerMoves(state.board, rowIndex, colIndex).forEach((move) => {
        const advances = side === 'a' ? rowIndex - move.row : move.row - rowIndex;
        const promotes = (side === 'a' && move.row === 0) || (side === 'b' && move.row === 7);
        moves.push({
          from: { row: rowIndex, col: colIndex },
          move,
          score: (move.capture ? 10 : 0) + (promotes ? 5 : 0) + advances * 0.2 + Math.random() * 0.1
        });
      });
    }));

    if (!moves.length) {
      state.winner = (player + 1) % room.members.length;
      room.status = 'finished';
      return true;
    }

    moves.sort((left, right) => right.score - left.score);
    const { from, move } = moves[0];
    let piece = state.board[from.row][from.col];
    state.board[from.row][from.col] = null;
    if (move.capture) state.board[move.capture.row][move.capture.col] = null;
    if ((side === 'a' && move.row === 0) || (side === 'b' && move.row === 7)) piece = piece.toUpperCase();
    state.board[move.row][move.col] = piece;
    const otherSide = side === 'a' ? 'b' : 'a';
    if (!state.board.flat().some((item) => item && item.toLowerCase() === otherSide)) {
      state.winner = player;
      room.status = 'finished';
    } else {
      state.turn = (player + 1) % room.members.length;
    }
    return true;
  }

  if (room.game === 'property') {
    const die = Math.floor(Math.random() * 6) + 1;
    const previousPosition = state.positions[player];
    const position = (previousPosition + die) % PROPERTY_TILES.length;
    if (previousPosition + die >= PROPERTY_TILES.length) state.money[player] += 200;
    state.positions[player] = position;
    state.die = die;

    const owner = state.owners[position];
    const property = PROPERTY_TILES[position];
    if (property.cost && owner === null) {
      if (state.money[player] >= property.cost + 100) {
        state.money[player] -= property.cost;
        state.owners[position] = player;
      }
    } else if (property.cost && owner !== player) {
      const rent = Math.ceil(property.cost / 4);
      state.money[player] -= rent;
      state.money[owner] += rent;
      if (state.money[player] < 0) {
        state.money[player] = 0;
        state.winner = owner;
        room.status = 'finished';
      }
    }

    if (room.status !== 'finished') state.turn = (player + 1) % room.members.length;
    return true;
  }

  return false;
}

if (['app', 'games'].includes(document.body?.dataset.page)) setupGamesPage();
if (document.body?.dataset.page === 'game-room') setupGameRoomPage();