#!/bin/bash

# Start the mock server in the background
npm run start-mock-server &
MOCK_SERVER_PID=$!

# Start the dev server in the background
npm run dev &
DEV_SERVER_PID=$!

# Wait for the servers to be ready
sleep 5

# Run the unit tests
npm run test:unit
UNIT_TEST_EXIT_CODE=$?

# Run the E2E tests
# If arguments are passed to the script, run only those tests.
# Otherwise, run all E2E tests.
if [ "$#" -gt 0 ]; then
  npm run test:e2e -- "$@"
else
  npm run test:e2e
fi
E2E_TEST_EXIT_CODE=$?

# Exit with a non-zero code if either test suite failed
if [ $UNIT_TEST_EXIT_CODE -ne 0 ] || [ $E2E_TEST_EXIT_CODE -ne 0 ]; then
  TEST_EXIT_CODE=1
else
  TEST_EXIT_CODE=0
fi

# Stop the servers
kill $MOCK_SERVER_PID
kill $DEV_SERVER_PID

# Exit with the test exit code
exit $TEST_EXIT_CODE