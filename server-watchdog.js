const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJ = __dirname;
const PORT = 8080;
const SERVER = path.join(PROJ, 'server.js');
const WATCHDOG_LOG = path.join(PROJ, 'watchdog.log');
const STDOUT_LOG = path.join(PROJ, 'server_stdout.log');
const STDERR_LOG = path.join(PROJ, 'server_stderr.log');

function log(m) {
  const line = `[${new Date().toISOString()}] ${m}\n`;
  try { fs.appendFileSync(WATCHDOG_LOG, line); } catch (_) {}
  process.stdout.write(line);
}

function killPortListeners(p) {
  try {
    const out = execSync(`netstat -ano | findstr LISTENING | findstr :${p}`, { encoding: 'utf8' }).trim();
    if (!out) return;
    const pids = new Set();
    out.split(/\r?\n/).forEach(line => {
      const parts = line.split(/\s+/).filter(Boolean);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) pids.add(pid);
    });
    for (const pid of pids) {
      try { execSync(`taskkill /F /PID ${pid}`, { encoding: 'utf8', stdio: 'pipe' }); log(`Killed old PID ${pid} on port ${p}`); }
      catch (e) { log(`taskkill ${pid} failed: ${e.message.split('\n')[0]}`); }
    }
  } catch (_) { /* no listeners */ }
}

log('====== WATCHDOG STARTING ======');
log(`Project dir: ${PROJ}`);
log(`Server entry: ${SERVER}`);

// Phase 1: kill any pre-existing listener on 8080 before first boot
log('Phase 1: cleaning port ' + PORT);
for (let i = 0; i < 3; i++) { killPortListeners(PORT); try { execSync('timeout /t 1 /nobreak >nul 2>&1', { stdio: 'pipe' }); } catch(_){} }

let child = null;
let exitCount = 0;
let lastLaunchAt = 0;

function startServer() {
  lastLaunchAt = Date.now();
  log(`Launching node ${SERVER}`);

  const outFd = fs.openSync(STDOUT_LOG, 'a');
  const errFd = fs.openSync(STDERR_LOG, 'a');
  fs.appendFileSync(STDOUT_LOG, `\n[${new Date().toISOString()}] ===== server boot #${exitCount+1} =====\n`);
  fs.appendFileSync(STDERR_LOG, `\n[${new Date().toISOString()}] ===== server boot #${exitCount+1} =====\n`);

  child = spawn(process.execPath, [SERVER], {
    cwd: PROJ,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', outFd, errFd]
  });

  child.on('error', (err) => log(`SPAWN ERROR: ${err.message}`));
  child.on('exit', (code, signal) => {
    exitCount++;
    const now = Date.now();
    const uptime = Math.round((now - lastLaunchAt) / 1000);
    log(`SERVER EXITED — code=${code} signal=${signal} uptime=${uptime}s (total exits: ${exitCount})`);
    child = null;
    // Clean port again in case zombie socket remained
    killPortListeners(PORT);
    // Backoff: if server dies within 10s, wait 5s to avoid spin-loop, otherwise 1s
    const backoff = uptime < 10 ? 5000 : 1000;
    log(`Restarting in ${backoff}ms ...`);
    setTimeout(startServer, backoff);
  });
}

// Keepalive: ensure THIS watchdog process NEVER exits (holds terminal open)
const aliveLog = setInterval(() => {
  log(`watchdog-keepalive — childRunning=${!!child} exitCount=${exitCount}`);
}, 60 * 1000);
aliveLog.unref(); // don't actually prevent graceful shutdown if explicitly killed
// But do hold event loop with a non-unrefed heartbeat that fires every 30 days (enough)
setInterval(() => {}, 2147483000).unref();

startServer();

// Graceful shutdown handlers: pass signal to child, keep watchdog alive until child exits
function shutdown(sig) {
  log(`Received ${sig}; propagating to child`);
  if (child && !child.killed) try { child.kill(sig); } catch(_){}
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => log(`WATCHDOG UNCAUGHT: ${e.message}\n${e.stack}`));
process.on('unhandledRejection', (r) => log(`WATCHDOG UNHANDLED_REJ: ${r && r.stack ? r.stack : r}`));

log('Watchdog initialized. Event loop held permanently.');
