# Contributing to two-layer-cake

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

1. **Prerequisites**: Node.js >= 18, pnpm >= 9.15
2. **Clone and install**:
   ```bash
   git clone https://github.com/GeorgeQLe/two-layer-cake.git
   cd two-layer-cake
   pnpm install
   ```
3. **Build all packages**:
   ```bash
   pnpm build
   ```
4. **Run tests**:
   ```bash
   pnpm test
   ```

## Project Structure

```
packages/
  core/             # Main SDK (two-layer-cake)
  adapter-claude/   # Claude LLM adapter
  adapter-openai/   # OpenAI LLM adapter
```

## PR Workflow

1. Fork the repository and create a feature branch from `main`
2. Make your changes
3. Add or update tests for any changed behavior
4. Run the full check suite:
   ```bash
   pnpm build && pnpm test && pnpm lint && pnpm type-check
   ```
5. Add a changeset describing your change:
   ```bash
   pnpm changeset
   ```
6. Open a pull request against `main`

## Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `test:` — adding or updating tests
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `chore:` — build, tooling, or dependency changes

## Testing Requirements

- All new code must include unit tests
- Maintain >= 80% coverage across statements, branches, functions, and lines
- Tests must not depend on real API keys or network access
- Use `MockLLMAdapter` and `TestOrchestrator` from `two-layer-cake/testing` for integration tests

## Code Style

- TypeScript strict mode
- Use `type` imports for type-only imports
- ESLint and Prettier are enforced via pre-commit hooks
- Follow existing patterns in the codebase

## Questions?

Open an issue or start a discussion on GitHub.
