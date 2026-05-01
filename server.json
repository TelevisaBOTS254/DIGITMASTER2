// server.js – Higher/Lower Dual Bot on a fixed schedule
const WebSocket = require('ws');
const http = require('http');

// ---------- Configuration (set in Railway environment) ----------
const TOKEN  = process.env.DERIV_TOKEN || '';
const SYMBOL = process.env.SYMBOL     || 'R_10';
const STAKE  = parseFloat(process.env.STAKE  || '1');
const OFFSET = process.env.OFFSET     || '0.06';
const INTERVAL_SEC = parseInt(process.env.INTERVAL_SEC || '60'); // schedule interval

// ---------- WebSocket & state ----------
let ws = null;
let latestSpot = null;    // always holds the most recent tick price

// ---------- HTTP health server ----------
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is running on fixed schedule');
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

    // Keep latestSpot always up‑to‑date
    if (msg.msg_type === 'tick') {
      latestSpot = msg.tick.quote;
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

// ---------- Fixed schedule: fire exactly every INTERVAL_SEC seconds ----------
function startScheduler() {
  setInterval(() => {
    // Only trade if we have a valid price (ticks have started arriving)
    if (latestSpot === null) {
      log('⏳ No tick received yet – skipping trade this cycle');
      return;
    }

    // Round to 2 decimals as required by Deriv API
    const entryPrice = Math.round(parseFloat(latestSpot) * 100) / 100;
    log(`⏰ Scheduled trade – Spot: ${latestSpot} → Entry: ${entryPrice}`);

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

  // Higher
  ws.send(JSON.stringify({
    buy: 1,
    price: entryPrice,
    parameters: { ...base, contract_type: 'CALL', barrier: `+${OFFSET}` }
  }));

  // Lower
  ws.send(JSON.stringify({
    buy: 1,
    price: entryPrice,
    parameters: { ...base, contract_type: 'PUT', barrier: `-${OFFSET}` }
  }));
}

// ---------- Start everything ----------
if (!TOKEN) {
  log('❌ DERIV_TOKEN missing. Exiting.');
  process.exit(1);
}

connect();
startScheduler(); // the scheduler runs independently of connection state
