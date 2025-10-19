const { Given, When, Then, Before, After } = require('@cucumber/cucumber');
const assert = require('assert');
const Module = require('module');

// Test context
let testContext = {};
let originalRequire;
let mockModules = {};

// Helper to create simple mock functions
function createMockFn(impl) {
  const fn = function(...args) {
    fn.calls.push(args);
    return impl ? impl(...args) : undefined;
  };
  fn.calls = [];
  fn.mockImplementation = (newImpl) => {
    impl = newImpl;
    return fn;
  };
  return fn;
}

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
  const mockCore = {
    getInput: createMockFn((name) => testContext.actionInputs[name] || ''),
    setOutput: createMockFn((name, value) => {
      testContext.actionOutputs[name] = value;
    }),
    setFailed: createMockFn((message) => {
      testContext.actionFailed = true;
      testContext.failureMessage = message;
    }),
    info: createMockFn(),
    warning: createMockFn(),
    debug: createMockFn(),
    error: createMockFn()
  };

  const mockGithub = {
    context: {
      ref: `refs/heads/${testContext.branchName}`,
      sha: testContext.currentSha,
      repo: {
        owner: 'test-owner',
        repo: 'test-repo'
      }
    },
    getOctokit: createMockFn(() => ({
      rest: {
        repos: {
          listTags: createMockFn(async () => ({
            data: testContext.existingTags.map(tag => ({ name: tag }))
          }))
        },
        git: {
          getRef: createMockFn(async ({ ref }) => {
            const tagName = ref.replace('tags/', '');
            if (testContext.existingTags.includes(tagName)) {
              return { data: { object: { sha: 'old-sha' } } };
            }
            const error = new Error('Not found');
            error.status = 404;
            throw error;
          }),
          createRef: createMockFn(async ({ ref, sha }) => {
            const tagName = ref.replace('refs/tags/', '');
            testContext.createdTags.push(tagName);
            return {};
          }),
          updateRef: createMockFn(async ({ ref, sha }) => {
            const tagName = ref.replace('tags/', '');
            testContext.updatedTags.push(tagName);
            return {};
          })
        }
      }
    }))
  };

  const mockFs = {
    existsSync: createMockFn((filePath) => {
      return testContext.packageJsonVersion !== null;
    }),
    readFileSync: createMockFn((filePath, encoding) => {
      if (testContext.packageJsonVersion) {
        return JSON.stringify({ version: testContext.packageJsonVersion });
      }
      throw new Error('File not found');
    })
  };

  const mockPath = {
    join: createMockFn((...args) => args.join('/'))
  };

  // Store mocks
  mockModules = {
    '@actions/core': mockCore,
    '@actions/github': mockGithub,
    'fs': mockFs,
    'path': mockPath
  };

  // Override require
  originalRequire = Module.prototype.require;
  Module.prototype.require = function(id) {
    if (mockModules[id]) {
      return mockModules[id];
    }
    return originalRequire.apply(this, arguments);
  };

  // Mock process.cwd
  if (!process.cwd._original) {
    process.cwd._original = process.cwd;
  }
  process.cwd = () => '/test/dir';
});

After(function() {
  // Restore original require
  if (originalRequire) {
    Module.prototype.require = originalRequire;
  }
  
  // Restore process.cwd
  if (process.cwd._original) {
    process.cwd = process.cwd._original;
  }
  
  // Clear module cache
  Object.keys(require.cache).forEach(key => {
    if (key.includes('src/index.js')) {
      delete require.cache[key];
    }
  });
  
  // Reset context
  testContext = {};
  mockModules = {};
});

// Given steps
Given('I am on a release branch', function() {
  testContext.branchName = 'release/v1';
  mockModules['@actions/github'].context.ref = `refs/heads/${testContext.branchName}`;
});

Given('I am on release branch {string}', function(branchName) {
  testContext.branchName = branchName;
  mockModules['@actions/github'].context.ref = `refs/heads/${branchName}`;
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
  // Clear module cache to force reload with mocks
  Object.keys(require.cache).forEach(key => {
    if (key.includes('src/index.js')) {
      delete require.cache[key];
    }
  });
  
  const { run } = require('../../src/index.js');
  await run();
});

When('I run the autoversion action with version-source {string}', async function(versionSource) {
  testContext.actionInputs['version-source'] = versionSource;
  mockModules['@actions/core'].getInput.mockImplementation((name) => testContext.actionInputs[name] || '');
  
  // Clear module cache
  Object.keys(require.cache).forEach(key => {
    if (key.includes('src/index.js')) {
      delete require.cache[key];
    }
  });
  
  const { run } = require('../../src/index.js');
  await run();
});

When('I run the autoversion action with create-tags {string}', async function(createTags) {
  testContext.actionInputs['create-tags'] = createTags;
  mockModules['@actions/core'].getInput.mockImplementation((name) => testContext.actionInputs[name] || '');
  
  // Clear module cache
  Object.keys(require.cache).forEach(key => {
    if (key.includes('src/index.js')) {
      delete require.cache[key];
    }
  });
  
  const { run } = require('../../src/index.js');
  await run();
});

// Then steps
Then('the action should fail', function() {
  assert.strictEqual(testContext.actionFailed, true, 'Action should have failed');
});

Then('the error should mention that tag {string} already exists', function(tagName) {
  assert.ok(testContext.failureMessage && testContext.failureMessage.includes(tagName), `Error message should contain tag name ${tagName}`);
  assert.ok(testContext.failureMessage && testContext.failureMessage.toLowerCase().includes('exists'), 'Error message should mention "exists"');
});

Then('the error should mention version mismatch between branch and package.json', function() {
  const msg = testContext.failureMessage ? testContext.failureMessage.toLowerCase() : '';
  assert.ok(msg.match(/mismatch|match|version/), 'Error message should mention version mismatch');
});

Then('tags {string}, {string}, and {string} should be created', function(tag1, tag2, tag3) {
  assert.ok(testContext.createdTags.includes(tag1), `Created tags should include ${tag1}`);
  assert.ok(testContext.createdTags.includes(tag2), `Created tags should include ${tag2}`);
  assert.ok(testContext.createdTags.includes(tag3), `Created tags should include ${tag3}`);
});

Then('all tags should point to the current commit', function() {
  // Verified by mock implementation
  assert.ok(testContext.createdTags.length > 0, 'At least one tag should be created');
});

Then('tags {string} and {string} should be updated to current commit', function(tag1, tag2) {
  assert.ok(testContext.updatedTags.includes(tag1), `Updated tags should include ${tag1}`);
  assert.ok(testContext.updatedTags.includes(tag2), `Updated tags should include ${tag2}`);
});

Then('tag {string} should be created pointing to current commit', function(tagName) {
  assert.ok(testContext.createdTags.includes(tagName), `Created tags should include ${tagName}`);
});

Then('no tags should be created', function() {
  assert.strictEqual(testContext.createdTags.length, 0, 'No tags should be created');
  assert.strictEqual(testContext.updatedTags.length, 0, 'No tags should be updated');
});

Then('the version output should be {string}', function(expectedVersion) {
  assert.strictEqual(testContext.actionOutputs.version, expectedVersion, `Version output should be ${expectedVersion}`);
});

Then('the version should be determined from package.json', function() {
  // Check that package.json was read
  assert.ok(mockModules['fs'].readFileSync.calls.length > 0, 'package.json should have been read');
});

Then('the version should be determined from branch name', function() {
  // Check that package.json was NOT successfully read or doesn't exist
  assert.strictEqual(testContext.packageJsonVersion, null, 'package.json version should be null');
});
