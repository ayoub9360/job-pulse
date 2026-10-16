# Contributing

Use Node.js 24 and pnpm 10.34.7. Install with `pnpm install --frozen-lockfile`.

Before submitting a change, run `pnpm test`, `pnpm check` and `pnpm build`. Use `pnpm format` for formatting. Keep changes focused and describe the behavior change and validation in your pull request.

Tests must work without `.env`, private configuration or live credentials. Use synthetic fixtures and local HTTP servers; never send real Discord messages from tests. Add regression tests for meaningful behavior changes. Preserve unknown values instead of guessing source data.

Keep deployment configuration outside Git. Do not commit secrets, job advertisements, personal searches, logs or state files. See [architecture](docs/architecture.md) for provider integration and [security](SECURITY.md) for vulnerability reporting.

Contributions are distributed under the repository's MIT license. Only contribute material you have the right to distribute.
