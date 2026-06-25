export default {
    transform: {
        '^.+\\.js$': 'babel-jest',
    },
    testEnvironment: 'jsdom',
    testMatch: [
        "**/tests/**/*.test.js",
        "**/server/**/*.test.js"
    ],
    transformIgnorePatterns: [
        "/node_modules/(?!(fflate|file-type)/)"
    ],
    globals: {
        'process.env.NODE_ENV': 'test',
    },
    setupFilesAfterEnv: ['./tests/test-setup.js'],
    clearMocks: true,
};
