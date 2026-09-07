/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  testMatch: ['**/*.test.js'],
  transform: {},
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
  moduleNameMapper: {
    '^@mattkrick/sanitize-svg$': '<rootDir>/tests/fileMock.js',
    '^@easypost/api$': '<rootDir>/tests/easypostMock.js'
  },
};
