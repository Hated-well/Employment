const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const logFile = path.join(__dirname, 'admin_install_log.txt');
fs.writeFileSync(logFile, '');
function log(m) { const l = `[${new Date().toISOString()}] ${m}\n`; fs.appendFileSync(logFile, l); console.log(l); }

log('Installing express-session + bcryptjs...');
try {
  const r = execSync('npm install express-session bcryptjs --no-audit --no-fund 2>&1', { cwd: __dirname, encoding: 'utf8', timeout: 300000, stdio: 'pipe' });
  log(r);
} catch (e) {
  log(`INSTALL ERR: ${e.message}`);
  if (e.stdout) log(e.stdout.toString());
  if (e.stderr) log(e.stderr.toString());
  process.exit(1);
}

for (const p of ['express-session', 'bcryptjs']) {
  try { require.resolve(p, { paths: [__dirname] }); log(`VERIFIED OK: ${p}`); }
  catch (e) { log(`VERIFY FAIL: ${p} - ${e.message.split('\n')[0]}`); process.exit(1); }
}
log('DONE');
