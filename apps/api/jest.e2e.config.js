module.exports = {
  rootDir: '.',
  testRegex: 'test/.*\.e2e-spec\.ts$',
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: false }] },
  testEnvironment: 'node',
  testTimeout: 60000,
};
