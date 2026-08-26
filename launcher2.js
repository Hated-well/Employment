const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logFile = path.join(__dirname, 'launcher2_log.txt');
fs.writeFileSync(logFile, '');
function log(m) {
  const l = `[${new Date().toISOString()}] ${m}\n`;
  fs.appendFileSync(logFile, l);
  process.stdout.write(l);
}

// Kill anything on port 8080
try {
  if (process.platform === 'win32') {
    const netstat = execSync(`netstat -ano | findstr ":8080" | findstr LISTENING`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (netstat) {
      const pids = [...new Set(netstat.split('\n').map(l => l.trim().split(/\s+/).pop()).filter(p => /^\d+$/.test(p)))];
      for (const pid of pids) { log(`Killing ${pid}`); try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch(e){} }
    }
  }
} catch(e) {}

setTimeout(() => {
  log('Launching server...');
  const srv = spawn('node', ['server.js'], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    windowsHide: false
  });
  srv.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => log(`OUT ${l}`)));
  srv.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => log(`ERR ${l}`)));
  srv.unref();

  setTimeout(() => {
    const http = require('http');
    http.get('http://localhost:8080/api/health', res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => log(`HEALTH ${res.statusCode}: ${b}`));
    }).on('error', e => log(`HEALTH-ERR: ${e.message}`));
  }, 3500);
}, 2500);
