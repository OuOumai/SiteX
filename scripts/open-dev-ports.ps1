# SiteX — Open Development Ports for LAN Phone Testing
# Run this script ONCE as Administrator.
# It opens ports 8081 (Expo Metro bundler) and 5000 (Express backend) 
# so your phone on the same WiFi can connect without a tunnel.

Write-Host "Opening SiteX development ports in Windows Firewall..." -ForegroundColor Cyan

# Port 8081 — Expo Metro Bundler (JS bundle served to phone)
netsh advfirewall firewall show rule name="SiteX Metro Port 8081" >$null 2>&1
if ($LASTEXITCODE -ne 0) {
    netsh advfirewall firewall add rule `
        name="SiteX Metro Port 8081" `
        dir=in `
        action=allow `
        protocol=TCP `
        localport=8081
    Write-Host "  Port 8081 (Metro bundler) -- OPENED" -ForegroundColor Green
} else {
    Write-Host "  Port 8081 (Metro bundler) -- already open" -ForegroundColor Yellow
}

# Port 5000 — Express Backend API
netsh advfirewall firewall show rule name="SiteX API Port 5000" >$null 2>&1
if ($LASTEXITCODE -ne 0) {
    netsh advfirewall firewall add rule `
        name="SiteX API Port 5000" `
        dir=in `
        action=allow `
        protocol=TCP `
        localport=5000
    Write-Host "  Port 5000 (API backend)   -- OPENED" -ForegroundColor Green
} else {
    Write-Host "  Port 5000 (API backend)   -- already open" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done! Now run:  npm run mobile" -ForegroundColor Cyan
Write-Host "Metro reachable at: http://192.168.1.155:8081" -ForegroundColor Gray
Write-Host "Backend reachable at: http://192.168.1.155:5000" -ForegroundColor Gray
