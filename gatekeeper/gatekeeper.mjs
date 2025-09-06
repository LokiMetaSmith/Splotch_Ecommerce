import { execSync } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Gets the git diff for the current branch against main.
 * @returns {string} The git diff output.
 */
function getGitDiff() {
  console.log('Getting git diff...');
  try {
    const command = "git diff main...HEAD --minimal --ignore-all-space --diff-filter=ACMR -- . ':(exclude)package.lock.json'";
    const diff = execSync(command).toString();
    if (!diff) {
      console.log('No diff found. Exiting.');
      process.exit(0);
    }
    return diff;
  } catch (error) {
    console.error('Error getting git diff:', error);
    process.exit(1);
  }
}

/**
 * Gets the list of available E2E test files.
 * @returns {string[]} An array of test file paths.
 */
function getAvailableTests() {
  console.log('Getting available E2E tests...');
  const testsDir = 'playwright_tests';
  try {
    const allFiles = readdirSync(testsDir);
    const testFiles = allFiles.filter(file => file.endsWith('.spec.js'));
    return testFiles.map(file => path.join(testsDir, file));
  } catch (error) {
    console.error(`Error reading tests directory '${testsDir}':`, error);
    process.exit(1);
  }
}

/**
 * Constructs the final prompt to be sent to the AI.
 * @param {string} diff The git diff.
 * @param {string[]} tests The list of available tests.
 * @returns {string} The final prompt.
 */
function constructPrompt(diff, tests) {
  console.log('Constructing prompt...');
  try {
    const promptTemplate = readFileSync(path.join('gatekeeper', 'prompt.md'), 'utf-8');
    const testsString = JSON.stringify(tests, null, 2);

    let finalPrompt = promptTemplate;
    finalPrompt += '\n\n## Available E2E Test Files:\n';
    finalPrompt += testsString;
    finalPrompt += '\n\n## Branch Git Diff:\n';
    finalPrompt += '```diff\n' + diff + '\n```';

    return finalPrompt;
  } catch (error) {
    console.error('Error constructing prompt:', error);
    process.exit(1);
  }
}

/**
 * Gets test recommendations from the Gemini API.
 * @param {string} prompt The prompt to send to the model.
 * @returns {Promise<string[]>} A promise that resolves to an array of test file paths.
 */
async function getGeminiRecommendations(prompt) {
  console.log('Getting test recommendations from Gemini...');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY environment variable not set.');
    process.exit(1);
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const responseText = response.text();
    console.log('AI Response Text:', responseText);

    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch || !jsonMatch[1]) {
      throw new Error('Could not find a JSON block in the AI response.');
    }

    const jsonResponse = JSON.parse(jsonMatch[1]);

    if (!jsonResponse.tests || !Array.isArray(jsonResponse.tests)) {
      throw new Error('The "tests" key is missing or not an array in the AI response.');
    }

    console.log('\n--- AI Reasoning ---');
    console.log(jsonResponse.explanation);
    console.log('--------------------\n');

    return jsonResponse.tests;
  } catch (error) {
    console.error('Error getting recommendations from Gemini API:', error);
    process.exit(1);
  }
}

/**
 * Gets test recommendations from a local LLM API (OpenAI compatible).
 * @param {string} prompt The prompt to send to the model.
 * @returns {Promise<string[]>} A promise that resolves to an array of test file paths.
 */
async function getLocalRecommendations(prompt) {
  console.log('Getting test recommendations from local LLM...');

  const endpoint = process.env.LOCAL_LLM_ENDPOINT || 'http://localhost:8080/v1/chat/completions';
  console.log(`Using local endpoint: ${endpoint}`);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'local-model', // Model name is often ignored by local servers
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const responseText = data.choices[0].message.content;
    console.log('AI Response Text:', responseText);

    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch || !jsonMatch[1]) {
      throw new Error('Could not find a JSON block in the AI response.');
    }

    const jsonResponse = JSON.parse(jsonMatch[1]);

    if (!jsonResponse.tests || !Array.isArray(jsonResponse.tests)) {
      throw new Error('The "tests" key is missing or not an array in the AI response.');
    }

    console.log('\n--- AI Reasoning ---');
    console.log(jsonResponse.explanation);
    console.log('--------------------\n');

    return jsonResponse.tests;

  } catch (error) {
    console.error('Error getting recommendations from local LLM API:', error);
    process.exit(1);
  }
}


async function main() {
  const diff = getGitDiff();
  const tests = getAvailableTests();
  const prompt = constructPrompt(diff, tests);

  const provider = process.env.AI_PROVIDER || 'gemini';
  let recommendedTests = [];

  console.log(`Using AI Provider: ${provider}`);

  switch (provider) {
    case 'gemini':
      recommendedTests = await getGeminiRecommendations(prompt);
      break;
    case 'local':
      recommendedTests = await getLocalRecommendations(prompt);
      break;
    default:
      console.error(`Invalid AI_PROVIDER: ${provider}. Use 'gemini' or 'local'.`);
      process.exit(1);
  }

  console.log('Recommended tests to run:');
  console.log(recommendedTests);

  if (recommendedTests.length === 0) {
    console.log('No tests recommended. Exiting.');
    process.exit(0);
  }

  console.log('\nExecuting recommended tests...');
  try {
    const command = `./run-tests.sh ${recommendedTests.join(' ')}`;
    execSync(command, { stdio: 'inherit' });
    console.log('\nTests completed successfully.');
  } catch (error) {
    console.error('\nTests failed.');
    process.exit(1);
  }
}

main();
