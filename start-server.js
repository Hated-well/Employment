const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const logFile = path.join(__dirname, 'server_log.txt');
fs.writeFileSync(logFile, '');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logFile, line);
  process.stdout.write(line);
}

log('Starting server process...');

const server = spawn('node', ['server.js'], {
  cwd: __dirname,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env
});

server.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(Boolean);
  lines.forEach(l => log(`STDOUT: ${l}`));
});

server.stderr.on('data', (data) => {
  const lines = data.toString().split('\n').filter(Boolean);
  lines.forEach(l => log(`STDERR: ${l}`));
});

server.on('close', (code) => {
  log(`Server process exited with code ${code}`);
});

server.on('error', (err) => {
  log(`Server error: ${err.message}`);
});

setTimeout(() => {
  log(`--- Server still running? pid=${server.pid} killed=${server.killed} ---`);
}, 5000);
