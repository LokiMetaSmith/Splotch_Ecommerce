export default {
    transform: {},
    testEnvironment: 'node',
    testPathIgnorePatterns: ['/node_modules/', '/playwright_tests/', '/playwright_tests_real/'],
    moduleNameMapper: {
        '\\.css$': '<rootDir>/tests/__mocks__/styleMock.js',
    },
    setupFiles: ['<rootDir>/tests/jest-setup.js'],
};
