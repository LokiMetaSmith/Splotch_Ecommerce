#!/bin/bash

# Test script for server/cli.js

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Test Setup ---
CLI_PATH="server/cli.js"
DB_PATH="server/test-db.json"
TEST_USER="clitestuser"
TEST_PASS="password123"

# Ensure we are in the project root
if [ ! -f "$CLI_PATH" ]; then
    echo "Error: This script must be run from the project root directory."
    exit 1
fi

# Point the CLI to our test database by temporarily renaming it.
# This is a simple way to isolate the test environment.
mv server/db.json "$DB_PATH" 2>/dev/null || true # Ignore error if it doesn't exist

echo "--- Running CLI Tests ---"

# --- Helper Functions ---
cleanup() {
    echo "--- Cleaning up ---"
    # Restore the original database and remove the test one.
    rm "$DB_PATH"
    mv "$DB_PATH" server/db.json 2>/dev/null || true
}

# Register the cleanup function to be called on script exit.
trap cleanup EXIT

# --- Test Cases ---

echo "[TEST] Add a new user"
node "$CLI_PATH" add-user "$TEST_USER" "$TEST_PASS" | grep "User $TEST_USER added successfully"
echo "PASS"

echo "[TEST] List users and verify new user exists"
node "$CLI_PATH" list-users | grep "$TEST_USER"
echo "PASS"

echo "[TEST] Check that 'add-key' command shows the informational message"
node "$CLI_PATH" add-key "$TEST_USER" | grep "Please use the web interface"
echo "PASS"

echo "[TEST] Manually add a fake credential to the database for testing 'remove-key'"
# This is necessary because add-key is not supported via the CLI.
# We will use node to programmatically edit the test-db.json file.
node -e "
const fs = require('fs');
const dbPath = '$DB_PATH';
const db = JSON.parse(fs.readFileSync(dbPath));
const fakeCredential = {
    credentialID: 'fake-cred-id-for-cli-test',
    credentialPublicKey: 'some-public-key',
    counter: 0
};
db.users['$TEST_USER'].credentials.push(fakeCredential);
db.credentials[fakeCredential.credentialID] = fakeCredential;
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
console.log('Fake credential added.');
"
echo "PASS"

echo "[TEST] Remove the fake credential using the 'remove-key' command"
node "$CLI_PATH" remove-key "$TEST_USER" "fake-cred-id-for-cli-test" | grep "Credential fake-cred-id-for-cli-test removed successfully"
echo "PASS"

echo "[TEST] Remove the test user"
node "$CLI_PATH" remove-user "$TEST_USER" | grep "User $TEST_USER removed successfully"
echo "PASS"

echo "--- All CLI tests passed! ---"
