const { execSync } = require('child_process');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'launcher_log.txt');
fs.writeFileSync(logFile, '');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logFile, line);
  process.stdout.write(line);
}

function killPort(port) {
  try {
    log(`Attempting to free port ${port}...`);
    if (process.platform === 'win32') {
      const netstat = execSync(`netstat -ano | findstr ":${port}" | findstr LISTENING`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (netstat) {
        log(`Found listeners:\n${netstat}`);
        const lines = netstat.split('\n').filter(l => l.trim());
        const pids = [...new Set(lines.map(l => l.trim().split(/\s+/).pop()).filter(p => /^\d+$/.test(p)))];
        for (const pid of pids) {
          log(`Killing PID ${pid}...`);
          try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); }
          catch (e) { log(`Kill pid ${pid} error: ${e.message.split('\n')[0]}`); }
        }
      } else {
        log(`No process listening on port ${port}`);
      }
    }
  } catch (e) {
    log(`killPort error (non-fatal): ${e.message.split('\n')[0]}`);
  }
}

killPort(3000);

setTimeout(() => {
  log('Starting server on port 3000...');
  const server = spawn('node', ['server.js'], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });

  server.unref();

  server.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => log(`SERV-OUT: ${l}`)));
  server.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => log(`SERV-ERR: ${l}`)));
  server.on('close', code => log(`Server closed with code ${code}`));

  setTimeout(() => log(`Launched server PID=${server.pid}`), 100);
  setTimeout(() => {
    const http = require('http');
    http.get('http://localhost:3000/api/health', res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => log(`HEALTH CHECK (${res.statusCode}): ${body}`));
    }).on('error', e => log(`HEALTH CHECK ERROR: ${e.message}`));
  }, 3000);
}, 2000);
