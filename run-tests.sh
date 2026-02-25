#!/bin/bash

# Start the mock server in the background
npm run start-mock-server > /dev/null 2>&1 &
MOCK_SERVER_PID=$!

cleanup() {
  # Stop the servers
  kill $MOCK_SERVER_PID 2>/dev/null
}
trap cleanup EXIT

# Wait for the mock server to be ready
sleep 2

# Run the unit tests
echo "Running Unit Tests..."
npm run test:unit
UNIT_TEST_EXIT_CODE=$?

# Run Server Tests
echo "Running Server Tests..."
npm run test:server
SERVER_TEST_EXIT_CODE=$?

# Run CLI Tests
echo "Running CLI Tests..."
chmod +x tests/cli_test.sh
./tests/cli_test.sh
CLI_TEST_EXIT_CODE=$?

# Run the E2E tests
echo "Running E2E Tests..."
# If arguments are passed to the script, run only those tests.
# Otherwise, run all E2E tests.
if [ "$#" -gt 0 ]; then
  npm run test:e2e -- "$@"
else
  npm run test:e2e
fi
E2E_TEST_EXIT_CODE=$?

# Run the Real E2E tests
echo "Running Real E2E Tests..."
if [ "$#" -gt 0 ]; then
  npm run test:e2e:real -- "$@"
else
  npm run test:e2e:real
fi
E2E_REAL_TEST_EXIT_CODE=$?

# Exit with a non-zero code if any test suite failed
if [ $UNIT_TEST_EXIT_CODE -ne 0 ] || [ $SERVER_TEST_EXIT_CODE -ne 0 ] || [ $CLI_TEST_EXIT_CODE -ne 0 ] || [ $E2E_TEST_EXIT_CODE -ne 0 ] || [ $E2E_REAL_TEST_EXIT_CODE -ne 0 ]; then
  echo "Tests Failed!"
  echo "Unit Tests Exit Code: $UNIT_TEST_EXIT_CODE"
  echo "Server Tests Exit Code: $SERVER_TEST_EXIT_CODE"
  echo "CLI Tests Exit Code: $CLI_TEST_EXIT_CODE"
  echo "E2E Tests Exit Code: $E2E_TEST_EXIT_CODE"
  echo "Real E2E Tests Exit Code: $E2E_REAL_TEST_EXIT_CODE"
  exit 1
else
  echo "All Tests Passed!"
  exit 0
fi
