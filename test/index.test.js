const fs = require('fs');

const mockCore = {
  getInput: jest.fn(),
  setOutput: jest.fn(),
  setFailed: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  debug: jest.fn(),
  error: jest.fn()
};

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
jest.mock('fs');

const {
  getVersionFromPackageJson,
  getVersionFromBranchName,
  getNextPatchVersion,
  createOrUpdateTag,
  run
} = require('../src/index.js');

describe('Autoversion Action', () => {
  const defaultInputs = {
    'release-branch-pattern': 'release/v*',
    'version-source': 'auto',
    'tag-prefix': 'v',
    'create-tags': 'true',
    'github-token': 'test-token',
    'major-version': '',
    'minor-version': '',
    'patch-version': ''
  };

  let octokit;

  const setInputs = (overrides = {}) => {
    const inputs = { ...defaultInputs, ...overrides };
    mockCore.getInput.mockImplementation((name) => inputs[name] ?? '');
  };

  const makeNotFoundError = () => {
    const error = new Error('Not found');
    error.status = 404;
    return error;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockGithub.context.ref = 'refs/heads/release/v1';
    mockGithub.context.sha = 'abc123def456';
    mockGithub.context.repo = { owner: 'test-owner', repo: 'test-repo' };

    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockReturnValue('{}');
    delete process.env.GITHUB_WORKSPACE;

    octokit = {
      rest: {
        repos: {
          listTags: jest.fn().mockResolvedValue({ data: [] })
        },
        git: {
          getRef: jest.fn().mockRejectedValue(makeNotFoundError()),
          createRef: jest.fn().mockResolvedValue({}),
          updateRef: jest.fn().mockResolvedValue({})
        }
      }
    };

    mockGithub.getOctokit.mockReturnValue(octokit);
    setInputs();
  });

  describe('getVersionFromPackageJson', () => {
    test('reads version from the GitHub workspace package.json', () => {
      process.env.GITHUB_WORKSPACE = '/workspace';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '2.4.6' }));

      expect(getVersionFromPackageJson()).toEqual({ major: 2, minor: 4, patch: 6 });
      expect(fs.existsSync).toHaveBeenCalledWith('/workspace/package.json');
      expect(mockCore.debug).toHaveBeenCalled();
    });

    test('returns null and warns when package.json has no version field', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ name: 'autoversion-action' }));

      expect(getVersionFromPackageJson()).toBeNull();
      expect(mockCore.warning).toHaveBeenCalledWith('package.json exists but has no version field');
    });

    test('returns null and logs an error when package.json cannot be parsed', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('{invalid json');

      expect(getVersionFromPackageJson()).toBeNull();
      expect(mockCore.error).toHaveBeenCalledWith(expect.stringContaining('Could not read package.json'));
    });
  });

  describe('getVersionFromBranchName', () => {
    test('parses major-only release branches', () => {
      expect(getVersionFromBranchName('refs/heads/release/v3')).toEqual({
        major: 3,
        minor: 0,
        patch: 0,
        minorSpecified: false,
        patchSpecified: false
      });
    });

    test('parses release branches with explicit minor and patch versions', () => {
      expect(getVersionFromBranchName('release/v3.4.5')).toEqual({
        major: 3,
        minor: 4,
        patch: 5,
        minorSpecified: true,
        patchSpecified: true
      });
    });

    test('returns null for non-release branches', () => {
      expect(getVersionFromBranchName('feature/test-branch')).toBeNull();
    });
  });

  describe('getNextPatchVersion', () => {
    test('returns the next patch version using the highest matching tag', async () => {
      setInputs({ 'tag-prefix': 'release+' });
      octokit.rest.repos.listTags.mockResolvedValue({
        data: [
          { name: 'release+1.2.0' },
          { name: 'release+1.2.7' },
          { name: 'release+1.3.0' }
        ]
      });

      await expect(getNextPatchVersion(octokit, 'test-owner', 'test-repo', 1, 2)).resolves.toBe(8);
    });

    test('falls back to zero when listing tags fails', async () => {
      octokit.rest.repos.listTags.mockRejectedValue(new Error('API unavailable'));

      await expect(getNextPatchVersion(octokit, 'test-owner', 'test-repo', 1, 2)).resolves.toBe(0);
      expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('Could not fetch existing tags'));
    });
  });

  describe('createOrUpdateTag', () => {
    test('creates a tag when it does not already exist', async () => {
      await expect(createOrUpdateTag(octokit, 'test-owner', 'test-repo', 'v1.2.3', 'sha123')).resolves.toBe(true);

      expect(octokit.rest.git.createRef).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        ref: 'refs/tags/v1.2.3',
        sha: 'sha123'
      });
      expect(octokit.rest.git.updateRef).not.toHaveBeenCalled();
    });

    test('updates an existing tag in place', async () => {
      octokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'old-sha' } } });

      await expect(createOrUpdateTag(octokit, 'test-owner', 'test-repo', 'v1', 'sha123')).resolves.toBe(true);

      expect(octokit.rest.git.updateRef).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        ref: 'tags/v1',
        sha: 'sha123',
        force: true
      });
      expect(octokit.rest.git.createRef).not.toHaveBeenCalled();
    });

    test('returns false when the GitHub API errors unexpectedly', async () => {
      const error = new Error('API failure');
      error.status = 500;
      octokit.rest.git.getRef.mockRejectedValue(error);

      await expect(createOrUpdateTag(octokit, 'test-owner', 'test-repo', 'v1', 'sha123')).resolves.toBe(false);
      expect(mockCore.error).toHaveBeenCalledWith(expect.stringContaining('Failed to create/update tag v1'));
    });
  });

  describe('run', () => {
    test('fails fast when create-tags is true and no token is provided', async () => {
      setInputs({ 'github-token': '' });

      await run();

      expect(mockCore.setFailed).toHaveBeenCalledWith('github-token is required when create-tags is true');
      expect(mockGithub.getOctokit).not.toHaveBeenCalled();
    });

    test('skips versioning outside release branches', async () => {
      mockGithub.context.ref = 'refs/heads/main';

      await run();

      expect(mockCore.warning).toHaveBeenCalledWith('Not on a release branch. Skipping versioning.');
      expect(mockCore.setOutput).not.toHaveBeenCalled();
    });

    test('returns version outputs without touching GitHub when create-tags is false', async () => {
      setInputs({
        'version-source': 'manual',
        'major-version': '4',
        'minor-version': '1',
        'patch-version': '9',
        'create-tags': 'false',
        'github-token': ''
      });

      await run();

      expect(mockGithub.getOctokit).not.toHaveBeenCalled();
      expect(mockCore.setOutput).toHaveBeenCalledWith('version', '4.1.9');
      expect(mockCore.setOutput).toHaveBeenCalledWith('tags', '');
      expect(mockCore.setOutput).toHaveBeenCalledWith('major-tag', 'v4');
      expect(mockCore.setOutput).toHaveBeenCalledWith('minor-tag', 'v4.1');
      expect(mockCore.setOutput).toHaveBeenCalledWith('patch-tag', 'v4.1.9');
    });

    test('increments patch versions in auto mode from the highest matching existing tag', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.2.0' }));
      octokit.rest.repos.listTags.mockResolvedValue({
        data: [{ name: 'v1.2.0' }, { name: 'v1.2.1' }, { name: 'v1.2.9' }]
      });
      octokit.rest.git.getRef.mockImplementation(async ({ ref }) => {
        if (ref === 'tags/v1' || ref === 'tags/v1.2') {
          return { data: { object: { sha: 'old-sha' } } };
        }
        throw makeNotFoundError();
      });

      await run();

      expect(mockCore.setOutput).toHaveBeenCalledWith('version', '1.2.10');
      expect(octokit.rest.git.updateRef).toHaveBeenCalledTimes(2);
      expect(octokit.rest.git.createRef).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        ref: 'refs/tags/v1.2.10',
        sha: 'abc123def456'
      });
      expect(mockCore.setOutput).toHaveBeenCalledWith('tags', 'v1,v1.2,v1.2.10');
    });

    test('allows package.json minor versions when the release branch only specifies the major', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.3.7' }));
      setInputs({
        'version-source': 'package.json',
        'create-tags': 'false',
        'github-token': ''
      });

      await run();

      expect(mockCore.setFailed).not.toHaveBeenCalled();
      expect(mockCore.setOutput).toHaveBeenCalledWith('version', '1.3.7');
      expect(mockCore.setOutput).toHaveBeenCalledWith('patch-tag', 'v1.3.7');
    });

    test('fails in package.json mode when no readable version is available', async () => {
      fs.existsSync.mockReturnValue(false);
      setInputs({
        'version-source': 'package.json',
        'create-tags': 'false',
        'github-token': ''
      });

      await run();

      expect(mockCore.setFailed).toHaveBeenCalledWith('Could not read version from package.json');
    });

    test('fails in package.json mode when the branch major does not match', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '2.0.1' }));
      setInputs({ 'version-source': 'package.json' });

      await run();

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        'Version mismatch: package.json has major version 2 but release branch indicates v1'
      );
    });

    test('fails when package.json minor version does not match an explicit branch minor', async () => {
      mockGithub.context.ref = 'refs/heads/release/v2.1';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '2.0.9' }));
      setInputs({ 'version-source': 'package.json' });

      await run();

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        'Version mismatch: package.json has minor version 0 but release branch indicates v2.1'
      );
    });

    test('increments patch versions in package.json mode when the declared patch is zero', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.7.0' }));
      setInputs({ 'version-source': 'package.json' });
      octokit.rest.repos.listTags.mockResolvedValue({
        data: [{ name: 'v1.7.0' }, { name: 'v1.7.4' }]
      });

      await run();

      expect(mockCore.setOutput).toHaveBeenCalledWith('version', '1.7.5');
      expect(mockCore.info).toHaveBeenCalledWith('Auto-incremented patch version to: 5');
    });

    test('falls back to branch-derived versions in auto mode when package.json is absent', async () => {
      mockGithub.context.ref = 'refs/heads/release/v5.4.3';
      fs.existsSync.mockReturnValue(false);

      await run();

      expect(mockCore.setOutput).toHaveBeenCalledWith('version', '5.4.3');
      expect(mockCore.setOutput).toHaveBeenCalledWith('patch-tag', 'v5.4.3');
    });

    test('increments patch versions from branch-derived releases when the branch omits a patch', async () => {
      mockGithub.context.ref = 'refs/heads/release/v5.4';
      fs.existsSync.mockReturnValue(false);
      octokit.rest.repos.listTags.mockResolvedValue({
        data: [{ name: 'v5.4.0' }, { name: 'v5.4.2' }]
      });

      await run();

      expect(mockCore.setOutput).toHaveBeenCalledWith('version', '5.4.3');
      expect(mockCore.info).toHaveBeenCalledWith('Determined next patch version: 3');
    });

    test('fails in auto mode when package.json major does not match the release branch', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '3.1.0' }));

      await run();

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        'Version mismatch: package.json has major version 3 but release branch indicates v1'
      );
    });

    test('fails in auto mode when the release branch specifies a different minor version', async () => {
      mockGithub.context.ref = 'refs/heads/release/v1.4';
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.3.0' }));

      await run();

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        'Version mismatch: package.json has minor version 3 but release branch indicates v1.4'
      );
    });

    test('fails in auto mode when neither package.json nor the branch name yields a version', async () => {
      mockGithub.context.ref = 'refs/heads/release/not-a-version';
      fs.existsSync.mockReturnValue(false);

      await run();

      expect(mockCore.setFailed).toHaveBeenCalledWith('Could not determine version from any source');
    });

    test('fails before creating tags when the exact patch tag already exists', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.2.3' }));
      setInputs({ 'version-source': 'package.json' });
      octokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'existing-sha' } } });

      await run();

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        'Tag v1.2.3 already exists. Cannot create duplicate version tag.'
      );
      expect(octokit.rest.git.createRef).not.toHaveBeenCalled();
      expect(octokit.rest.git.updateRef).not.toHaveBeenCalled();
    });

    test('surfaces unexpected GitHub errors through the action failure path', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.2.3' }));
      setInputs({ 'version-source': 'package.json' });
      const error = new Error('Server exploded');
      error.status = 500;
      octokit.rest.git.getRef.mockRejectedValue(error);

      await run();

      expect(mockCore.setFailed).toHaveBeenCalledWith('Action failed: Server exploded');
    });
  });
});
