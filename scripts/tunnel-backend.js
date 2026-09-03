#!/usr/bin/env node
/**
 * scripts/tunnel-backend.js
 *
 * Starts a localtunnel for the backend (port 5000) and:
 *  1. Prints the public URL
 *  2. Automatically writes EXPO_PUBLIC_API_URL=<url> into the root .env file
 *
 * Usage: node scripts/tunnel-backend.js
 *   (or via npm run tunnel-backend)
 *
 * After it prints the URL and updates .env, restart Expo with:
 *   npx expo start --clear
 */

const localtunnel = require('localtunnel');
const fs = require('fs');
const path = require('path');

const PORT = 5000;
const ENV_FILE = path.join(__dirname, '..', '.env');

function updateEnvFile(url) {
  let content = '';
  if (fs.existsSync(ENV_FILE)) {
    content = fs.readFileSync(ENV_FILE, 'utf8');
  }

  if (content.includes('EXPO_PUBLIC_API_URL=')) {
    // Replace existing line
    content = content.replace(/^EXPO_PUBLIC_API_URL=.*/m, `EXPO_PUBLIC_API_URL=${url}`);
  } else {
    // Append new line
    content = content.trimEnd() + `\nEXPO_PUBLIC_API_URL=${url}\n`;
  }

  fs.writeFileSync(ENV_FILE, content, 'utf8');
  console.log(`\n✅ .env updated: EXPO_PUBLIC_API_URL=${url}`);
  console.log('\n👉 Now run in a NEW terminal:');
  console.log('     npx expo start --clear\n');
}

(async () => {
  console.log(`\n🚇 Starting localtunnel for backend port ${PORT}...`);

  try {
    const tunnel = await localtunnel({ port: PORT });

    console.log(`\n🌐 Backend tunnel URL: ${tunnel.url}`);
    updateEnvFile(tunnel.url);

    tunnel.on('close', () => {
      console.log('\n⚠️  Tunnel closed. Revert .env if needed.');
    });

    tunnel.on('error', (err) => {
      console.error('\n❌ Tunnel error:', err.message);
    });

    // Keep process alive
    console.log('⏳ Tunnel is active. Press Ctrl+C to stop.\n');
    process.on('SIGINT', () => {
      console.log('\n🛑 Stopping tunnel...');
      tunnel.close();
      process.exit(0);
    });
  } catch (err) {
    console.error('\n❌ Failed to start tunnel:', err.message);
    process.exit(1);
  }
})();
