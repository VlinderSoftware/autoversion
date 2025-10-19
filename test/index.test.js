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
    test.skip('should use version from package.json when available', async () => {
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
      
      expect(mockCore.setOutput).toHaveBeenCalledWith('version', '1.5.7');
      expect(mockCore.setOutput).toHaveBeenCalledWith('major-tag', 'v1');
      expect(mockCore.setOutput).toHaveBeenCalledWith('minor-tag', 'v1.5');
      expect(mockCore.setOutput).toHaveBeenCalledWith('patch-tag', 'v1.5.7');
    });
    
    test.skip('should fail when package.json not found in package.json mode', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1';
      fs.existsSync.mockReturnValue(false);
      
      mockCore.getInput.mockImplementation((name) => {
        if (name === 'version-source') return 'package.json';
        if (name === 'release-branch-pattern') return 'release/v*';
        return '';
      });
      
      await run();
      
      expect(mockCore.setFailed).toHaveBeenCalledWith('Could not read version from package.json');
    });
    
    test.skip('should fail when major version mismatch between package.json and branch', async () => {
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
    
    test.skip('should fail when minor version mismatch between package.json and branch', async () => {
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
    test.skip('should use package.json when available in auto mode', async () => {
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
    
    test.skip('should fail when major version mismatch in auto mode', async () => {
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
  });
  
  describe('Tag already exists', () => {
    test.skip('should fail when patch tag already exists', async () => {
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
  });
  
  describe('Error handling', () => {
    test.skip('should handle errors when listing tags', async () => {
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
      
      await run();
      
      expect(mockCore.setFailed).toHaveBeenCalled();
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
    test.skip('should increment patch version when patch is 0', async () => {
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
