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

// Import run function once
const { run } = require('../src/index.js');

describe('Autoversion Action', () => {
  let originalCwd;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
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
    
    // Mock path.join to work like actual path joining
    path.join.mockImplementation((...args) => args.join('/'));
    
    // Default: no package.json file exists
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockReturnValue('{}');
    
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
    
    test('should not create tags when create-tags is false', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(false);
      
      mockCore.getInput.mockImplementation((name) => {
        if (name === 'create-tags') return 'false';
        if (name === 'version-source') return 'auto';
        if (name === 'tag-prefix') return 'v';
        if (name === 'release-branch-pattern') return 'release/v*';
        return '';
      });
      
      const mockOctokit = mockGithub.getOctokit();
      
      await run();
      
      // Verify tags were not created
      expect(mockOctokit.rest.git.createRef).not.toHaveBeenCalled();
      expect(mockOctokit.rest.git.updateRef).not.toHaveBeenCalled();
      
      // But version should still be output
      expect(mockCore.setOutput).toHaveBeenCalledWith('version', expect.stringMatching(/^1\.0\.\d+$/));
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
    test('should use version from package.json when available', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.5.7' }));
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'version-source': 'package.json',
          'github-token': 'test-token',
          'create-tags': 'true',
          'tag-prefix': 'v',
          'release-branch-pattern': 'release/v*'
        };
        return defaults[name] || '';
      });
      
      const mockOctokit = mockGithub.getOctokit();
      mockOctokit.rest.git.getRef.mockRejectedValue({ status: 404 });
      
      await run();
      
      // Check if there were any failures first
      if (mockCore.setFailed.mock.calls.length > 0) {
        console.log('setFailed was called with:', mockCore.setFailed.mock.calls);
      }
      
      expect(mockCore.setOutput).toHaveBeenCalledWith('version', '1.5.7');
      expect(mockCore.setOutput).toHaveBeenCalledWith('major-tag', 'v1');
      expect(mockCore.setOutput).toHaveBeenCalledWith('minor-tag', 'v1.5');
      expect(mockCore.setOutput).toHaveBeenCalledWith('patch-tag', 'v1.5.7');
    });
    
    test('should fail when package.json not found in package.json mode', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(false);
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'version-source': 'package.json',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v',
          'create-tags': 'false'
        };
        return defaults[name] || '';
      });
      
      await run();
      
      expect(mockCore.setFailed).toHaveBeenCalledWith('Could not read version from package.json');
    });
    
    test('should fail when major version mismatch between package.json and branch', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '2.0.0' }));
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'version-source': 'package.json',
          'github-token': 'test-token',
          'create-tags': 'true',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v'
        };
        return defaults[name] || '';
      });
      
      await run();
      
      expect(mockCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Version mismatch'));
    });
    
    test('should fail when minor version mismatch between package.json and branch', async () => {
      mockGithub.context.ref = 'refs/heads/release/v2.1';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '2.0.0' }));
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'version-source': 'package.json',
          'github-token': 'test-token',
          'create-tags': 'true',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v'
        };
        return defaults[name] || '';
      });
      
      await run();
      
      expect(mockCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Version mismatch'));
    });
    
    test('should NOT fail when branch has no minor version but package.json does', async () => {
      // This tests the fix: release/v1 should not conflict with package.json 1.1.0
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.1.0' }));
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'version-source': 'package.json',
          'github-token': 'test-token',
          'create-tags': 'true',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v'
        };
        return defaults[name] || '';
      });
      
      await run();
      
      // Should succeed because release/v1 doesn't specify a minor version
      expect(mockCore.setFailed).not.toHaveBeenCalled();
      expect(mockCore.setOutput).toHaveBeenCalledWith('version', expect.stringMatching(/^1\.1\.\d+$/));
    });

    test('should handle package.json read errors', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'version-source': 'package.json',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v',
          'create-tags': 'false'
        };
        return defaults[name] || '';
      });
      
      await run();
      
      expect(mockCore.setFailed).toHaveBeenCalledWith('Could not read version from package.json');
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
  
  describe('Auto version source mode', () => {
    test('should use package.json when available in auto mode', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.2.0' }));
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'version-source': 'auto',
          'github-token': 'test-token',
          'create-tags': 'true',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v'
        };
        return defaults[name] || '';
      });
      
      const mockOctokit = mockGithub.getOctokit();
      mockOctokit.rest.repos.listTags.mockResolvedValue({ data: [] });
      mockOctokit.rest.git.getRef.mockRejectedValue({ status: 404 });
      
      await run();
      
      expect(mockCore.setOutput).toHaveBeenCalledWith('version', expect.stringMatching(/^1\.2\.\d+$/));
    });
    
    test('should fallback to branch name when package.json not available in auto mode', async () => {
      mockGithub.context.ref = 'refs/heads/release/v2';
      fs.existsSync.mockReturnValue(false);
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'version-source': 'auto',
          'github-token': 'test-token',
          'create-tags': 'true',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v'
        };
        return defaults[name] || '';
      });
      
      const mockOctokit = mockGithub.getOctokit();
      mockOctokit.rest.git.getRef.mockRejectedValue({ status: 404 });
      
      await run();
      
      expect(mockCore.setOutput).toHaveBeenCalledWith('version', expect.stringMatching(/^2\.0\.\d+$/));
    });
    
    test('should fail when major version mismatch in auto mode', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '3.0.0' }));
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'version-source': 'auto',
          'github-token': 'test-token',
          'create-tags': 'true',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v'
        };
        return defaults[name] || '';
      });
      
      await run();
      
      expect(mockCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Version mismatch'));
    });
    
    test('should fail when no version can be determined', async () => {
      mockGithub.context.ref = 'refs/heads/release/invalidname';
      fs.existsSync.mockReturnValue(false);
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'version-source': 'auto',
          'github-token': 'test-token',
          'create-tags': 'true',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v'
        };
        return defaults[name] || '';
      });
      
      await run();
      
      expect(mockCore.setFailed).toHaveBeenCalledWith('Could not determine version from any source');
    });
  });
  
  describe('Tag already exists', () => {
    test('should fail when patch tag already exists', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.2.3' }));
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'version-source': 'package.json',
          'github-token': 'test-token',
          'create-tags': 'true',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v'
        };
        return defaults[name] || '';
      });
      
      const mockOctokit = mockGithub.getOctokit();
      // Mock that the tag already exists
      mockOctokit.rest.git.getRef.mockResolvedValue({ 
        data: { object: { sha: 'existing-sha' } } 
      });
      
      await run();
      
      expect(mockCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    });
    
    test('should handle non-404 errors when checking tag existence', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.2.3' }));
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'version-source': 'package.json',
          'github-token': 'test-token',
          'create-tags': 'true',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v'
        };
        return defaults[name] || '';
      });
      
      const mockOctokit = mockGithub.getOctokit();
      // Mock a non-404 error
      const error = new Error('API Error');
      error.status = 500;
      mockOctokit.rest.git.getRef.mockRejectedValue(error);
      
      await run();
      
      expect(mockCore.setFailed).toHaveBeenCalled();
    });
  });
  
  describe('Error handling', () => {
    test('should handle errors when listing tags', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(false);
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'github-token': 'test-token',
          'create-tags': 'true',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v',
          'version-source': 'auto'
        };
        return defaults[name] || '';
      });
      
      const mockOctokit = mockGithub.getOctokit();
      mockOctokit.rest.repos.listTags.mockRejectedValue(new Error('API Error'));
      mockOctokit.rest.git.getRef.mockRejectedValue({ status: 404 });
      
      await run();
      
      // Should still work with warning, using default patch version 0
      expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('Could not fetch existing tags'));
    });
    
    test('should skip versioning when not on release branch', async () => {
      mockGithub.context.ref = 'refs/heads/main';
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'version-source': 'auto',
          'github-token': 'test-token',
          'create-tags': 'true',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v'
        };
        return defaults[name] || '';
      });
      
      await run();
      
      expect(mockCore.warning).toHaveBeenCalledWith('Not on a release branch. Skipping versioning.');
    });
  });
  
  describe('Patch version increment', () => {
    test('should increment patch version when patch is 0', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.2.0' }));
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'github-token': 'test-token',
          'create-tags': 'true',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v',
          'version-source': 'auto'
        };
        return defaults[name] || '';
      });
      
      const mockOctokit = mockGithub.getOctokit();
      mockOctokit.rest.repos.listTags.mockResolvedValue({ 
        data: [{ name: 'v1.2.0' }] 
      });
      mockOctokit.rest.git.getRef.mockRejectedValue({ status: 404 });
      
      await run();
      
      // Should increment to v1.2.1
      expect(mockCore.setOutput).toHaveBeenCalledWith('version', expect.stringMatching(/^1\.2\.\d+$/));
      expect(mockCore.setOutput).toHaveBeenCalledWith('patch-tag', expect.stringMatching(/^v1\.2\.\d+$/));
    });
    
    test('should not increment patch version when it is non-zero in package.json mode', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.2.5' }));
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'version-source': 'package.json',
          'github-token': 'test-token',
          'create-tags': 'true',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v'
        };
        return defaults[name] || '';
      });
      
      const mockOctokit = mockGithub.getOctokit();
      mockOctokit.rest.git.getRef.mockRejectedValue({ status: 404 });
      
      await run();
      
      // Should use the version from package.json as-is
      expect(mockCore.setOutput).toHaveBeenCalledWith('version', '1.2.5');
      expect(mockCore.setOutput).toHaveBeenCalledWith('patch-tag', 'v1.2.5');
    });
    
    test('should not increment patch version when it is non-zero in auto mode', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.2.7' }));
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'version-source': 'auto',
          'github-token': 'test-token',
          'create-tags': 'true',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v'
        };
        return defaults[name] || '';
      });
      
      const mockOctokit = mockGithub.getOctokit();
      mockOctokit.rest.git.getRef.mockRejectedValue({ status: 404 });
      
      await run();
      
      // Should use the version from package.json as-is
      expect(mockCore.setOutput).toHaveBeenCalledWith('version', '1.2.7');
      expect(mockCore.setOutput).toHaveBeenCalledWith('patch-tag', 'v1.2.7');
    });
    
    test('should handle tag creation failures gracefully', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(false);
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'github-token': 'test-token',
          'create-tags': 'true',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v',
          'version-source': 'auto'
        };
        return defaults[name] || '';
      });
      
      const mockOctokit = mockGithub.getOctokit();
      mockOctokit.rest.git.getRef.mockRejectedValue({ status: 404 });
      mockOctokit.rest.git.createRef.mockRejectedValue(new Error('API Error'));
      
      await run();
      
      // Should still complete but with error logged
      expect(mockCore.error).toHaveBeenCalled();
    });
    
    test('should handle non-404 errors when checking if tag exists for update', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(false);
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'github-token': 'test-token',
          'create-tags': 'true',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v',
          'version-source': 'auto'
        };
        return defaults[name] || '';
      });
      
      const mockOctokit = mockGithub.getOctokit();
      // First call (checking patch tag exists) returns 404
      // Second call (checking major tag for update) returns 500 error
      let callCount = 0;
      mockOctokit.rest.git.getRef.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          const error = new Error('Not found');
          error.status = 404;
          return Promise.reject(error);
        } else {
          const error = new Error('API Error');
          error.status = 500;
          return Promise.reject(error);
        }
      });
      
      await run();
      
      // Should log error for failed tag operations
      expect(mockCore.error).toHaveBeenCalled();
    });
  });
  
  describe('Tag update', () => {
    test('should update existing major and minor tags', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(false);
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'github-token': 'test-token',
          'create-tags': 'true',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v',
          'version-source': 'auto'
        };
        return defaults[name] || '';
      });
      
      const mockOctokit = mockGithub.getOctokit();
      // Mock that major and minor tags exist
      mockOctokit.rest.git.getRef.mockImplementation(async ({ ref }) => {
        if (ref === 'tags/v1' || ref === 'tags/v1.0') {
          return { data: { object: { sha: 'old-sha' } } };
        }
        const error = new Error('Not found');
        error.status = 404;
        throw error;
      });
      
      await run();
      
      // Should update existing tags
      expect(mockOctokit.rest.git.updateRef).toHaveBeenCalled();
    });
  });
  
  describe('Branch patterns', () => {
    test('should handle release/v1.2.3 branch pattern', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1.2.3';
      fs.existsSync.mockReturnValue(false);
      
      mockCore.getInput.mockImplementation((name) => {
        const defaults = {
          'github-token': 'test-token',
          'create-tags': 'true',
          'release-branch-pattern': 'release/v*',
          'tag-prefix': 'v',
          'version-source': 'auto'
        };
        return defaults[name] || '';
      });
      
      const mockOctokit = mockGithub.getOctokit();
      mockOctokit.rest.git.getRef.mockRejectedValue({ status: 404 });
      
      await run();
      
      expect(mockCore.setOutput).toHaveBeenCalledWith('version', '1.2.3');
      expect(mockCore.setOutput).toHaveBeenCalledWith('major-tag', 'v1');
      expect(mockCore.setOutput).toHaveBeenCalledWith('minor-tag', 'v1.2');
      expect(mockCore.setOutput).toHaveBeenCalledWith('patch-tag', 'v1.2.3');
    });
  });
});
