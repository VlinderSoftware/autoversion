const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');

/**
 * Get version information from package.json
 */
function getVersionFromPackageJson() {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (packageJson.version) {
        const versionParts = packageJson.version.split('.');
        return {
          major: parseInt(versionParts[0]) || 0,
          minor: parseInt(versionParts[1]) || 0,
          patch: parseInt(versionParts[2]) || 0
        };
      }
    }
  } catch (error) {
    core.debug(`Could not read package.json: ${error.message}`);
  }
  return null;
}

/**
 * Extract version from release branch name
 * e.g., release/v1 -> { major: 1, minor: 0, patch: 0 }
 */
function getVersionFromBranchName(branchName, pattern) {
  // Remove refs/heads/ prefix if present
  branchName = branchName.replace('refs/heads/', '');
  
  // Extract version from branch name
  // Supports patterns like: release/v1, release/v1.2, release/v1.2.3
  const match = branchName.match(/release\/v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  
  if (match) {
    return {
      major: parseInt(match[1]) || 0,
      minor: parseInt(match[2]) || 0,
      patch: parseInt(match[3]) || 0
    };
  }
  
  return null;
}

/**
 * Get the next patch version by checking existing tags
 */
async function getNextPatchVersion(octokit, owner, repo, major, minor) {
  try {
    const { data: tags } = await octokit.rest.repos.listTags({
      owner,
      repo,
      per_page: 100
    });
    
    // Filter tags matching our major.minor version
    const prefix = core.getInput('tag-prefix') || 'v';
    // Escape special regex characters in prefix to prevent ReDoS
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedPrefix}${major}\\.${minor}\\.(\\d+)$`);
    
    let maxPatch = -1;
    for (const tag of tags) {
      const match = tag.name.match(pattern);
      if (match) {
        const patchNum = parseInt(match[1]);
        if (patchNum > maxPatch) {
          maxPatch = patchNum;
        }
      }
    }
    
    return maxPatch + 1;
  } catch (error) {
    core.warning(`Could not fetch existing tags: ${error.message}`);
    return 0;
  }
}

/**
 * Create or update a git tag
 */
async function createOrUpdateTag(octokit, owner, repo, tagName, sha, message) {
  try {
    // Check if tag exists
    let tagExists = false;
    try {
      await octokit.rest.git.getRef({
        owner,
        repo,
        ref: `tags/${tagName}`
      });
      tagExists = true;
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
    }
    
    if (tagExists) {
      // Update existing tag
      core.info(`Updating existing tag: ${tagName}`);
      await octokit.rest.git.updateRef({
        owner,
        repo,
        ref: `tags/${tagName}`,
        sha,
        force: true
      });
    } else {
      // Create new tag
      core.info(`Creating new tag: ${tagName}`);
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/tags/${tagName}`,
        sha
      });
    }
    
    return true;
  } catch (error) {
    core.error(`Failed to create/update tag ${tagName}: ${error.message}`);
    return false;
  }
}

/**
 * Main action logic
 */
async function run() {
  try {
    // Get inputs
    const releaseBranchPattern = core.getInput('release-branch-pattern') || 'release/v*';
    const versionSource = core.getInput('version-source') || 'auto';
    const tagPrefix = core.getInput('tag-prefix') || 'v';
    const createTags = core.getInput('create-tags') !== 'false';
    const token = core.getInput('github-token');
    
    if (createTags && !token) {
      core.setFailed('github-token is required when create-tags is true');
      return;
    }
    
    // Get GitHub context
    const context = github.context;
    const currentBranch = context.ref;
    
    core.info(`Current branch: ${currentBranch}`);
    core.info(`Version source: ${versionSource}`);
    core.info(`Create tags: ${createTags}`);
    
    // Check if we're on a release branch
    const branchName = currentBranch.replace('refs/heads/', '');
    if (!branchName.startsWith('release/')) {
      core.warning('Not on a release branch. Skipping versioning.');
      return;
    }
    
    // Determine version
    let version = null;
    
    if (versionSource === 'manual') {
      // Use manually specified version
      const major = parseInt(core.getInput('major-version')) || 0;
      const minor = parseInt(core.getInput('minor-version')) || 0;
      const patch = parseInt(core.getInput('patch-version')) || 0;
      version = { major, minor, patch };
      core.info(`Using manual version: ${major}.${minor}.${patch}`);
    } else if (versionSource === 'package.json') {
      // Get version from package.json
      version = getVersionFromPackageJson();
      if (!version) {
        core.setFailed('Could not read version from package.json');
        return;
      }
      core.info(`Using version from package.json: ${version.major}.${version.minor}.${version.patch}`);
    } else {
      // Auto mode: try package.json first, then branch name
      version = getVersionFromPackageJson();
      
      if (version) {
        core.info(`Auto-detected version from package.json: ${version.major}.${version.minor}.${version.patch}`);
      } else {
        // Fall back to branch name
        version = getVersionFromBranchName(branchName, releaseBranchPattern);
        
        if (version) {
          core.info(`Auto-detected version from branch name: ${version.major}.${version.minor}.${version.patch}`);
          
          // If patch is 0 from branch name, get next patch version
          if (version.patch === 0 && createTags && token) {
            const octokit = github.getOctokit(token);
            const { owner, repo } = context.repo;
            version.patch = await getNextPatchVersion(octokit, owner, repo, version.major, version.minor);
            core.info(`Determined next patch version: ${version.patch}`);
          }
        } else {
          core.setFailed('Could not determine version from any source');
          return;
        }
      }
    }
    
    // Prepare tag names
    const majorTag = `${tagPrefix}${version.major}`;
    const minorTag = `${tagPrefix}${version.major}.${version.minor}`;
    const patchTag = `${tagPrefix}${version.major}.${version.minor}.${version.patch}`;
    
    const createdTags = [];
    
    // Create tags if requested
    if (createTags) {
      const octokit = github.getOctokit(token);
      const { owner, repo } = context.repo;
      const sha = context.sha;
      
      // Create/update tags
      if (await createOrUpdateTag(octokit, owner, repo, majorTag, sha, `Release ${majorTag}`)) {
        createdTags.push(majorTag);
      }
      
      if (await createOrUpdateTag(octokit, owner, repo, minorTag, sha, `Release ${minorTag}`)) {
        createdTags.push(minorTag);
      }
      
      if (await createOrUpdateTag(octokit, owner, repo, patchTag, sha, `Release ${patchTag}`)) {
        createdTags.push(patchTag);
      }
      
      core.info(`✅ Successfully created/updated tags: ${createdTags.join(', ')}`);
    }
    
    // Set outputs
    const versionString = `${version.major}.${version.minor}.${version.patch}`;
    core.setOutput('version', versionString);
    core.setOutput('tags', createdTags.join(','));
    core.setOutput('major-tag', majorTag);
    core.setOutput('minor-tag', minorTag);
    core.setOutput('patch-tag', patchTag);
    
    if (createTags) {
      core.info(`Version: ${versionString}`);
    } else {
      core.info(`✅ Version determined (tags not created): ${versionString}`);
    }
    
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

// Export for testing
module.exports = { run };

// Only run if this is the main module (not being imported for tests)
if (require.main === module) {
  run();
}
