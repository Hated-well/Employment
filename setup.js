const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectDir = __dirname;
const logFile = path.join(projectDir, 'setup_log.txt');

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  fs.appendFileSync(logFile, line);
  process.stdout.write(line);
}

log('Starting setup script...');
log(`CWD: ${projectDir}`);

// Check if node_modules exists
if (!fs.existsSync(path.join(projectDir, 'node_modules'))) {
  log('node_modules not found, starting npm install...');
  try {
    const result = execSync('npm install express multer nodemailer cors dotenv express-rate-limit --no-audit --no-fund 2>&1', {
      cwd: projectDir,
      encoding: 'utf8',
      timeout: 300000,
      stdio: 'pipe'
    });
    log(`npm install stdout:\n${result}`);
  } catch (err) {
    log(`npm install FAILED:\n${err.message}`);
    if (err.stdout) log(`stdout: ${err.stdout}`);
    if (err.stderr) log(`stderr: ${err.stderr}`);
    process.exit(1);
  }
} else {
  log('node_modules already exists, skipping npm install');
}

// Verify packages
const packages = ['express', 'multer', 'nodemailer', 'cors', 'dotenv', 'express-rate-limit'];
for (const pkg of packages) {
  try {
    require.resolve(pkg, { paths: [projectDir] });
    log(`PACKAGE OK: ${pkg}`);
  } catch (e) {
    log(`PACKAGE MISSING: ${pkg} - ${e.message.split('\n')[0]}`);
    process.exit(1);
  }
}

log('All packages installed successfully.');
log('Setup complete.');
