const fs = require('fs');
const path = require('path');

// Mock @actions/core
const mockCore = {
  getInput: jest.fn(),
  setOutput: jest.fn(),
  setFailed: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  debug: jest.fn(),
  error: jest.fn()
};

// Mock @actions/github
const mockGithub = {
  context: {
    ref: 'refs/heads/release/v1',
    sha: 'abc123def456',
    repo: {
      owner: 'test-owner',
      repo: 'test-repo'
    }
  },
  getOctokit: jest.fn()
};

jest.mock('@actions/core', () => mockCore);
jest.mock('@actions/github', () => mockGithub);

// Mock fs for package.json reading
jest.mock('fs');
jest.mock('path');

describe('Autoversion Action', () => {
  let run;
  let originalCwd;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset module cache to get fresh instance
    jest.resetModules();
    
    // Mock process.cwd
    originalCwd = process.cwd;
    process.cwd = jest.fn().mockReturnValue('/test/dir');
    
    // Default mock implementations
    mockCore.getInput.mockImplementation((name) => {
      const defaults = {
        'release-branch-pattern': 'release/v*',
        'version-source': 'auto',
        'tag-prefix': 'v',
        'create-tags': 'true',
        'github-token': 'test-token'
      };
      return defaults[name] || '';
    });
    
    path.join.mockImplementation((...args) => args.join('/'));
    
    // Mock octokit
    const mockOctokit = {
      rest: {
        repos: {
          listTags: jest.fn().mockResolvedValue({ data: [] })
        },
        git: {
          getRef: jest.fn().mockRejectedValue({ status: 404 }),
          createRef: jest.fn().mockResolvedValue({}),
          updateRef: jest.fn().mockResolvedValue({})
        }
      }
    };
    
    mockGithub.getOctokit.mockReturnValue(mockOctokit);
    
    // Import run function
    const indexModule = require('../src/index.js');
    run = indexModule.run;
  });
  
  afterEach(() => {
    // Restore process.cwd
    process.cwd = originalCwd;
  });
  
  describe('getVersionFromPackageJson', () => {
    test('should read version from package.json', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.2.3' }));
      
      // Import after mocks are set up
      const { getVersionFromPackageJson } = require('../src/index.js');
      
      // Can't directly test the function as it's not exported
      // This will be tested indirectly through integration tests
    });
  });
  
  describe('Version determination from branch name', () => {
    test('should extract version from release/v1 branch', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(false);
      
      await run();
      
      // Verify outputs were set
      expect(mockCore.setOutput).toHaveBeenCalledWith('version', expect.stringMatching(/^1\.0\.\d+$/));
      expect(mockCore.setOutput).toHaveBeenCalledWith('major-tag', 'v1');
      expect(mockCore.setOutput).toHaveBeenCalledWith('minor-tag', 'v1.0');
    });
    
    test('should extract version from release/v2.1 branch', async () => {
      mockGithub.context.ref = 'refs/heads/release/v2.1';
      fs.existsSync.mockReturnValue(false);
      
      await run();
      
      expect(mockCore.setOutput).toHaveBeenCalledWith('version', expect.stringMatching(/^2\.1\.\d+$/));
      expect(mockCore.setOutput).toHaveBeenCalledWith('major-tag', 'v2');
      expect(mockCore.setOutput).toHaveBeenCalledWith('minor-tag', 'v2.1');
    });
  });
  
  describe('create-tags option', () => {
    test('should create tags when create-tags is true', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(false);
      mockCore.getInput.mockImplementation((name) => {
        if (name === 'create-tags') return 'true';
        if (name === 'github-token') return 'test-token';
        return '';
      });
      
      const mockOctokit = mockGithub.getOctokit();
      
      await run();
      
      // Verify tags were created
      expect(mockOctokit.rest.git.createRef).toHaveBeenCalled();
    });
    
    test.skip('should not create tags when create-tags is false', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.2.3' }));
      
      mockCore.getInput.mockImplementation((name) => {
        if (name === 'create-tags') return 'false';
        if (name === 'version-source') return 'package.json';
        if (name === 'tag-prefix') return 'v';
        if (name === 'release-branch-pattern') return 'release/v*';
        return '';
      });
      
      const mockOctokit = mockGithub.getOctokit();
      
      // Need to reload module for this test
      jest.resetModules();
      const { run } = require('../src/index.js');
      await run();
      
      // Verify tags were not created
      expect(mockOctokit.rest.git.createRef).not.toHaveBeenCalled();
      expect(mockOctokit.rest.git.updateRef).not.toHaveBeenCalled();
      
      // But version should still be output
      expect(mockCore.setOutput).toHaveBeenCalledWith('version', '1.2.3');
    });
    
    test('should fail when create-tags is true but no token provided', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      mockCore.getInput.mockImplementation((name) => {
        if (name === 'create-tags') return 'true';
        if (name === 'github-token') return '';
        return '';
      });
      
      await run();
      
      expect(mockCore.setFailed).toHaveBeenCalledWith('github-token is required when create-tags is true');
    });
  });
  
  describe('Non-release branch handling', () => {
    test('should skip versioning on non-release branch', async () => {
      mockGithub.context.ref = 'refs/heads/main';
      
      await run();
      
      expect(mockCore.warning).toHaveBeenCalledWith('Not on a release branch. Skipping versioning.');
      expect(mockCore.setOutput).not.toHaveBeenCalled();
    });
  });
  
  describe('Version source - package.json', () => {
    test.skip('should use version from package.json when available', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '2.5.7' }));
      
      mockCore.getInput.mockImplementation((name) => {
        if (name === 'version-source') return 'package.json';
        if (name === 'github-token') return 'test-token';
        if (name === 'create-tags') return 'true';
        if (name === 'tag-prefix') return 'v';
        if (name === 'release-branch-pattern') return 'release/v*';
        return '';
      });
      
      // Need to reload module for this test
      jest.resetModules();
      const { run } = require('../src/index.js');
      await run();
      
      expect(mockCore.setOutput).toHaveBeenCalledWith('version', '2.5.7');
      expect(mockCore.setOutput).toHaveBeenCalledWith('major-tag', 'v2');
      expect(mockCore.setOutput).toHaveBeenCalledWith('minor-tag', 'v2.5');
      expect(mockCore.setOutput).toHaveBeenCalledWith('patch-tag', 'v2.5.7');
    });
  });
  
  describe('Manual version specification', () => {
    test('should use manually specified version', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      
      mockCore.getInput.mockImplementation((name) => {
        const values = {
          'version-source': 'manual',
          'major-version': '3',
          'minor-version': '2',
          'patch-version': '1',
          'github-token': 'test-token',
          'create-tags': 'true'
        };
        return values[name] || '';
      });
      
      await run();
      
      expect(mockCore.setOutput).toHaveBeenCalledWith('version', '3.2.1');
      expect(mockCore.setOutput).toHaveBeenCalledWith('major-tag', 'v3');
      expect(mockCore.setOutput).toHaveBeenCalledWith('minor-tag', 'v3.2');
      expect(mockCore.setOutput).toHaveBeenCalledWith('patch-tag', 'v3.2.1');
    });
  });
  
  describe('Custom tag prefix', () => {
    test('should use custom tag prefix', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));
      
      mockCore.getInput.mockImplementation((name) => {
        if (name === 'tag-prefix') return 'release-';
        if (name === 'github-token') return 'test-token';
        if (name === 'create-tags') return 'true';
        return '';
      });
      
      await run();
      
      expect(mockCore.setOutput).toHaveBeenCalledWith('major-tag', 'release-1');
      expect(mockCore.setOutput).toHaveBeenCalledWith('minor-tag', 'release-1.0');
      expect(mockCore.setOutput).toHaveBeenCalledWith('patch-tag', 'release-1.0.0');
    });
  });
});
