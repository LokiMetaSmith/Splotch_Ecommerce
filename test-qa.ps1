$backendJob = Start-Job {
    Set-Location -Path (Join-Path $using:PWD "server")
    npm start
}

# Wait for server to start
Start-Sleep -Seconds 5

try {
    Write-Host "Running Playwright Tests..."
    npx playwright test playwright_tests/qa_flow.spec.js
} finally {
    Write-Host "Stopping backend server..."
    Stop-Job -Job $backendJob
    Remove-Job -Job $backendJob
}
