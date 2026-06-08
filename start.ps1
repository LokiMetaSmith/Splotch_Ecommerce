# Check if pnpm is installed
if (-not (Get-Command "pnpm" -ErrorAction SilentlyContinue)) {
    Write-Host "Error: pnpm is not installed." -ForegroundColor Red
    Write-Host "Please install it by running: npm install -g pnpm" -ForegroundColor Yellow
    exit 1
}

Write-Host "Installing root dependencies..."
pnpm install

Write-Host "Installing server dependencies..."
Push-Location server
pnpm install
Pop-Location

Write-Host "Starting backend server..."
$backendJob = Start-Job {
    Set-Location -Path (Join-Path $using:PWD "server")
    pnpm start
}

Write-Host "Starting frontend dev server..."
$frontendJob = Start-Job {
    Set-Location -Path $using:PWD
    pnpm dev
}

Write-Host "Servers started. Press Ctrl+C to stop."

try {
    # Keep the script running until manually terminated
    while ($true) {
        Start-Sleep -Seconds 1
    }
} finally {
    Write-Host "Stopping servers..."
    Stop-Job -Job $backendJob
    Remove-Job -Job $backendJob
    Stop-Job -Job $frontendJob
    Remove-Job -Job $frontendJob
}
