# Contributing to Autoversion

Thank you for considering contributing to Autoversion! This document provides guidelines for contributing to the project.

## Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/VlinderSoftware/autoversion.git
   cd autoversion
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Make your changes in the `src/` directory

4. Build the action:
   ```bash
   npm run build
   ```

## Project Structure

```
autoversion/
├── .github/
│   └── workflows/
│       ├── autoversion.yml   # Reusable workflow
│       └── test.yml           # Test workflow
├── dist/                      # Compiled action code (committed)
├── src/
│   └── index.js              # Main action source code
├── action.yml                # Action metadata
├── package.json              # Node.js dependencies
├── README.md                 # Main documentation
└── EXAMPLES.md               # Usage examples
```

## Making Changes

### Source Code

- All source code is in `src/index.js`
- Follow existing code style and patterns
- Add comments for complex logic
- Handle errors gracefully

### Building

After making changes to `src/index.js`, you must rebuild:

```bash
npm run build
```

This compiles the source code into `dist/index.js` using `ncc`. The `dist/` directory **must be committed** because GitHub Actions runs the compiled code.

### Testing

Before submitting changes:

1. Build the action: `npm run build`
2. Test locally if possible
3. Verify the action metadata is valid: Check `action.yml`
4. Ensure no new dependencies have vulnerabilities: `npm audit`

## Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes
4. Build the action: `npm run build`
5. Commit both source and dist files
6. Push to your fork
7. Open a Pull Request

### Pull Request Guidelines

- Provide a clear description of the changes
- Reference any related issues
- Include examples of how to use new features
- Update documentation (README.md, EXAMPLES.md) if needed
- Ensure the action builds successfully
- Test the changes if possible

## Code Style

- Use ES6+ features where appropriate
- Use async/await for asynchronous operations
- Provide meaningful variable and function names
- Add JSDoc comments for functions
- Handle errors with try/catch and provide helpful error messages

## Security

- Never commit secrets or tokens
- Validate all user inputs
- Escape special characters in regular expressions
- Use the `@actions/core` library for logging (never log sensitive data)
- Run `npm audit` to check for vulnerable dependencies

## Reporting Issues

When reporting issues, please include:

- A clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Relevant workflow configuration
- Action version or commit SHA

## Questions?

Feel free to open an issue for questions or discussions about the project.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
