# Autoversion

A GitHub Action to automatically tag and version software using semantic versioning on release branches.

## Features

- 🏷️ **Automatic semantic versioning** - Creates git tags following semantic versioning (v1, v1.0, v1.0.0)
- 🔄 **Tag updates** - Updates major and minor tags to point to the latest release
- 📦 **Node.js integration** - Automatically reads version from package.json
- 🌿 **Release branch support** - Works with release branches (e.g., release/v1, release/v2.1)
- ⚙️ **Flexible configuration** - Multiple version sources: auto-detection, package.json, or manual

## Usage

### As a Direct Action

Use the action directly in your workflow:

```yaml
name: Release

on:
  push:
    branches:
      - 'release/v*'

jobs:
  version:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Create version tags
        uses: VlinderSoftware/autoversion@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### As a Reusable Workflow

Use the reusable workflow for easier setup:

```yaml
name: Release

on:
  push:
    branches:
      - 'release/v*'

jobs:
  version:
    uses: VlinderSoftware/autoversion/.github/workflows/autoversion.yml@v1
    secrets:
      github-token: ${{ secrets.GITHUB_TOKEN }}
```

## How It Works

### Release Branch Pattern

When you push to a release branch like `release/v1`:

1. The action detects the branch name
2. For Node.js projects, it reads the version from `package.json`
3. Otherwise, it extracts the version from the branch name
4. It creates/updates three tags:
   - `v1` (major version tag)
   - `v1.0` (minor version tag)
   - `v1.0.0` (patch version tag)

### Version Detection

The action supports multiple version sources (controlled by `version-source` input):

- **`auto`** (default): First tries to read from package.json, then falls back to branch name
- **`package.json`**: Reads version only from package.json
- **`manual`**: Uses manually specified major, minor, and patch versions

### Tag Management

- **First release** on `release/v1`: Creates tags `v1`, `v1.0`, and `v1.0.0`
- **Subsequent releases** on `release/v1`: Updates `v1` and `v1.0` tags to point to the latest commit, creates new patch tag (e.g., `v1.0.1`, `v1.0.2`)

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `release-branch-pattern` | Pattern to match release branches | No | `release/v*` |
| `version-source` | Source of version: `auto`, `package.json`, or `manual` | No | `auto` |
| `major-version` | Major version (when version-source is `manual`) | No | - |
| `minor-version` | Minor version (when version-source is `manual`) | No | - |
| `patch-version` | Patch version (when version-source is `manual`) | No | - |
| `tag-prefix` | Prefix for version tags | No | `v` |
| `github-token` | GitHub token for creating tags | Yes | - |

## Outputs

| Output | Description | Example |
|--------|-------------|---------|
| `version` | The full semantic version | `1.0.0` |
| `tags` | Comma-separated list of tags created/updated | `v1,v1.0,v1.0.0` |
| `major-tag` | The major version tag | `v1` |
| `minor-tag` | The minor version tag | `v1.0` |
| `patch-tag` | The full semantic version tag | `v1.0.0` |

## Examples

### Node.js Project with package.json

```yaml
name: Release

on:
  push:
    branches:
      - 'release/v*'

jobs:
  version:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Create version tags
        uses: VlinderSoftware/autoversion@v1
        with:
          version-source: package.json
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Manual Version Specification

```yaml
name: Release

on:
  push:
    branches:
      - 'release/v*'

jobs:
  version:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Create version tags
        uses: VlinderSoftware/autoversion@v1
        with:
          version-source: manual
          major-version: '2'
          minor-version: '1'
          patch-version: '0'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Custom Tag Prefix

```yaml
name: Release

on:
  push:
    branches:
      - 'release/v*'

jobs:
  version:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Create version tags
        uses: VlinderSoftware/autoversion@v1
        with:
          tag-prefix: 'version-'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

This will create tags like `version-1`, `version-1.0`, `version-1.0.0`.

## License

MIT - see [LICENSE](LICENSE) file for details.
