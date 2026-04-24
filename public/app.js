const socket = io();

const els = {
  connectionBadge: document.getElementById('connectionBadge'),
  quote: document.getElementById('quote'),
  lastDigitBig: document.getElementById('lastDigitBig'),
  symbolPill: document.getElementById('symbolPill'),
  botStatusPill: document.getElementById('botStatusPill'),

  signalBanner: document.getElementById('signalBanner'),
  signalTitle: document.getElementById('signalTitle'),
  signalSub: document.getElementById('signalSub'),

  pnl: document.getElementById('pnl'),
  stake: document.getElementById('stake'),
  wins: document.getElementById('wins'),
  losses: document.getElementById('losses'),

  stepIndex: document.getElementById('stepIndex'),
  cooldown: document.getElementById('cooldown'),
  tradeState: document.getElementById('tradeState'),
  sessionState: document.getElementById('sessionState'),
  sessionLabel: document.getElementById('sessionLabel'),
  sessionBadge: document.getElementById('sessionBadge'),

  digitPad: document.getElementById('digitPad'),
  historyRow: document.getElementById('historyRow'),
  logs: document.getElementById('logs')
};

let latestState = {
  running: false,
  inTrade: false,
  pnl: 0,
  wins: 0,
  losses: 0,
  stepIndex: 0,
  stake: 0,
  history: [],
  statsBuffer: [],
  quote: null,
  lastDigit: null,
  pipSize: 2,
  symbol: 'R_100',
  cooldown: 0,
  session: {
    withinWindow: false,
    canTradeNow: false,
    hasTradedToday: false,
    label: '10:00 - 10:30'
  }
};

function money(v) {
  return `$${Number(v || 0).toFixed(2)}`;
}

function formatQuote(v, pipSize = 2) {
  if (v === null || v === undefined) return '--';
  return Number(v).toFixed(pipSize);
}

function getCounts(buffer) {
  const counts = Array(10).fill(0);
  (buffer || []).forEach((d) => {
    if (typeof d === 'number' && d >= 0 && d <= 9) counts[d]++;
  });
  return counts;
}

function digitPercent(buffer, digit) {
  const total = (buffer || []).length;
  if (!total) return 0;
  let count = 0;
  buffer.forEach((d) => {
    if (d === digit) count++;
  });
  return (count / total) * 100;
}

function getBotStatus(state) {
  if (!state.running) return 'Stopped';
  if (state.inTrade) return 'In Trade';
  return 'Scanning';
}

function getTradeState(state) {
  if (!state.running) return 'Idle';
  if (state.inTrade) return 'Active';
  if (state.cooldown > 0) return 'Cooldown';
  return 'Ready';
}

function renderDigitPad(state) {
  const counts = getCounts(state.statsBuffer);
  const total = state.statsBuffer?.length || 0;

  els.digitPad.innerHTML = '';

  for (let digit = 0; digit <= 9; digit++) {
    const pct = total ? (counts[digit] / total) * 100 : 0;
    const isActive = digit === state.lastDigit;
    const isStrategy = digit === 0 || digit === 1;

    const tile = document.createElement('div');
    tile.className = `digit-tile ${isActive ? 'active' : ''} ${isStrategy ? 'strategy' : ''}`;

    tile.innerHTML = `
      <div class="digit-top">
        <div class="digit-number">${digit}</div>
        ${isStrategy ? '<div class="digit-badge">ENTRY</div>' : ''}
      </div>
      <div class="digit-percent">${pct.toFixed(1)}%</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${Math.min(pct, 100)}%"></div>
      </div>
    `;

    els.digitPad.appendChild(tile);
  }
}

function renderHistory(state) {
  els.historyRow.innerHTML = '';

  const history = state.history || [];
  if (!history.length) {
    const chip = document.createElement('div');
    chip.className = 'history-chip';
    chip.textContent = '--';
    els.historyRow.appendChild(chip);
    return;
  }

  [...history].reverse().forEach((digit) => {
    const chip = document.createElement('div');
    chip.className = 'history-chip';
    chip.textContent = digit;
    els.historyRow.appendChild(chip);
  });
}

function renderSignal(state) {
  const total = state.statsBuffer?.length || 0;
  const pct0 = digitPercent(state.statsBuffer || [], 0);
  const pct1 = digitPercent(state.statsBuffer || [], 1);
  const digitReady = state.lastDigit === 0 || state.lastDigit === 1;
  const underThreshold = pct0 < 10.5 && pct1 < 10.5;
  const inSession = !!state.session?.canTradeNow;

  els.signalBanner.className = 'signal-banner';

  if (total < 100) {
    els.signalBanner.classList.add('waiting');
    els.signalTitle.textContent = 'Collecting data...';
    els.signalSub.textContent = `${total}/100 ticks loaded`;
    return;
  }

  if (!state.running) {
    els.signalBanner.classList.add('blocked');
    els.signalTitle.textContent = 'Bot stopped';
    els.signalSub.textContent = 'Waiting for reconnect or stop condition reset';
    return;
  }

  if (state.inTrade) {
    els.signalBanner.classList.add('ready');
    els.signalTitle.textContent = 'Trade active';
    els.signalSub.textContent = `Current stake ${money(state.stake)}`;
    return;
  }

  if (state.cooldown > 0) {
    els.signalBanner.classList.add('blocked');
    els.signalTitle.textContent = 'Cooldown active';
    els.signalSub.textContent = `${state.cooldown} ticks remaining`;
    return;
  }

  if (!inSession) {
    els.signalBanner.classList.add('blocked');
    els.signalTitle.textContent = 'Outside session window';
    els.signalSub.textContent = `Trade time ${state.session?.label || '--'}`;
    return;
  }

  if (digitReady && underThreshold) {
    els.signalBanner.classList.add('ready');
    els.signalTitle.textContent = 'Entry conditions matched';
    els.signalSub.textContent = `Digit ${state.lastDigit} | %0 ${pct0.toFixed(1)} | %1 ${pct1.toFixed(1)}`;
    return;
  }

  els.signalBanner.classList.add('waiting');
  els.signalTitle.textContent = 'Scanning for entry';
  els.signalSub.textContent = `Need digit 0/1 with low frequency | %0 ${pct0.toFixed(1)} | %1 ${pct1.toFixed(1)}`;
}

function renderState(state) {
  latestState = state;

  els.quote.textContent = formatQuote(state.quote, state.pipSize);
  els.lastDigitBig.textContent = state.lastDigit ?? '--';
  els.symbolPill.textContent = state.symbol || 'R_100';
  els.botStatusPill.textContent = getBotStatus(state);
  els.botStatusPill.className = `pill ${state.running ? '' : 'pill-muted'}`;

  els.pnl.textContent = money(state.pnl);
  els.pnl.className =
    'stat-value ' + (state.pnl > 0 ? 'positive' : state.pnl < 0 ? 'negative' : 'neutral');

  els.stake.textContent = money(state.stake);
  els.wins.textContent = state.wins ?? 0;
  els.losses.textContent = state.losses ?? 0;

  els.stepIndex.textContent = `${(state.stepIndex ?? 0) + 1} / 5`;
  els.cooldown.textContent = state.cooldown ?? 0;
  els.tradeState.textContent = getTradeState(state);
  els.sessionState.textContent = state.session?.withinWindow ? 'Open' : 'Closed';
  els.sessionLabel.textContent = state.session?.label || '--';

  els.sessionBadge.textContent = state.session?.canTradeNow ? 'Live Session' : 'Closed';
  els.sessionBadge.className = `session-badge ${state.session?.canTradeNow ? 'open' : 'closed'}`;

  renderSignal(state);
  renderDigitPad(state);
  renderHistory(state);
}

function addLog(entry) {
  const item = document.createElement('div');
  item.className = `log-item ${entry.level || 'info'}`;

  const t = new Date(entry.ts);
  const timeText = t.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  item.innerHTML = `
    <div class="log-time">${timeText}</div>
    <div class="log-message">${entry.message}</div>
  `;

  els.logs.prepend(item);

  while (els.logs.children.length > 30) {
    els.logs.removeChild(els.logs.lastChild);
  }
}

socket.on('connect', () => {
  els.connectionBadge.textContent = 'Live';
  els.connectionBadge.className = 'connection-badge online';
});

socket.on('disconnect', () => {
  els.connectionBadge.textContent = 'Offline';
  els.connectionBadge.className = 'connection-badge offline';
});

socket.on('update', (state) => {
  renderState(state);
});

socket.on('log', (entry) => {
  addLog(entry);
});

renderState(latestState);
