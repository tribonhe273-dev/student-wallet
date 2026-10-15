@echo off
setlocal
cd /d "%~dp0"
echo ================================================
echo  Vi Sinh Vien V2 Premium - rebuild Docker app
echo ================================================
echo.
where docker >nul 2>nul
if errorlevel 1 (
  echo [LOI] Khong tim thay Docker. Hay mo Docker Desktop truoc.
  pause
  exit /b 1
)
if not exist ".env" (
  echo Tao file .env va khoa bi mat rieng cho ung dung...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$bytes = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); $secret = [Convert]::ToBase64String($bytes); @('SECRET_KEY=' + $secret,'APP_ENV=production','COOKIE_SECURE=0') | Set-Content -Encoding ASCII '.env'"
  if errorlevel 1 (
    echo [LOI] Khong tao duoc .env. Hay sao chep .env.example thanh .env va dat SECRET_KEY.
    pause
    exit /b 1
  )
)
echo [1/3] Dung container cu (khong xoa du lieu)...
docker compose down
if errorlevel 1 (
  echo [LOI] Khong the dung Compose. Kiem tra Docker Desktop.
  pause
  exit /b 1
)
REM Remove only the app container if it was created from another Compose folder.
REM This does not remove the named database volume.
docker rm -f chi-tieu-sinh-vien >nul 2>nul
echo [2/3] Build lai image tu source giao dien moi...
docker compose build --no-cache
if errorlevel 1 (
  echo [LOI] Build that bai. Hay kiem tra ket noi mang va log loi phia tren.
  pause
  exit /b 1
)
echo [3/3] Khoi dong container...
docker compose up -d --force-recreate
if errorlevel 1 (
  echo [LOI] Khong the khoi dong container.
  pause
  exit /b 1
)
echo.
echo Hoan tat. Mo http://localhost:8080 va nhan Ctrl+F5 de tai lai giao dien.
echo Du lieu trong Docker volume duoc giu lai; khong chay lenh down -v.
pause
