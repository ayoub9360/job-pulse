# Job Watcher

A small self-hosted TypeScript worker that searches job sources, applies configurable filters and sends new matches to Discord. Supports freelance and permanent roles, multiple watches and persistent notification history.

Independent project, not affiliated with the listed platforms. Provider access is subject to each platform's terms and your authorization; see [provider status](docs/providers.md) before enabling live searches. In particular, Collective prohibits automated use without separate authorization. No live access is needed to run the tests.

## Quick start

Requirements: Node.js 24, pnpm 10.34.7. Install `curl` only if using the optional Collective adapter.

```sh
npm install --global pnpm@10.34.7
pnpm install --frozen-lockfile
cp config/config.example.yaml config/config.yaml
cp .env.example .env
```

Edit the ignored `config/config.yaml` for your own searches and set `DISCORD_WEBHOOK_URL` in `.env`. Treat the complete webhook URL as a secret. The example searches TypeScript jobs every 30 minutes, with one page and at most ten notifications per run.

```sh
pnpm validate-config  # Offline configuration check; does not send messages
pnpm dev --once       # Live search; sends notifications
pnpm dev             # Waits for the next scheduled tick
```

After compilation, use `pnpm build` then `pnpm start --once` or `pnpm start`.

## Docker

Create `.env` and `config/config.yaml` as above, then:

```sh
docker compose up --build -d
docker compose logs -f
```

Configuration is mounted read-only and is never baked into the image. `.env` is passed at runtime, including any custom webhook variable names. After changing configuration or environment variables, run `docker compose up -d --force-recreate`. Rebuild only for code/dependency changes.

The worker runs as user `node` (UID 1000), with a named volume for `/app/data`. Keep one worker per state file. If using a bind mount for data, give UID 1000 write permission. `docker compose down` preserves the named volume; deleting the volume discards history and can resend notifications.

## Configuration and behavior

See [configuration reference](docs/configuration.md) for all filters, multiple providers, credentials and scheduling. Notifications have no mentions by default. Set `mentionHere: true` on a watcher to opt into `@here`.

- Deduplication is per watcher, provider and offer ID. Cross-provider reposts can appear twice.
- Only successfully notified batches are marked seen. A crash after delivery but before persistence can resend a batch.
- Notification limits are global, in watcher order. Unsent offers are reconsidered only if still returned by the source; there is no persistent pending queue.
- Unknown daily rates pass a minimum-rate filter. A range is compared using its upper bound. Annual salaries are not converted to daily rates.
- Searches are sequential and capped by pages. They are not exhaustive; upstream markup/API changes can break adapters or produce empty results.
- SIGINT/SIGTERM allow an active check up to 30 seconds to finish. Avoid multiple processes sharing the state file.
- `--once` exits nonzero when all active searches fail or a notification/state operation fails. Partial provider failures are reported in structured logs while other sources continue.

## Development

```sh
pnpm test
pnpm check
pnpm build
pnpm audit
```

Tests use synthetic fixtures and local HTTP servers; no live platform credentials are required. See [contributing](CONTRIBUTING.md), [architecture](docs/architecture.md), and [security](SECURITY.md).

## License

[MIT](LICENSE). Platform content and trademarks are not licensed by this project.
