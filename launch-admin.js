const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const logFile = path.join(__dirname, 'admin_launch_log.txt');
fs.writeFileSync(logFile, '');
function log(m) { const l = `[${new Date().toISOString()}] ${m}\n`; fs.appendFileSync(logFile, l); console.log(l); }

const PORT = 8080;
log(`Killing any process on port ${PORT}...`);
try {
  const out = execSync(`netstat -ano | findstr LISTENING | findstr :${PORT}`, { encoding: 'utf8' }).trim();
  if (out) {
    const pids = new Set();
    out.split(/\r?\n/).forEach(line => {
      const parts = line.split(/\s+/).filter(Boolean);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) pids.add(pid);
    });
    for (const pid of pids) {
      try { execSync(`taskkill /F /PID ${pid}`, { encoding: 'utf8' }); log(`Killed PID ${pid}`); }
      catch (e) { log(`Could not kill ${pid}: ${e.message.split('\n')[0]}`); }
    }
  } else {
    log('No listeners on port ' + PORT);
  }
} catch (e) {
  log(`Clean pass: ${e.message.split('\n')[0]}`);
}

setTimeout(() => {
  log('Starting server.js...');
  const outLog = fs.openSync(path.join(__dirname, 'server_stdout.log'), 'a');
  const errLog = fs.openSync(path.join(__dirname, 'server_stderr.log'), 'a');
  const s = spawn('node', ['server.js'], {
    cwd: __dirname,
    detached: true,
    stdio: ['ignore', outLog, errLog],
    env: Object.assign({}, process.env, { PORT }),
    windowsHide: false
  });
  s.on('close', (code) => log(`Server exited with ${code}`));
  s.unref();

  let attempts = 0;
  function health() {
    attempts++;
    if (attempts > 30) { log('Server failed to start after 30 attempts'); return; }
    const req = http.get(`http://localhost:${PORT}/api/health`, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        log(`Health OK: HTTP ${res.statusCode} - ${d.trim()}`);
      });
    });
    req.on('error', () => {
      setTimeout(health, 500);
    });
    req.setTimeout(1500, () => { req.destroy(); setTimeout(health, 500); });
  }
  setTimeout(health, 1200);
}, 1500);
