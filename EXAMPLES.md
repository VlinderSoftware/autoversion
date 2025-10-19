# Autoversion Examples

This document provides detailed examples of how the Autoversion action works in different scenarios.

## Scenario 1: First Release on release/v1 Branch

### Setup
- Branch: `release/v1`
- No existing tags
- No package.json or package.json doesn't have version

### What happens
1. Action detects branch name `release/v1`
2. Extracts major version: 1, minor: 0
3. Checks for existing `v1.0.*` tags - finds none
4. Creates patch version: 0
5. Creates three tags:
   - `v1` → points to current commit
   - `v1.0` → points to current commit
   - `v1.0.0` → points to current commit

## Scenario 2: Second Release on release/v1 Branch

### Setup
- Branch: `release/v1`
- Existing tags: `v1`, `v1.0`, `v1.0.0` (all pointing to an older commit)
- No package.json or package.json doesn't have version

### What happens
1. Action detects branch name `release/v1`
2. Extracts major version: 1, minor: 0
3. Checks for existing `v1.0.*` tags - finds `v1.0.0`
4. Creates next patch version: 1
5. Updates/creates tags:
   - `v1` → **updated** to point to current commit
   - `v1.0` → **updated** to point to current commit
   - `v1.0.1` → **created** pointing to current commit

## Scenario 3: Node.js Project with package.json

### Setup
- Branch: `release/v2`
- package.json contains: `"version": "2.1.3"`
- Existing tags: `v2`, `v2.0`, `v2.0.0`, `v2.1.0`, `v2.1.1`, `v2.1.2`

### What happens
1. Action detects branch name `release/v2`
2. Reads version from package.json: `2.1.3`
3. Creates/updates tags:
   - `v2` → **updated** to point to current commit
   - `v2.1` → **updated** to point to current commit
   - `v2.1.3` → **created** pointing to current commit

**Note:** When using package.json, the action uses the exact version from the file and does NOT auto-increment the patch version.

## Scenario 4: Multiple Minor Versions

### Setup
- Branch: `release/v1.2`
- Existing tags: `v1`, `v1.0`, `v1.0.0`, `v1.1`, `v1.1.0`, `v1.1.1`
- No package.json

### What happens
1. Action detects branch name `release/v1.2`
2. Extracts major: 1, minor: 2
3. Checks for existing `v1.2.*` tags - finds none
4. Creates patch version: 0
5. Creates/updates tags:
   - `v1` → **updated** to point to current commit (always points to latest across all minors)
   - `v1.2` → **created** pointing to current commit
   - `v1.2.0` → **created** pointing to current commit

## Scenario 5: Manual Version Specification

### Workflow Configuration
```yaml
- name: Create version tags
  uses: VlinderSoftware/autoversion@v1
  with:
    version-source: manual
    major-version: '3'
    minor-version: '5'
    patch-version: '2'
```

### What happens
1. Action uses manual version: `3.5.2`
2. Creates/updates tags:
   - `v3` → created/updated
   - `v3.5` → created/updated
   - `v3.5.2` → created/updated

## Scenario 6: Custom Tag Prefix

### Workflow Configuration
```yaml
- name: Create version tags
  uses: VlinderSoftware/autoversion@v1
  with:
    tag-prefix: 'release-'
```

### Setup
- Branch: `release/v1`

### What happens
1. Creates tags with custom prefix:
   - `release-1`
   - `release-1.0`
   - `release-1.0.0`

## Version Detection Priority (Auto Mode)

When `version-source` is set to `auto` (the default), the action follows this priority:

1. **package.json** - If file exists and has a version field, use it
2. **Branch name** - Extract version from branch name (e.g., `release/v1.2`)

Example decision tree:
```
Does package.json exist and have a version?
├─ YES → Use version from package.json (e.g., "1.2.3")
└─ NO  → Extract from branch name
         ├─ Branch: release/v1 → Version: 1.0.0 (auto-increment patch)
         ├─ Branch: release/v2.1 → Version: 2.1.0 (auto-increment patch)
         └─ Branch: release/v3.2.1 → Version: 3.2.1 (use as-is)
```

## Common Use Cases

### Use Case 1: Continuous Deployment from Release Branch

```yaml
name: Deploy to Production

on:
  push:
    branches:
      - 'release/v*'

jobs:
  version-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Create version tags
        id: version
        uses: VlinderSoftware/autoversion@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Build and deploy
        run: |
          echo "Deploying version ${{ steps.version.outputs.version }}"
          # Your deployment commands here
```

### Use Case 2: Create GitHub Release After Versioning

```yaml
name: Release

on:
  push:
    branches:
      - 'release/v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Create version tags
        id: version
        uses: VlinderSoftware/autoversion@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Create GitHub Release
        uses: actions/create-release@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tag_name: ${{ steps.version.outputs.patch-tag }}
          release_name: Release ${{ steps.version.outputs.version }}
          draft: false
          prerelease: false
```

### Use Case 3: Version Node.js Package from package.json

```yaml
name: Publish Package

on:
  push:
    branches:
      - 'release/v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      
      - name: Create version tags
        id: version
        uses: VlinderSoftware/autoversion@v1
        with:
          version-source: package.json
          github-token: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Publish to NPM
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Version-Only Mode for Separate Workflows

### Use Case: Get Version for Build, Create Tags After Release

```yaml
name: Build and Release

on:
  push:
    branches:
      - 'release/v*'

jobs:
  determine-version:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.version.outputs.version }}
      major-tag: ${{ steps.version.outputs.major-tag }}
      minor-tag: ${{ steps.version.outputs.minor-tag }}
      patch-tag: ${{ steps.version.outputs.patch-tag }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Determine version (don't create tags yet)
        id: version
        uses: VlinderSoftware/autoversion@v1
        with:
          create-tags: false
  
  build-and-test:
    needs: determine-version
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Build version ${{ needs.determine-version.outputs.version }}
        run: |
          echo "Building ${{ needs.determine-version.outputs.version }}"
          # npm version ${{ needs.determine-version.outputs.version }} --no-git-tag-version
          # npm run build
          # npm test
  
  create-release:
    needs: [determine-version, build-and-test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Create version tags
        uses: VlinderSoftware/autoversion@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Create GitHub Release
        uses: actions/create-release@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tag_name: ${{ needs.determine-version.outputs.patch-tag }}
          release_name: Release ${{ needs.determine-version.outputs.version }}
          draft: false
          prerelease: false
```

This pattern ensures that tags are only created after successful build and test, preventing pollution of the tag namespace with broken releases.
