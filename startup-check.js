const fs = require('fs');
const path = require('path');
require('dotenv').config();

const ROOT = process.cwd();
const envPath = path.join(ROOT, '.env');
const envExamplePath = path.join(ROOT, '.env.example');
const requiredEnv = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];

function logStatus(name, ok, message) {
  const symbol = ok ? '✅' : '❌';
  console.log(`${symbol} ${name}: ${message}`);
}

async function healthCheck(url) {
  try {
    const response = await fetch(url, { method: 'GET' });
    return { ok: response.ok, status: response.status, text: await response.text() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

(async () => {
  console.log('CRM Startup Health Check');
  console.log('========================\n');

  const envExampleExists = fs.existsSync(envExamplePath);
  const envExists = fs.existsSync(envPath);
  const missingVars = requiredEnv.filter((key) => !process.env[key]);

  logStatus('.env.example', envExampleExists, envExampleExists ? 'found' : 'not found');
  logStatus('.env', envExists, envExists ? 'found' : 'not found');
  if (!envExists) {
    console.warn('⚠️  Warning: .env is missing. The backend will run in SMTP-missing mode.');
  }
  if (missingVars.length) {
    console.warn(`⚠️  Missing env vars: ${missingVars.join(', ')}. Create .env from .env.example.`);
  }

  const checks = [
    { name: 'Frontend', url: 'http://127.0.0.1:8000/' },
    { name: 'Backend health', url: 'http://127.0.0.1:3001/api/health' }
  ];

  let failure = false;
  for (const check of checks) {
    const result = await healthCheck(check.url);
    if (result.ok) {
      logStatus(check.name, true, `${check.url} responded ${result.status}`);
      if (check.name === 'Backend health') {
        try {
          const body = JSON.parse(result.text);
          if (body.status === 'smtp-missing') {
            console.warn('⚠️  Backend is running, but SMTP is not configured. Email sending will fallback to mailto.');
          }
        } catch (e) {
          console.warn('⚠️  Backend health returned non-JSON response.');
        }
      }
    } else {
      logStatus(check.name, false, result.error || `HTTP ${result.status}`);
      failure = true;
    }
  }

  console.log('\nSummary:');
  if (failure) {
    console.error('❌ One or more services failed to respond. Start the backend and frontend, then retry.');
    process.exit(1);
  }

  console.log('✅ Startup check passed. Frontend and backend services are reachable.');
  process.exit(0);
})();
