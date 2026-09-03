@echo off
title SiteX - Open Development Firewall Ports
echo.
echo ============================================
echo  SiteX - Opening Development Firewall Ports
echo ============================================
echo.
echo This will open port 5000 (API) and 8081 (Metro)
echo so your phone can connect without a tunnel.
echo.

netsh advfirewall firewall add rule name="SiteX API Port 5000" dir=in action=allow protocol=TCP localport=5000
if %errorlevel% == 0 (
    echo [OK] Port 5000 (Express API) opened successfully.
) else (
    echo [SKIP] Port 5000 rule may already exist.
)

netsh advfirewall firewall add rule name="SiteX Metro Port 8081" dir=in action=allow protocol=TCP localport=8081
if %errorlevel% == 0 (
    echo [OK] Port 8081 (Expo Metro) opened successfully.
) else (
    echo [SKIP] Port 8081 rule may already exist.
)

echo.
echo ============================================
echo  DONE! You can now use: npm run mobile
echo  (no tunnel needed anymore)
echo ============================================
echo.
pause
