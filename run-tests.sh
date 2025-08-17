#!/bin/bash

# First, run the unit tests
npm run test:unit

# Check if the dev server is running before running e2e tests
if ! curl -s http://localhost:5173 > /dev/null; then
    echo "------------------------------------------------------"
    echo "ERROR: The development server is not running."
    echo "Please start it in another terminal with 'npm run dev'"
    echo "before running the end-to-end tests."
    echo "------------------------------------------------------"
    exit 1
fi

# If the server is running, run the e2e tests
npm run test:e2e
