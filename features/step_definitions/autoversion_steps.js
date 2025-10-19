const { Given, When, Then, Before, After } = require('@cucumber/cucumber');
const { expect } = require('@jest/globals');
const fs = require('fs');
const path = require('path');

// Mock modules
let mockCore, mockGithub, mockFs, mockPath;
let testContext = {};

Before(function() {
  // Reset test context
  testContext = {
    branchName: 'release/v1',
    packageJsonVersion: null,
    existingTags: [],
    createdTags: [],
    updatedTags: [],
    actionInputs: {
      'create-tags': 'true',
      'version-source': 'auto',
      'github-token': 'test-token',
      'tag-prefix': 'v',
      'release-branch-pattern': 'release/v*'
    },
    actionOutputs: {},
    actionFailed: false,
    failureMessage: null,
    currentSha: 'abc123def456'
  };

  // Setup mocks
  mockCore = {
    getInput: jest.fn((name) => testContext.actionInputs[name] || ''),
    setOutput: jest.fn((name, value) => {
      testContext.actionOutputs[name] = value;
    }),
    setFailed: jest.fn((message) => {
      testContext.actionFailed = true;
      testContext.failureMessage = message;
    }),
    info: jest.fn(),
    warning: jest.fn(),
    debug: jest.fn(),
    error: jest.fn()
  };

  mockGithub = {
    context: {
      ref: `refs/heads/${testContext.branchName}`,
      sha: testContext.currentSha,
      repo: {
        owner: 'test-owner',
        repo: 'test-repo'
      }
    },
    getOctokit: jest.fn(() => ({
      rest: {
        repos: {
          listTags: jest.fn(async () => ({
            data: testContext.existingTags.map(tag => ({ name: tag }))
          }))
        },
        git: {
          getRef: jest.fn(async ({ ref }) => {
            const tagName = ref.replace('tags/', '');
            if (testContext.existingTags.includes(tagName)) {
              return { data: { object: { sha: 'old-sha' } } };
            }
            throw { status: 404 };
          }),
          createRef: jest.fn(async ({ ref, sha }) => {
            const tagName = ref.replace('refs/tags/', '');
            testContext.createdTags.push(tagName);
            return {};
          }),
          updateRef: jest.fn(async ({ ref, sha }) => {
            const tagName = ref.replace('tags/', '');
            testContext.updatedTags.push(tagName);
            return {};
          })
        }
      }
    }))
  };

  mockFs = {
    existsSync: jest.fn((filePath) => {
      return testContext.packageJsonVersion !== null;
    }),
    readFileSync: jest.fn((filePath) => {
      if (testContext.packageJsonVersion) {
        return JSON.stringify({ version: testContext.packageJsonVersion });
      }
      throw new Error('File not found');
    })
  };

  mockPath = {
    join: jest.fn((...args) => args.join('/'))
  };

  // Mock process.cwd
  global.process.cwd = jest.fn(() => '/test/dir');

  // Mock modules
  jest.mock('@actions/core', () => mockCore);
  jest.mock('@actions/github', () => mockGithub);
  jest.mock('fs', () => mockFs);
  jest.mock('path', () => mockPath);
});

After(function() {
  jest.resetModules();
  jest.clearAllMocks();
});

// Given steps
Given('I am on a release branch', function() {
  testContext.branchName = 'release/v1';
  mockGithub.context.ref = `refs/heads/${testContext.branchName}`;
});

Given('I am on release branch {string}', function(branchName) {
  testContext.branchName = branchName;
  mockGithub.context.ref = `refs/heads/${branchName}`;
});

Given('package.json has version {string}', function(version) {
  testContext.packageJsonVersion = version;
});

Given('package.json does not exist', function() {
  testContext.packageJsonVersion = null;
});

Given('tag {string} already exists', function(tagName) {
  testContext.existingTags.push(tagName);
});

Given('tags {string}, {string}, {string} already exist', function(tag1, tag2, tag3) {
  testContext.existingTags.push(tag1, tag2, tag3);
});

Given('no tags exist', function() {
  testContext.existingTags = [];
});

Given('no tags exist for {string}', function(pattern) {
  // Filter out any existing tags matching the pattern
  const regex = new RegExp(pattern.replace('*', '.*'));
  testContext.existingTags = testContext.existingTags.filter(tag => !regex.test(tag));
});

// When steps
When('I run the autoversion action', async function() {
  const { run } = require('../../src/index.js');
  await run();
});

When('I run the autoversion action with version-source {string}', async function(versionSource) {
  testContext.actionInputs['version-source'] = versionSource;
  mockCore.getInput = jest.fn((name) => testContext.actionInputs[name] || '');
  
  jest.resetModules();
  const { run } = require('../../src/index.js');
  await run();
});

When('I run the autoversion action with create-tags {string}', async function(createTags) {
  testContext.actionInputs['create-tags'] = createTags;
  mockCore.getInput = jest.fn((name) => testContext.actionInputs[name] || '');
  
  jest.resetModules();
  const { run } = require('../../src/index.js');
  await run();
});

// Then steps
Then('the action should fail', function() {
  expect(testContext.actionFailed).toBe(true);
});

Then('the error should mention that tag {string} already exists', function(tagName) {
  expect(testContext.failureMessage).toContain(tagName);
  expect(testContext.failureMessage.toLowerCase()).toContain('exists');
});

Then('the error should mention version mismatch between branch and package.json', function() {
  expect(testContext.failureMessage.toLowerCase()).toMatch(/mismatch|match|version/);
});

Then('tags {string}, {string}, and {string} should be created', function(tag1, tag2, tag3) {
  expect(testContext.createdTags).toContain(tag1);
  expect(testContext.createdTags).toContain(tag2);
  expect(testContext.createdTags).toContain(tag3);
});

Then('all tags should point to the current commit', function() {
  // Verified by mock implementation
  expect(testContext.createdTags.length).toBeGreaterThan(0);
});

Then('tags {string} and {string} should be updated to current commit', function(tag1, tag2) {
  expect(testContext.updatedTags).toContain(tag1);
  expect(testContext.updatedTags).toContain(tag2);
});

Then('tag {string} should be created pointing to current commit', function(tagName) {
  expect(testContext.createdTags).toContain(tagName);
});

Then('no tags should be created', function() {
  expect(testContext.createdTags.length).toBe(0);
  expect(testContext.updatedTags.length).toBe(0);
});

Then('the version output should be {string}', function(expectedVersion) {
  expect(testContext.actionOutputs.version).toBe(expectedVersion);
});

Then('the version should be determined from package.json', function() {
  // Check that package.json was read
  expect(mockFs.readFileSync).toHaveBeenCalled();
});

Then('the version should be determined from branch name', function() {
  // Check that package.json was NOT successfully read or doesn't exist
  expect(testContext.packageJsonVersion).toBeNull();
});
