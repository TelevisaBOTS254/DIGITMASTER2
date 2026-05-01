// server.js – Higher/Lower Dual Bot on fixed schedule, only during high volatility
const WebSocket = require('ws');
const http = require('http');

// ---------- Configuration (set in Railway environment) ----------
const TOKEN  = process.env.DERIV_TOKEN || '';
const SYMBOL = process.env.SYMBOL     || 'R_10';
const STAKE  = parseFloat(process.env.STAKE  || '1');
const OFFSET = process.env.OFFSET     || '0.06';
const INTERVAL_SEC = parseInt(process.env.INTERVAL_SEC || '60');

// Volatility analysis settings
const VOLATILITY_THRESHOLD = parseFloat(process.env.VOLATILITY_THRESHOLD || '0.02'); // standard deviation threshold
const TICK_BUFFER_SIZE     = parseInt(process.env.TICK_BUFFER_SIZE || '30');        // number of recent ticks to use
const MIN_TICKS_REQUIRED   = parseInt(process.env.MIN_TICKS_REQUIRED || '20');     // how many ticks needed before trading

// ---------- WebSocket & state ----------
let ws = null;
let latestSpot = null;        // most recent tick price
let tickBuffer = [];          // rolling array of recent tick prices (number)

// ---------- HTTP health server ----------
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is running with volatility filter');
}).listen(PORT, () => {
  console.log(`Health check on port ${PORT}`);
});

// ---------- Logging ----------
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ---------- Connect & auto‑reconnect ----------
function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  log('Connecting to Deriv...');
  ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');

  ws.on('open', () => {
    log('Connected. Authorizing...');
    ws.send(JSON.stringify({ authorize: TOKEN }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    // Authorization
    if (msg.msg_type === 'authorize') {
      if (msg.error) {
        log(`❌ Auth failed: ${msg.error.message}`);
        setTimeout(connect, 10000);
        return;
      }
      log('✅ Authorized. Subscribing to continuous ticks...');
      ws.send(JSON.stringify({ ticks: SYMBOL }));
    }

    // Tick handler – update latestSpot and rolling buffer
    if (msg.msg_type === 'tick') {
      const spot = parseFloat(msg.tick.quote);
      latestSpot = spot;

      // Maintain rolling buffer
      tickBuffer.push(spot);
      if (tickBuffer.length > TICK_BUFFER_SIZE) {
        tickBuffer.shift(); // remove oldest
      }
    }

    // Trade confirmation
    if (msg.msg_type === 'buy') {
      if (msg.error) {
        log(`❌ Trade Error: ${msg.error.message}`);
      } else {
        log(`✅ Trade placed: ${msg.buy.transaction_id}`);
      }
    }
  });

  ws.on('close', () => {
    log('❌ WebSocket closed. Reconnecting in 10s...');
    setTimeout(connect, 10000);
  });

  ws.on('error', (err) => {
    log(`❌ WebSocket error: ${err.message}`);
    ws.close();
  });
}

// ---------- Fixed schedule: fire at intervals, but only if volatile ----------
function startScheduler() {
  setInterval(() => {
    // 1. Do we have a current price?
    if (latestSpot === null) {
      log('⏳ No tick yet – skipping trade');
      return;
    }

    // 2. Do we have enough ticks for analysis?
    if (tickBuffer.length < MIN_TICKS_REQUIRED) {
      log(`⏳ Not enough ticks (${tickBuffer.length}/${MIN_TICKS_REQUIRED}) – skipping`);
      return;
    }

    // 3. Calculate standard deviation
    const mean = tickBuffer.reduce((sum, v) => sum + v, 0) / tickBuffer.length;
    const sqDiffs = tickBuffer.map(v => (v - mean) ** 2);
    const variance = sqDiffs.reduce((sum, v) => sum + v, 0) / tickBuffer.length;
    const stdDev = Math.sqrt(variance);

    log(`📊 Volatility (std dev): ${stdDev.toFixed(6)} | Threshold: ${VOLATILITY_THRESHOLD}`);

    // 4. Decide
    if (stdDev < VOLATILITY_THRESHOLD) {
      log('😴 Volatility too low – skipping trade');
      return;
    }

    // 5. Fire trade pair
    const entryPrice = Math.round(latestSpot * 100) / 100;
    log(`⚡ High volatility! Entry: ${entryPrice}`);
    placeContracts(entryPrice);

  }, INTERVAL_SEC * 1000);
}

// ---------- Place one Higher + one Lower contract ----------
function placeContracts(entryPrice) {
  const base = {
    symbol: SYMBOL,
    duration: 5,
    duration_unit: 't',
    basis: 'stake',
    currency: 'USD',
    amount: STAKE
  };

  ws.send(JSON.stringify({
    buy: 1,
    price: entryPrice,
    parameters: { ...base, contract_type: 'CALL', barrier: `+${OFFSET}` }
  }));

  ws.send(JSON.stringify({
    buy: 1,
    price: entryPrice,
    parameters: { ...base, contract_type: 'PUT', barrier: `-${OFFSET}` }
  }));
}

// ---------- Start ----------
if (!TOKEN) {
  log('❌ DERIV_TOKEN missing. Exiting.');
  process.exit(1);
}

connect();
startScheduler();
