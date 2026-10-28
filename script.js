// Store the routes as row and column pairs so the board stays easy to edit.
const levelRoutes = [
	[[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]],
	[[2, 0], [1, 0], [1, 1], [1, 2], [1, 3], [2, 3], [2, 4]],
	[[2, 0], [3, 0], [3, 1], [3, 2], [3, 3], [2, 3], [2, 4]],
	[[2, 0], [1, 0], [1, 1], [2, 1], [2, 2], [2, 3], [2, 4]],
	[[2, 0], [3, 0], [3, 1], [2, 1], [2, 2], [2, 3], [2, 4]],
	[[2, 0], [1, 0], [1, 1], [1, 2], [2, 2], [3, 2], [3, 3], [2, 3], [2, 4]],
	[[2, 0], [3, 0], [3, 1], [3, 2], [2, 2], [1, 2], [1, 3], [2, 3], [2, 4]]
];

const directions = {
	N: [-1, 0],
	E: [0, 1],
	S: [1, 0],
	W: [0, -1]
};
const oppositeDirection = { N: 'S', E: 'W', S: 'N', W: 'E' };
const baseConnections = {
	straight: ['N', 'S'],
	elbow: ['N', 'E'],
	tee: ['N', 'E', 'W'],
	cross: ['N', 'E', 'S', 'W']
};
const storageKey = 'charity-city-pipeline-save';

const homeScreen = document.querySelector('#home-screen');
const gameScreen = document.querySelector('#game-screen');
const gameBoard = document.querySelector('#game-board');
const overlay = document.querySelector('#game-overlay');
const overlayCard = document.querySelector('#overlay-card');
const overlayTitle = document.querySelector('#overlay-title');
const overlayEyebrow = document.querySelector('#overlay-eyebrow');
const overlayCopy = document.querySelector('#overlay-copy');
const overlayActions = document.querySelector('#overlay-actions');
const overlaySymbol = document.querySelector('#overlay-symbol');
const previewShape = document.querySelector('#preview-shape');
const piecePreviewButton = document.querySelector('#piece-preview-button');
const toast = document.querySelector('#toast');
const boardWrap = document.querySelector('.board-wrap');

let state = null;
let selectedMode = 'timed';
let timerInterval = null;
let toastTimeout = null;
let soundOn = true;

function getRoutePositions(level) {
	const boardSize = getBoardSize(level);
	const { sourceRow, cityRow } = getEndpointRows(level);
	const rowOffset = sourceRow - 2;
	const route = levelRoutes[(level - 1) % levelRoutes.length]
		.map(([row, column]) => [row + rowOffset, column]);

	for (let column = 5; column < boardSize - 1; column += 1) {
		route.push([sourceRow, column]);
	}

	const rowStep = Math.sign(cityRow - sourceRow);
	let row = sourceRow;
	while (row !== cityRow) {
		row += rowStep;
		route.push([row, boardSize - 2]);
	}
	route.push([cityRow, boardSize - 1]);
	return route;
}

function getEndpointRows(level) {
	const center = Math.floor(getBoardSize(level) / 2);
	if (level === 1) {
		return { sourceRow: center, cityRow: center };
	}

	// Cycle both endpoints through five rows while keeping them on the board.
	const sourceRow = center + ((level - 1) % 5) - 2;
	let cityRow = center + ((level * 2) % 5) - 2;
	if (cityRow === sourceRow) {
		cityRow = sourceRow < getBoardSize(level) - 1 ? sourceRow + 1 : sourceRow - 1;
	}

	return { sourceRow, cityRow };
}

// Place a growing number of differently sized obstacles away from the route.
function makeObstacleCells(level, occupiedCells = []) {
	if (level < 2) {
		return [];
	}

	const obstacleCount = level;
	const boardSize = getBoardSize(level);
	const unavailableCells = new Set(occupiedCells);
	getRoutePositions(level).forEach(([row, column]) => unavailableCells.add(row * boardSize + column));
	const availableSizes = [
		{ width: 1, height: 1 },
		{ width: 2, height: 1 },
		{ width: 2, height: 2 }
	];
	if (level >= 5) {
		availableSizes.push({ width: 3, height: 1 }, { width: 3, height: 3 });
	}
	if (level >= 7) {
		availableSizes.push({ width: 4, height: 1 }, { width: 4, height: 4 });
	}

	const obstacles = [];
	for (let index = 0; index < obstacleCount; index += 1) {
		const preferredSizeIndex = (level - 2 + index) % availableSizes.length;
		let placedObstacle = null;

		for (let offset = 0; offset < availableSizes.length && !placedObstacle; offset += 1) {
			const sizeIndex = (preferredSizeIndex + offset) % availableSizes.length;
			const size = availableSizes[sizeIndex];
			const placements = [];

			for (let row = 0; row <= boardSize - size.height; row += 1) {
				for (let column = 0; column <= boardSize - size.width; column += 1) {
					const cells = [];
					for (let rowOffset = 0; rowOffset < size.height; rowOffset += 1) {
						for (let columnOffset = 0; columnOffset < size.width; columnOffset += 1) {
							cells.push((row + rowOffset) * boardSize + column + columnOffset);
						}
					}

					if (cells.every((cellIndex) => !unavailableCells.has(cellIndex))) {
						placements.push({ row, column, cells, ...size });
					}
				}
			}

			if (placements.length > 0) {
				const placementIndex = Math.floor((index + 1) * placements.length / (obstacleCount + 1));
				placedObstacle = placements[placementIndex];
				placedObstacle.cells.forEach((cellIndex) => unavailableCells.add(cellIndex));
				delete placedObstacle.cells;
				obstacles.push(placedObstacle);
			}
		}
	}

	return obstacles;
}

function getObstacleCellIndices(obstacles = state.obstacles, boardSize = state.boardSize) {
	const cells = new Set();

	obstacles.forEach(({ row, column, width, height }) => {
		for (let rowOffset = 0; rowOffset < height; rowOffset += 1) {
			for (let columnOffset = 0; columnOffset < width; columnOffset += 1) {
				cells.add((row + rowOffset) * boardSize + column + columnOffset);
			}
		}
	});

	return cells;
}

// Each route becomes a shuffled queue of pieces with the correct connections.
function makeRoutePieces(level) {
	const boardSize = getBoardSize(level);
	const { sourceRow, cityRow } = getEndpointRows(level);
	const route = getRoutePositions(level);
	const pieces = route.map((position, index) => {
		const previous = route[index - 1] || [sourceRow, -1];
		const next = route[index + 1] || [cityRow, boardSize];
		const connections = [getDirection(position, previous), getDirection(position, next)];
		const type = connections[0] === oppositeDirection[connections[1]] ? 'straight' : 'elbow';

		return {
			id: `level-${level}-piece-${index}`,
			type,
			rotation: getRotationForConnections(type, connections),
			connections
		};
	});

	const complexPieceCount = Math.floor((level - 1) / 2);
	for (let index = 0; index < complexPieceCount; index += 1) {
		const pieceIndex = Math.floor((index + 1) * pieces.length / (complexPieceCount + 1));
		const piece = pieces[pieceIndex];
		piece.type = index === 0 ? 'tee' : 'cross';
		piece.rotation = getRotationForConnections(piece.type, piece.connections);
	}

	pieces.forEach((piece) => delete piece.connections);

	for (let index = pieces.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(Math.random() * (index + 1));
		[pieces[index], pieces[swapIndex]] = [pieces[swapIndex], pieces[index]];
	}

	return pieces;
}

function getBoardSize(level) {
	return Math.min(7 + (level - 1) * 2, 19);
}

function getDirection(from, to) {
	const rowDifference = to[0] - from[0];
	const columnDifference = to[1] - from[1];

	return Object.keys(directions).find((direction) => {
		return directions[direction][0] === rowDifference && directions[direction][1] === columnDifference;
	});
}

function rotateConnections(connections) {
	const clockwise = { N: 'E', E: 'S', S: 'W', W: 'N' };
	return connections.map((direction) => clockwise[direction]);
}

function getRotationForConnections(type, connections) {
	let rotation = 0;
	let rotated = baseConnections[type];

	while (!connections.every((direction) => rotated.includes(direction)) && rotation < 4) {
		rotated = rotateConnections(rotated);
		rotation += 1;
	}

	return rotation % 4;
}

function getCurrentConnections(piece) {
	let connections = baseConnections[piece.type];

	for (let turn = 0; turn < piece.rotation; turn += 1) {
		connections = rotateConnections(connections);
	}

	return connections;
}

function createNewGame(mode) {
	selectedMode = mode;
	state = {
		mode,
		level: 1,
		score: 0,
		timeLeft: 120,
		route: [],
		board: [],
		pieceIndex: 0,
		currentPiece: null,
		pendingPiece: false,
		rewardedPieceIds: [],
		active: true
	};
	startLevel();
}

function startLevel() {
	clearInterval(timerInterval);
	state.boardSize = getBoardSize(state.level);
	state.route = makeRoutePieces(state.level);
	state.obstacles = makeObstacleCells(state.level);
	state.board = Array(state.boardSize * state.boardSize).fill(null);
	state.pieceIndex = 0;
	state.currentPiece = { ...state.route[0] };
	state.pendingPiece = false;
	state.timeLeft = Math.max(60, 120 - (state.level - 1) * 10);
	state.active = true;
	showGame();
	renderGame();
	saveGame();
	startTimer();
}

function saveGame() {
	if (!state || !state.active) {
		return;
	}

	localStorage.setItem(storageKey, JSON.stringify(state));
}

function loadSavedGame() {
	try {
		return JSON.parse(localStorage.getItem(storageKey));
	} catch (error) {
		return null;
	}
}

function showGame() {
	homeScreen.classList.add('hidden');
	gameScreen.classList.remove('hidden');
}

function showHome() {
	clearInterval(timerInterval);
	overlay.classList.add('hidden');
	gameScreen.classList.add('hidden');
	homeScreen.classList.remove('hidden');
	updateHomeActions();
}

function updateHomeActions() {
	const savedGame = loadSavedGame();
	const hasSavedGame = savedGame && savedGame.active;

	document.querySelector('#continue-button').classList.toggle('hidden', !hasSavedGame);
	document.querySelector('#restart-button').classList.toggle('hidden', !hasSavedGame);
	document.querySelector('#start-button').textContent = hasSavedGame ? 'Choose a new game' : 'Start a new game';
}

function renderGame() {
	const levelName = getLevelName(state.level);
	const stage = getStageName(state.level);

	document.querySelector('#campaign-label').textContent = stage.toUpperCase();
	document.querySelector('#level-title').innerHTML = `Level ${String(state.level).padStart(2, '0')} <span>·</span> ${levelName}`;
	document.querySelector('#level-value').textContent = `LEVEL ${String(state.level).padStart(2, '0')} / 21`;
	document.querySelector('#score-value').textContent = String(state.score).padStart(4, '0');
	document.querySelector('#timer-label').textContent = state.mode === 'timed' ? 'TIME LEFT' : 'PACE';
	document.querySelector('#timer-value').textContent = state.mode === 'timed' ? formatTime(state.timeLeft) : '∞';
	document.querySelector('#mode-note').textContent = state.mode === 'timed'
		? 'Finish quickly for a time bonus.'
		: 'No clock. Find your own rhythm.';
	document.querySelector('#game-prompt').textContent = state.mode === 'timed'
		? 'Turn the pipe and build a route before time runs out.'
		: 'Turn the pipe and build a route at your own pace.';

	renderBoard();
	renderPreview();
	updatePieceControls();
}

function getLevelName(level) {
	if (level <= 7) {
		return ['Main Street', 'Parkside', 'River Ward', 'East Market', 'Old Town', 'Hill District', 'City Center'][level - 1];
	}
	if (level <= 14) {
		return ['North County', 'Mill Creek', 'Pine Valley', 'Lake District', 'Redstone', 'Cedar County', 'Crossroads'][level - 8];
	}
	return ['High Plains', 'Blue Ridge', 'South Fork', 'Green Valley', 'West Basin', 'Great Lakes', 'Continental Supply Success'][level - 15];
}

function getStageName(level) {
	if (level <= 7) {
		return 'City network';
	}
	if (level <= 14) {
		return 'County & district network';
	}
	return 'State network';
}

function renderBoard() {
	const flowingCells = getFlowingCells();
	const boardSize = state.boardSize;
	const { sourceRow, cityRow } = getEndpointRows(state.level);
	const obstaclesByAnchor = new Map((state.obstacles || []).map((obstacle) => {
		return [obstacle.row * boardSize + obstacle.column, obstacle];
	}));
	const obstacleCells = getObstacleCellIndices(state.obstacles || [], boardSize);
	gameBoard.innerHTML = '';
	boardWrap.style.setProperty('--source-position', `${((sourceRow + 0.5) / boardSize) * 100}%`);
	boardWrap.style.setProperty('--city-position', `${((cityRow + 0.5) / boardSize) * 100}%`);
	gameBoard.style.gridTemplateColumns = `repeat(${boardSize}, minmax(0, 1fr))`;
	gameBoard.style.gridTemplateRows = `repeat(${boardSize}, minmax(0, 1fr))`;
	gameBoard.setAttribute('aria-label', `${boardSize} by ${boardSize} pipe grid`);

	for (let cellIndex = 0; cellIndex < state.board.length; cellIndex += 1) {
		const obstacle = obstaclesByAnchor.get(cellIndex);
		if (obstacleCells.has(cellIndex) && !obstacle) {
			continue;
		}

		const piece = state.board[cellIndex];
		const cell = document.createElement('div');
		const row = Math.floor(cellIndex / boardSize);
		const column = cellIndex % boardSize;
		cell.className = 'board-cell';
		cell.dataset.cell = cellIndex;
		cell.style.gridRow = `${row + 1} / span ${obstacle ? obstacle.height : 1}`;
		cell.style.gridColumn = `${column + 1} / span ${obstacle ? obstacle.width : 1}`;
		cell.setAttribute('role', 'gridcell');

		if (obstacle) {
			cell.classList.add('obstacle');
			cell.setAttribute('aria-label', `${obstacle.width} by ${obstacle.height} obstacle at row ${row + 1}, column ${column + 1}`);
			cell.innerHTML = '<span class="obstacle-rock" aria-hidden="true"></span>';
		} else if (piece) {
			cell.classList.add('occupied');
			if (flowingCells.has(cellIndex)) {
				cell.classList.add('flowing');
			}
			cell.innerHTML = `<span class="placed-pipe ${piece.type}" style="--pipe-rotation: ${piece.rotation * 90}deg" aria-label="${piece.type} pipe"></span>`;
		} else {
			cell.innerHTML = `<button class="place-button" type="button" data-cell="${cellIndex}" aria-label="Place pipe in row ${row + 1}, column ${column + 1}"><span aria-hidden="true">+</span></button>`;
		}

		gameBoard.append(cell);
	}

	const reachesCity = hasReachedCity(flowingCells);
	document.querySelector('#flow-status').textContent = reachesCity
		? 'Water is reaching the city!'
		: flowingCells.size > 0 ? `${flowingCells.size} pipe${flowingCells.size === 1 ? '' : 's'} carrying water` : 'Water is waiting';
}

// Follow only pipes whose openings face each other, beginning at the well.
function getFlowingCells() {
	const flowing = new Set();
	const { sourceRow } = getEndpointRows(state.level);
	const queue = [{ row: sourceRow, column: -1, direction: 'E' }];

	while (queue.length > 0) {
		const current = queue.shift();

		for (const direction of getConnectionsAt(current)) {
			const [rowChange, columnChange] = directions[direction];
			const nextRow = current.row + rowChange;
			const nextColumn = current.column + columnChange;

			if (nextRow < 0 || nextRow >= state.boardSize || nextColumn < 0 || nextColumn >= state.boardSize) {
				continue;
			}

			const nextIndex = nextRow * state.boardSize + nextColumn;
			const nextPiece = state.board[nextIndex];
			if (!nextPiece || !getCurrentConnections(nextPiece).includes(oppositeDirection[direction])) {
				continue;
			}

			if (!flowing.has(nextIndex)) {
				flowing.add(nextIndex);
				queue.push({ row: nextRow, column: nextColumn, piece: nextPiece });
			}
		}
	}

	return flowing;
}

function getConnectionsAt(position) {
	if (position.piece) {
		return getCurrentConnections(position.piece);
	}

	return [position.direction];
}

function hasReachedCity(flowingCells) {
	const { cityRow } = getEndpointRows(state.level);
	const cityIndex = cityRow * state.boardSize + state.boardSize - 1;
	const finalCell = state.board[cityIndex];
	return Boolean(finalCell && flowingCells.has(cityIndex) && getCurrentConnections(finalCell).includes('E'));
}

function renderPreview() {
	if (!state.currentPiece) {
		return;
	}

	previewShape.className = `piece-shape ${state.currentPiece.type}`;
	previewShape.style.setProperty('--pipe-rotation', `${state.currentPiece.rotation * 90}deg`);
	const pieceDetails = {
		straight: 'Straight pipe · 12 pts',
		elbow: 'Elbow pipe · 20 pts',
		tee: 'Three-way pipe · 24 pts',
		cross: 'Four-way pipe · 28 pts'
	};
	document.querySelector('#piece-name').textContent = pieceDetails[state.currentPiece.type];
	piecePreviewButton.disabled = state.pendingPiece;
}

function updatePieceControls() {
	const continueButton = document.querySelector('#continue-piece-button');
	const moveButton = document.querySelector('#move-piece-button');
	continueButton.disabled = !state.pendingPiece;
	moveButton.disabled = !state.pendingPiece;
	continueButton.innerHTML = state.pendingPiece ? 'Next piece <span aria-hidden="true">→</span>' : 'Place a pipe first <span aria-hidden="true">→</span>';
	document.querySelector('#placed-message').textContent = state.pendingPiece
		? 'Double-click your pipe to lock it in, or move it once.'
		: 'Your next pipe is ready.';
}

function placeCurrentPiece(cellIndex) {
	if (!state.currentPiece || state.pendingPiece || state.board[cellIndex] || getObstacleCellIndices().has(cellIndex)) {
		return;
	}

	state.board[cellIndex] = { ...state.currentPiece };
	state.pendingPiece = true;
	playPipeSound();

	const flowingCells = getFlowingCells();
	const placedPiece = state.board[cellIndex];
	if (flowingCells.has(cellIndex) && !state.rewardedPieceIds.includes(placedPiece.id)) {
		const piecePoints = { straight: 12, elbow: 20, tee: 24, cross: 28 };
		const points = piecePoints[placedPiece.type];
		state.score += points;
		state.rewardedPieceIds.push(placedPiece.id);
		showToast(`+${points} · Water is flowing`);
	} else if (!flowingCells.has(cellIndex)) {
		showToast('No flow yet. Check the pipe direction.');
	}

	renderGame();
	saveGame();

	if (hasReachedCity(flowingCells)) {
		completeLevel();
	}
}

function moveLastPiece() {
	if (!state.pendingPiece) {
		return;
	}

	const placedIndex = state.board.findIndex((piece) => piece && piece.id === state.currentPiece.id);
	if (placedIndex !== -1) {
		state.board[placedIndex] = null;
	}

	state.pendingPiece = false;
	renderGame();
	saveGame();
}

function continueToNextPiece() {
	if (!state.pendingPiece) {
		return;
	}

	state.pieceIndex += 1;
	if (state.pieceIndex >= state.route.length) {
		endGame('The route ran out before water reached Charity City.');
		return;
	}

	state.currentPiece = { ...state.route[state.pieceIndex] };
	state.pendingPiece = false;
	renderGame();
	saveGame();
}

function completeLevel() {
	if (state.mode === 'timed') {
		const bonus = state.timeLeft * 3;
		state.score += bonus;
		showToast(`City connected · +${bonus} time bonus`);
	}

	clearInterval(timerInterval);
	state.active = false;
	localStorage.removeItem(storageKey);
	playWaterSound();

	if (state.level === 21) {
		showCampaignComplete();
		return;
	}

	const nextLevel = Math.min(21, state.level + 1);
	const changedRegion = getStageName(nextLevel) !== getStageName(state.level);
	const regionMessage = changedRegion ? `The map opens up. Your network now reaches the ${getStageName(nextLevel).toLowerCase()}.` : '';

	showOverlay({
		kind: changedRegion ? 'map' : 'level-up',
		symbol: '✦',
		eyebrow: changedRegion ? 'The network is growing' : 'A new connection',
		title: 'Level Up',
		copy: `${regionMessage} Level ${nextLevel} is ready.`,
		actions: [
			{ label: `Start level ${nextLevel}`, style: 'primary', action: () => { state.level = nextLevel; startLevel(); overlay.classList.add('hidden'); } },
			{ label: 'Home screen', style: 'text', action: showHome }
		]
	});
}

function showCampaignComplete() {
	showOverlay({
		kind: 'finale',
		symbol: '✦',
		eyebrow: '21 levels · one connected world',
		title: 'Clean Water For All',
		copy: `Continental Supply Success is connected. Final score: ${state.score.toLocaleString()}.`,
		actions: [
			{ label: 'Save success card', style: 'primary', action: saveSuccessCard },
			{ label: 'Share success', style: 'outline', action: shareSuccess },
			{ label: 'Home screen', style: 'text', action: showHome }
		]
	});
}

function endGame(message) {
	clearInterval(timerInterval);
	state.active = false;
	localStorage.removeItem(storageKey);
	showOverlay({
		kind: 'game-over',
		symbol: '',
		eyebrow: 'The line broke',
		title: 'Game Over',
		copy: `${message} You reached level ${state.level}. Score: ${state.score.toLocaleString()}.`,
		actions: [
			{ label: 'Try this level again', style: 'primary', action: () => { startLevel(); overlay.classList.add('hidden'); } },
			{ label: 'Home screen', style: 'text', action: showHome }
		]
	});
}

function showOverlay(options) {
	overlayCard.className = `overlay-card ${options.kind}`;
	overlaySymbol.textContent = options.symbol;
	overlayEyebrow.textContent = options.eyebrow;
	overlayTitle.textContent = options.title;
	overlayCopy.textContent = options.copy;
	overlayActions.innerHTML = '';

	options.actions.forEach((item) => {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = `button button-${item.style}`;
		button.textContent = item.label;
		button.addEventListener('click', item.action);
		overlayActions.append(button);
	});

	overlay.classList.remove('hidden');
}

function startTimer() {
	clearInterval(timerInterval);
	if (state.mode !== 'timed') {
		return;
	}

	timerInterval = setInterval(() => {
		state.timeLeft -= 1;
		document.querySelector('#timer-value').textContent = formatTime(state.timeLeft);
		if (state.timeLeft <= 0) {
			endGame('Time ran out before the city was connected.');
		} else {
			saveGame();
		}
	}, 1000);
}

function formatTime(seconds) {
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function showToast(message) {
	toast.textContent = message;
	toast.classList.add('visible');
	clearTimeout(toastTimeout);
	toastTimeout = setTimeout(() => toast.classList.remove('visible'), 1800);
}

function playTone(frequency, duration) {
	if (!soundOn) {
		return;
	}

	const audio = new AudioContext();
	const oscillator = audio.createOscillator();
	const volume = audio.createGain();
	oscillator.frequency.value = frequency;
	oscillator.type = 'sine';
	volume.gain.setValueAtTime(0.06, audio.currentTime);
	volume.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
	oscillator.connect(volume);
	volume.connect(audio.destination);
	oscillator.start();
	oscillator.stop(audio.currentTime + duration);
	oscillator.onended = () => audio.close();
}

function playPipeSound() {
	playTone(210, 0.12);
}

function playWaterSound() {
	playTone(440, 0.5);
	setTimeout(() => playTone(660, 0.45), 160);
}

function saveSuccessCard() {
	const card = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#f5f8f2"/><circle cx="930" cy="180" r="92" fill="#ffc907"/><path d="M0 470 Q260 390 480 485 T930 460 T1200 485 V800 H0Z" fill="#a8d9d3"/><path d="M0 575 Q260 500 520 580 T1000 550 T1200 570 V800 H0Z" fill="#2e9df7"/><path d="M160 580 H420 V500 H690 V570 H970" fill="none" stroke="#153a3c" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/><circle cx="160" cy="580" r="26" fill="#ffc907"/><circle cx="970" cy="570" r="26" fill="#ff902a"/><text x="100" y="150" fill="#153a3c" font-family="Georgia,serif" font-size="36">CHARITY CITY PIPELINE</text><text x="100" y="275" fill="#153a3c" font-family="Georgia,serif" font-size="76" font-weight="bold">Clean Water For All</text><text x="100" y="355" fill="#42666a" font-family="Arial,sans-serif" font-size="30">21 levels connected · Score ${state.score.toLocaleString()}</text><text x="100" y="730" fill="#153a3c" font-family="Arial,sans-serif" font-size="22">Every connection counts.</text></svg>`;
	const file = new Blob([card], { type: 'image/svg+xml' });
	const link = document.createElement('a');
	link.href = URL.createObjectURL(file);
	link.download = 'clean-water-for-all.svg';
	link.click();
	URL.revokeObjectURL(link.href);
	showToast('Success card saved.');
}

async function shareSuccess() {
	const message = `I connected all 21 levels of Charity City Pipeline. Final score: ${state.score.toLocaleString()}!`;

	if (navigator.share) {
		await navigator.share({ title: 'Clean Water For All', text: message });
	} else if (navigator.clipboard) {
		await navigator.clipboard.writeText(message);
		showToast('Success message copied.');
	} else {
		showToast(message);
	}
}

function openSettings() {
	clearInterval(timerInterval);
	showOverlay({
		kind: 'settings',
		symbol: '☼',
		eyebrow: 'Take a pause',
		title: 'Settings',
		copy: `Sound is ${soundOn ? 'on' : 'off'}. Your current game is saved automatically.`,
		actions: [
			{ label: soundOn ? 'Turn sound off' : 'Turn sound on', style: 'outline', action: () => { soundOn = !soundOn; openSettings(); } },
			...(state && state.active ? [{ label: 'Resume game', style: 'primary', action: () => { overlay.classList.add('hidden'); startTimer(); } }] : []),
			{ label: 'Home screen', style: 'text', action: showHome }
		]
	});
}

function showGameStylePicker() {
	const savedGame = loadSavedGame();
	const hasSavedGame = savedGame && savedGame.active;
	const timedLabel = hasSavedGame && savedGame.mode === 'timed' ? 'Continue timed game' : 'Beat the clock';
	const relaxedLabel = hasSavedGame && savedGame.mode === 'relaxed' ? 'Continue Just for Fun' : 'Just for fun';
	const copy = hasSavedGame
		? `Your paused ${savedGame.mode === 'timed' ? 'timed' : 'Just for Fun'} game can be continued. Choosing another style starts a new game.`
		: 'Play against the clock for time bonuses, or take your time.';

	showOverlay({
		kind: 'game-style',
		symbol: '≋',
		eyebrow: 'A new connection',
		title: 'Choose a game style',
		copy,
		actions: [
			{ label: timedLabel, style: 'primary', action: () => selectGameMode('timed') },
			{ label: relaxedLabel, style: 'outline', action: () => selectGameMode('relaxed') }
		]
	});
}

function selectGameMode(mode) {
	const savedGame = loadSavedGame();
	if (savedGame && savedGame.active && savedGame.mode === mode) {
		resumeSavedGame();
		return;
	}

	overlay.classList.add('hidden');
	createNewGame(mode);
}

function resumeSavedGame() {
	const savedGame = loadSavedGame();
	if (!savedGame || !savedGame.active) {
		return;
	}

	state = savedGame;
	state.boardSize = state.boardSize || getBoardSize(state.level);
	if (!state.obstacles || !state.obstacles.every((obstacle) => typeof obstacle === 'object')) {
		const occupiedCells = state.board.flatMap((piece, index) => piece ? [index] : []);
		state.obstacles = makeObstacleCells(state.level, occupiedCells);
	}
	selectedMode = state.mode;
	saveGame();
	overlay.classList.add('hidden');
	showGame();
	renderGame();
	startTimer();
}

document.querySelector('#start-button').addEventListener('click', showGameStylePicker);
document.querySelector('#restart-button').addEventListener('click', () => {
	const savedGame = loadSavedGame();
	createNewGame(savedGame ? savedGame.mode : selectedMode);
});
document.querySelector('#continue-button').addEventListener('click', () => {
	resumeSavedGame();
});
piecePreviewButton.addEventListener('click', () => {
	if (!state || !state.currentPiece || state.pendingPiece) {
		return;
	}
	state.currentPiece.rotation = (state.currentPiece.rotation + 1) % 4;
	renderPreview();
});
gameBoard.addEventListener('click', (event) => {
	const placeButton = event.target.closest('.place-button[data-cell]');
	if (placeButton && state) {
		placeCurrentPiece(Number(placeButton.dataset.cell));
	}
});
gameBoard.addEventListener('dblclick', (event) => {
	const cell = event.target.closest('.board-cell[data-cell]');
	if (!cell || !state || !state.active || !state.pendingPiece) {
		return;
	}

	const piece = state.board[Number(cell.dataset.cell)];
	if (piece && piece.id === state.currentPiece.id) {
		continueToNextPiece();
	}
});
document.querySelector('#continue-piece-button').addEventListener('click', continueToNextPiece);
document.querySelector('#move-piece-button').addEventListener('click', moveLastPiece);
document.querySelector('#settings-button').addEventListener('click', openSettings);
document.querySelector('#overlay-close').addEventListener('click', () => {
	overlay.classList.add('hidden');
	if (state && state.active) {
		startTimer();
	}
});

updateHomeActions();
