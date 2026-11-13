const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

function getLanIp() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    const lowerName = name.toLowerCase();

    // Ignore virtual / loopback / bluetooth / Hyper-V / WSL adapters
    if (
      lowerName.includes('virtualbox') ||
      lowerName.includes('vbox') ||
      lowerName.includes('vmware') ||
      lowerName.includes('vethernet') ||
      lowerName.includes('wsl') ||
      lowerName.includes('loopback') ||
      lowerName.includes('bluetooth')
    ) {
      continue;
    }

    for (const addr of addrs || []) {
      if (
        addr.family === 'IPv4' &&
        !addr.internal &&
        !addr.address.startsWith('169.254.') && // Link-local
        !addr.address.startsWith('192.168.56.')  // VirtualBox host-only subnet
      ) {
        const isWifi = lowerName.includes('wi-fi') || lowerName.includes('wifi') || lowerName.includes('wireless');
        candidates.push({
          name,
          address: addr.address,
          priority: isWifi ? 1 : 2
        });
      }
    }
  }

  // Sort Wi-Fi first, then other physical interfaces
  candidates.sort((a, b) => a.priority - b.priority);

  return candidates.length > 0 ? candidates[0].address : null;
}

const passArgs = process.argv.slice(2);
const isTunnel = passArgs.some((arg) => arg === '--tunnel' || arg === 'tunnel');

console.log('\n==================================================');
console.log('  🚀 SiteX Mobile Dev Launcher');
console.log('==================================================');

if (isTunnel) {
  delete process.env.REACT_NATIVE_PACKAGER_HOSTNAME;
  console.log('🚇 Starting Expo in TUNNEL mode (bypasses router isolation)...');
} else {
  const lanIp = getLanIp();
  if (lanIp) {
    process.env.REACT_NATIVE_PACKAGER_HOSTNAME = lanIp;
    console.log(`📡 Detected Wi-Fi / LAN IP: \x1b[32m${lanIp}\x1b[0m`);
    console.log(`🔗 Metro bundler URL: \x1b[36mexp://${lanIp}:8081\x1b[0m`);
  } else {
    console.warn('⚠️  Could not auto-detect Wi-Fi IP. Defaulting to Expo default.');
  }
}

console.log('==================================================\n');

// Auto-launch backend server if not already listening on port 5000
const serverScript = path.join(__dirname, '..', 'server', 'src', 'server.js');
let backendProcess = null;

function ensureBackendRunning() {
  const socket = net.createConnection({ port: 5000, host: '127.0.0.1' }, () => {
    socket.destroy();
    console.log('✅ SiteX Backend already active on port 5000\n');
  });

  socket.on('error', () => {
    console.log('🚀 Auto-starting SiteX Backend (server/src/server.js on port 5000)...');
    backendProcess = spawn(process.execPath, [serverScript], {
      cwd: path.join(__dirname, '..', 'server'),
      stdio: 'inherit',
      env: process.env,
    });
    backendProcess.on('error', (err) => {
      console.error('❌ Failed to launch backend:', err.message);
    });
  });
}

ensureBackendRunning();

const expoCli = path.join(__dirname, '..', 'node_modules', 'expo', 'bin', 'cli');

const expoProcess = spawn(process.execPath, [expoCli, 'start', ...passArgs], {
  stdio: 'inherit',
  env: process.env
});

expoProcess.on('exit', (code) => {
  if (backendProcess) {
    try { backendProcess.kill(); } catch (_) {}
  }
  process.exit(code ?? 0);
});
