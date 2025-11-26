/**
 * Test setup and configuration
 * Runs before all tests to configure the test environment
 */

// Set test environment variables
process.env.CDK_DEFAULT_ACCOUNT = '123456789012';
process.env.CDK_DEFAULT_REGION = 'us-east-1';

// Increase test timeout for CDK synthesis operations
jest.setTimeout(30000);

// Mock console methods to reduce noise in test output
// Uncomment these if you want to suppress console output during tests
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
// };
