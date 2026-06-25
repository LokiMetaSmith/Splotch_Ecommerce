#!/bin/bash

# Start the mock server in the background
npm run start-mock-server &
MOCK_SERVER_PID=$!

# Start the dev server in the background
npm run dev &
DEV_SERVER_PID=$!

# Wait for the servers to be ready
sleep 5

# Run the tests
npm run test:e2e
TEST_EXIT_CODE=$?

# Stop the servers
kill $MOCK_SERVER_PID
kill $DEV_SERVER_PID

# Exit with the test exit code
exit $TEST_EXIT_CODE
