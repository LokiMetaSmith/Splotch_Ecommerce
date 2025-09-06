# AI Test Gatekeeper

This directory contains the scripts for an AI-powered E2E test gatekeeper. The system intelligently selects which E2E tests to run based on the code changes in a pull request.

## How it Works

The main script, `gatekeeper.mjs`, performs the following steps:
1.  Calculates the `git diff` for the current branch against `main`.
2.  Gathers a list of all available E2E tests from the `playwright_tests/` directory.
3.  Constructs a detailed prompt using the template in `prompt.md`.
4.  Sends the prompt to a configured AI model to get a list of recommended tests.
5.  Executes the recommended tests by calling the `run-tests.sh` script.

## Usage

To run the gatekeeper, use the npm script:
```bash
npm run test:gatekeeper
```

## Configuration

The gatekeeper can be configured to use different AI providers via environment variables.

### Selecting an AI Provider

Use the `AI_PROVIDER` environment variable to choose the model.

-   `AI_PROVIDER=gemini` (Default): Uses the Google Gemini API.
-   `AI_PROVIDER=local`: Uses a local LLM with an OpenAI-compatible API endpoint (e.g., Llama.cpp server).

### Provider-Specific Configuration

#### Gemini
-   You must set the `GEMINI_API_KEY` environment variable to your Google AI Studio API key.
```bash
export AI_PROVIDER=gemini
export GEMINI_API_KEY="your-gemini-api-key"
npm run test:gatekeeper
```

#### Local LLM
-   The script will send requests to the endpoint defined in the `LOCAL_LLM_ENDPOINT` environment variable.
-   If not set, it defaults to `http://localhost:8080/v1/chat/completions`.
```bash
# Using the default endpoint
export AI_PROVIDER=local
npm run test:gatekeeper

# Using a custom endpoint
export AI_PROVIDER=local
export LOCAL_LLM_ENDPOINT="http://127.0.0.1:5000/v1/chat/completions"
npm run test:gatekeeper
```
