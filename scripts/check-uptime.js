#!/usr/bin/env node

// Note: Uses native fetch in Node 18+
const url = process.argv[2] || 'http://localhost:3000/api/ping';
const intervalMs = parseInt(process.argv[3], 10) || 5000;

console.log(`Starting uptime check for ${url} every ${intervalMs}ms...`);

let totalChecks = 0;
let successfulChecks = 0;
let failedChecks = 0;
let consecutiveFailures = 0;

async function checkUptime() {
    totalChecks++;
    const start = Date.now();
    try {
        const response = await fetch(url, { method: 'GET', timeout: 5000 });
        const latency = Date.now() - start;

        if (response.ok) {
            successfulChecks++;
            consecutiveFailures = 0;
            const data = await response.json();
            console.log(`[${new Date().toISOString()}] ✅ UP - Latency: ${latency}ms, Response: ${JSON.stringify(data)}`);
        } else {
            failedChecks++;
            consecutiveFailures++;
            console.log(`[${new Date().toISOString()}] ⚠️ ERROR - Status Code: ${response.status}`);
        }
    } catch (error) {
        failedChecks++;
        consecutiveFailures++;
        console.log(`[${new Date().toISOString()}] ❌ DOWN - Error: ${error.message}`);
    }

    const uptimePercent = ((successfulChecks / totalChecks) * 100).toFixed(2);
    console.log(`   Stats: ${uptimePercent}% Uptime | Total: ${totalChecks} | Success: ${successfulChecks} | Failed: ${failedChecks}`);
}

// Initial check
checkUptime();

// Schedule subsequent checks
setInterval(checkUptime, intervalMs);

// Handle exit gracefully
process.on('SIGINT', () => {
    console.log('\nStopping uptime monitor...');
    const uptimePercent = ((successfulChecks / totalChecks) * 100).toFixed(2);
    console.log(`Final Stats: ${uptimePercent}% Uptime | Total: ${totalChecks} | Success: ${successfulChecks} | Failed: ${failedChecks}`);
    process.exit(0);
});
