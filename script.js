// =====================================================
// OCEAN FIGHT — game logic
// =====================================================

// ===== Константы игры =====
const SIZE = 8;                                   // размер поля 8x8 клеток
const SHIP_SIZES = [3, 2, 2, 1, 1];                // размеры кораблей флота (5 кораблей)

// ===== Состояние игры (хранится в обычных переменных, без localStorage) =====
let playerBoard, enemyBoard;                       // два массива-поля: игрока и врага
let playerShips, enemyShips;                       // списки клеток каждого корабля (для проверки потопления)
let gameOver = false;                               // флаг окончания игры
let playerTurn = true;                               // чей сейчас ход (true = игрок)
let soundOn = true;                                   // включён ли звук

// =====================================================
// ЗВУК — Web Audio API, слоёный синтез вместо одного тона
// =====================================================
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// Белый шум заданной длительности — основа для взрыва/всплеска
function createNoiseBuffer(ctx, duration) {
  const buffer = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * duration), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// Лёгкое «эхо» / хвост отражения — простая сеть с обратной связью, без файлов ИХ
function addEcho(ctx, inputNode, destination, { delayTime = 0.12, feedback = 0.3, wet = 0.22 } = {}) {
  const delay = ctx.createDelay(1);
  delay.delayTime.value = delayTime;
  const fb = ctx.createGain();
  fb.gain.value = feedback;
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 2200;
  const wetGain = ctx.createGain();
  wetGain.gain.value = wet;
  inputNode.connect(delay);
  delay.connect(damp).connect(fb).connect(delay);
  delay.connect(wetGain).connect(destination);
}

// ---- ПОПАДАНИЕ: резкий передний удар + низкий "боевой" гул + шумовой хвост осколков ----
function playHitSound() {
  if (!soundOn) return;
  const ctx = getAudioCtx();
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  // 1) Резкий транзиент — короткий яркий щелчок удара
  const crackBuf = createNoiseBuffer(ctx, 0.06);
  const crack = ctx.createBufferSource();
  crack.buffer = crackBuf;
  const crackFilter = ctx.createBiquadFilter();
  crackFilter.type = 'highpass';
  crackFilter.frequency.value = 1800;
  const crackGain = ctx.createGain();
  crackGain.gain.setValueAtTime(0.6, ctx.currentTime);
  crackGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
  crack.connect(crackFilter).connect(crackGain).connect(master);
  crack.start();

  // 2) Тело взрыва — фильтрованный шум с падающей частотой среза
  const bodyBuf = createNoiseBuffer(ctx, 0.45);
  const body = ctx.createBufferSource();
  body.buffer = bodyBuf;
  const bodyFilter = ctx.createBiquadFilter();
  bodyFilter.type = 'lowpass';
  bodyFilter.frequency.setValueAtTime(2400, ctx.currentTime);
  bodyFilter.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.45);
  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0.55, ctx.currentTime + 0.01);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
  body.connect(bodyFilter).connect(bodyGain).connect(master);
  body.start();

  // 3) Низкий "удар в грудь" — короткая просадка тона
  const thump = ctx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(120, ctx.currentTime);
  thump.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + 0.35);
  const thumpGain = ctx.createGain();
  thumpGain.gain.setValueAtTime(0.7, ctx.currentTime);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
  thump.connect(thumpGain).connect(master);
  thump.start();
  thump.stop(ctx.currentTime + 0.4);

  addEcho(ctx, master, ctx.destination, { delayTime: 0.09, feedback: 0.25, wet: 0.18 });
}

// ---- ПРОМАХ: всплеск воды — шипящий "плюх" с резонансным провалом ----
function playMissSound() {
  if (!soundOn) return;
  const ctx = getAudioCtx();
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);

  // Верхний "шип" брызг
  const spray = ctx.createBufferSource();
  spray.buffer = createNoiseBuffer(ctx, 0.28);
  const sprayFilter = ctx.createBiquadFilter();
  sprayFilter.type = 'bandpass';
  sprayFilter.frequency.setValueAtTime(3200, ctx.currentTime);
  sprayFilter.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.28);
  sprayFilter.Q.value = 0.7;
  const sprayGain = ctx.createGain();
  sprayGain.gain.setValueAtTime(0.5, ctx.currentTime);
  sprayGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
  spray.connect(sprayFilter).connect(sprayGain).connect(master);
  spray.start();

  // Нижний резонансный "плюх" — тело всплеска
  const plop = ctx.createOscillator();
  plop.type = 'sine';
  plop.frequency.setValueAtTime(500, ctx.currentTime);
  plop.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.22);
  const plopGain = ctx.createGain();
  plopGain.gain.setValueAtTime(0.35, ctx.currentTime);
  plopGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
  plop.connect(plopGain).connect(master);
  plop.start();
  plop.stop(ctx.currentTime + 0.22);

  addEcho(ctx, master, ctx.destination, { delayTime: 0.07, feedback: 0.18, wet: 0.12 });
}

// ---- КЛИК: механический двухфазный щелчок тумблера ----
function playClickSound() {
  if (!soundOn) return;
  const ctx = getAudioCtx();
  const t0 = ctx.currentTime;
  [0, 0.045].forEach((delay, i) => {
    const click = ctx.createBufferSource();
    click.buffer = createNoiseBuffer(ctx, 0.02);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = i === 0 ? 2600 : 1500;
    filter.Q.value = 4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, t0 + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + delay + 0.03);
    click.connect(filter).connect(gain).connect(ctx.destination);
    click.start(t0 + delay);
  });
}

// ---- СОНАР: чистый пинг с падающей частотой и эхо-хвостом отражений ----
function playSonarPing() {
  if (!soundOn) return;
  const ctx = getAudioCtx();
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1400, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(680, ctx.currentTime + 0.7);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.001, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
  osc.connect(gain).connect(master);
  osc.start();
  osc.stop(ctx.currentTime + 0.7);

  addEcho(ctx, master, ctx.destination, { delayTime: 0.22, feedback: 0.45, wet: 0.3 });
}

// ---- ПОБЕДА: судовой рынду-колокол — металлический неточный обертонный звон ----
function ringBell(ctx, destination, startTime, freq, gainAmt) {
  const partials = [1, 2.0, 2.4, 3.0, 4.2]; // неточные (inharmonic) обертоны — как у настоящего колокола
  partials.forEach((mult, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * mult;
    const gain = ctx.createGain();
    const amt = gainAmt / (i + 1);
    gain.gain.setValueAtTime(amt, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 1.1 - i * 0.12);
    osc.connect(gain).connect(destination);
    osc.start(startTime);
    osc.stop(startTime + 1.2);
  });
}

function playVictorySound() {
  if (!soundOn) return;
  const ctx = getAudioCtx();
  const master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(ctx.destination);
  [0, 0.32, 0.64].forEach((delay, i) => {
    ringBell(ctx, master, ctx.currentTime + delay, 880, i === 2 ? 0.35 : 0.28);
  });
  addEcho(ctx, master, ctx.destination, { delayTime: 0.18, feedback: 0.35, wet: 0.22 });
}

// ---- ПОРАЖЕНИЕ: низкий туманный гудок (foghorn) с лёгким вибрато ----
function playDefeatSound() {
  if (!soundOn) return;
  const ctx = getAudioCtx();
  const master = ctx.createGain();
  master.gain.value = 0.75;
  master.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(110, ctx.currentTime);

  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 5.5;
  const vibratoGain = ctx.createGain();
  vibratoGain.gain.value = 3;
  vibrato.connect(vibratoGain).connect(osc.frequency);
  vibrato.start();
  vibrato.stop(ctx.currentTime + 1.4);

  const hornFilter = ctx.createBiquadFilter();
  hornFilter.type = 'bandpass';
  hornFilter.frequency.value = 220;
  hornFilter.Q.value = 3;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.001, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.15);
  gain.gain.setValueAtTime(0.5, ctx.currentTime + 1.0);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.4);

  osc.connect(hornFilter).connect(gain).connect(master);
  osc.start();
  osc.stop(ctx.currentTime + 1.4);

  addEcho(ctx, master, ctx.destination, { delayTime: 0.15, feedback: 0.3, wet: 0.18 });
}

// ===== Создание пустого поля SIZE x SIZE, заполненного null =====
function createEmptyBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}

// ===== Случайная расстановка кораблей на поле =====
function placeShips(board) {
  const ships = [];
  for (const size of SHIP_SIZES) {
    let placed = false;
    while (!placed) {
      const horizontal = Math.random() < 0.5;
      const row = Math.floor(Math.random() * SIZE);
      const col = Math.floor(Math.random() * SIZE);
      const cells = [];
      let fits = true;
      for (let i = 0; i < size; i++) {
        const r = horizontal ? row : row + i;
        const c = horizontal ? col + i : col;
        if (r >= SIZE || c >= SIZE || board[r][c] !== null) {
          fits = false;
          break;
        }
        cells.push([r, c]);
      }
      if (fits && !hasAdjacentShip(board, cells)) {
        cells.forEach(([r, c]) => board[r][c] = 'ship');
        ships.push(cells);
        placed = true;
      }
    }
  }
  return ships;
}

// Проверка: не соприкасается ли новый корабль с уже существующими (чтобы не лепились впритык)
function hasAdjacentShip(board, cells) {
  for (const [r, c] of cells) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === 'ship') {
          return true;
        }
      }
    }
  }
  return false;
}

// ===== Отрисовка поля игрока (видны его корабли) =====
function getShipAt(ships, r, c) {
  return ships.find(ship => ship.some(([sr, sc]) => sr === r && sc === c)) || null;
}

function getShipIcon(ship) {
  if (!ship) return '';
  if (ship.length >= 3) return '🚢';
  if (ship.length === 2) return '🛳️';
  return '🚤';
}

// ===== Отрисовка поля игрока: на кораблях видны иконки разных типов =====
function renderPlayerBoard() {
  const grid = document.getElementById('playerGrid');
  grid.innerHTML = '';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      const val = playerBoard[r][c];
      const ship = getShipAt(playerShips, r, c);

      if (val === 'ship') cell.classList.add('ship');
      if (val === 'hit') cell.classList.add('hit');
      if (val === 'sunk') cell.classList.add('sunk');
      if (val === 'miss') cell.classList.add('miss');

      // Иконку ставим в первую клетку каждого корабля, чтобы корабль был визуально заметен.
      if (ship && ship[0][0] === r && ship[0][1] === c && (val === 'ship' || val === 'hit' || val === 'sunk')) {
        const icon = document.createElement('span');
        icon.className = 'ship-icon';
        icon.textContent = getShipIcon(ship);
        if (ship.length > 1 && ship[0][0] !== ship[1][0]) icon.classList.add('vertical');
        cell.appendChild(icon);
      }

      cell.dataset.r = r;
      cell.dataset.c = c;
      grid.appendChild(cell);
    }
  }
}

// ===== Отрисовка поля врага (корабли скрыты, пока не подбиты) =====
function renderEnemyBoard() {
  const grid = document.getElementById('enemyGrid');
  grid.innerHTML = '';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      const val = enemyBoard[r][c];
      if (val === 'hit') cell.classList.add('hit');
      if (val === 'sunk') cell.classList.add('sunk');
      if (val === 'miss') cell.classList.add('miss');
      cell.dataset.r = r;
      cell.dataset.c = c;
      if (!gameOver && playerTurn && val !== 'hit' && val !== 'miss' && val !== 'sunk') {
        cell.addEventListener('click', () => playerFire(r, c));
      }
      grid.appendChild(cell);
    }
  }
}

// ===== Показать анимацию взрыва в конкретной клетке DOM =====
function showExplosion(cellEl) {
  const boom = document.createElement('div');
  boom.className = 'explosion';
  const core = document.createElement('div');
  core.className = 'core';
  boom.appendChild(core);
  for (let i = 0; i < 8; i++) {
    const spark = document.createElement('div');
    spark.className = 'spark';
    const angle = (Math.PI * 2 * i) / 8;
    const dist = 26 + Math.random() * 10;
    spark.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
    spark.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
    boom.appendChild(spark);
  }
  cellEl.appendChild(boom);
  setTimeout(() => boom.remove(), 550);
}

// ===== Проверка, потоплен ли корабль, которому принадлежит клетка (r,c) =====
function checkSunk(board, ships, r, c) {
  const ship = ships.find(cells => cells.some(([sr, sc]) => sr === r && sc === c));
  if (!ship) return null;
  const allHit = ship.every(([sr, sc]) => board[sr][sc] === 'hit' || board[sr][sc] === 'sunk');
  if (allHit) {
    ship.forEach(([sr, sc]) => board[sr][sc] = 'sunk');
    return ship;
  }
  return null;
}

// ===== Проверка победы: все ли корабли на поле потоплены =====
function allSunk(board, ships) {
  return ships.every(cells => cells.every(([r, c]) => board[r][c] === 'sunk'));
}

// ===== Выстрел игрока по клетке (r, c) вражеского поля =====
function playerFire(r, c) {
  if (gameOver || !playerTurn) return;
  const cellEl = document.querySelector(`#enemyGrid .cell[data-r="${r}"][data-c="${c}"]`);
  if (enemyBoard[r][c] === 'ship') {
    enemyBoard[r][c] = 'hit';
    cellEl.classList.add('hit');
    showExplosion(cellEl);
    playHitSound();
    const sunkShip = checkSunk(enemyBoard, enemyShips, r, c);
    if (sunkShip) statusEl_setSunk();
    if (allSunk(enemyBoard, enemyShips)) {
      endGame(true);
      return;
    }
    setStatus('Попадание! Стреляйте ещё раз.');
    renderEnemyBoard();
  } else {
    enemyBoard[r][c] = 'miss';
    cellEl.classList.add('miss');
    playMissSound();
    playerTurn = false;
    setStatus('Промах! Ход компьютера...');
    renderEnemyBoard();
    setTimeout(computerTurn, 700);
  }
}

// Вспомогательная функция для отображения текста про потопленный корабль
function statusEl_setSunk() {
  setStatus('Корабль противника потоплен! 💥');
}

// ===== Простой ИИ компьютера: сначала случайный поиск, затем добивание вокруг попадания =====
let aiTargets = [];

function computerTurn() {
  if (gameOver) return;
  let r, c;
  if (aiTargets.length > 0) {
    [r, c] = aiTargets.shift();
  } else {
    do {
      r = Math.floor(Math.random() * SIZE);
      c = Math.floor(Math.random() * SIZE);
    } while (playerBoard[r][c] === 'hit' || playerBoard[r][c] === 'miss' || playerBoard[r][c] === 'sunk');
  }
  const cellEl = document.querySelector(`#playerGrid .cell[data-r="${r}"][data-c="${c}"]`);
  if (playerBoard[r][c] === 'ship') {
    playerBoard[r][c] = 'hit';
    showExplosion(cellEl);
    playHitSound();
    addAdjacentTargets(r, c);
    const sunkShip = checkSunk(playerBoard, playerShips, r, c);
    renderPlayerBoard();
    if (allSunk(playerBoard, playerShips)) {
      endGame(false);
      return;
    }
    setStatus(sunkShip ? 'Компьютер потопил ваш корабль! Его ход продолжается...' : 'Компьютер попал! Его ход продолжается...');
    setTimeout(computerTurn, 700);
  } else {
    playerBoard[r][c] = 'miss';
    playMissSound();
    renderPlayerBoard();
    playerTurn = true;
    setStatus('Компьютер промахнулся. Ваш ход!');
    renderEnemyBoard();
  }
}

// Добавляет соседние (вверх/вниз/влево/вправо) клетки от удачного попадания в очередь ИИ
function addAdjacentTargets(r, c) {
  const candidates = [[r-1,c],[r+1,c],[r,c-1],[r,c+1]];
  for (const [nr, nc] of candidates) {
    if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE &&
        playerBoard[nr][nc] !== 'hit' && playerBoard[nr][nc] !== 'miss' && playerBoard[nr][nc] !== 'sunk') {
      aiTargets.push([nr, nc]);
    }
  }
}

// ===== Обновление текста статуса игры =====
function setStatus(text) {
  document.getElementById('status').textContent = text;
}

// ===== Завершение игры =====
function endGame(playerWon) {
  gameOver = true;
  setStatus(playerWon ? '🎉 Вы победили! Весь флот противника потоплен.' : '💀 Поражение. Ваш флот уничтожен.');
  if (playerWon) playVictorySound(); else playDefeatSound();
  renderEnemyBoard();
}

// ===== Запуск новой игры: пересоздаём поля, расставляем корабли, сбрасываем состояние =====
function newGame() {
  playerBoard = createEmptyBoard();
  enemyBoard = createEmptyBoard();
  playerShips = placeShips(playerBoard);
  enemyShips = placeShips(enemyBoard);
  gameOver = false;
  playerTurn = true;
  aiTargets = [];
  setStatus('Стреляйте по полю противника — кликните по клетке справа');
  playSonarPing();
  renderPlayerBoard();
  renderEnemyBoard();
}

// ===== Обработчик кнопки "Новая игра" =====
document.getElementById('newGameBtn').addEventListener('click', () => {
  playClickSound();
  newGame();
});

// ===== Обработчик переключателя звука =====
document.getElementById('soundBtn').addEventListener('click', function() {
  soundOn = !soundOn;
  this.textContent = soundOn ? '🔊 Звук: вкл' : '🔇 Звук: выкл';
  playClickSound();
});

// ===== Запускаем первую игру при загрузке страницы =====
newGame();
