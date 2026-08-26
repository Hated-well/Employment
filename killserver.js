const { execSync } = require('child_process');
try {
  execSync('taskkill /F /PID 11892 2>nul', { stdio: 'ignore' });
  console.log('Killed PID 11892');
} catch (e) { console.log('No kill needed'); }
