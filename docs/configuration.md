# Configuration reference

Copy `config/config.example.yaml` to the ignored `config/config.yaml`. `CONFIG_PATH` selects another file; `STATE_PATH` defaults to `data/seen-offers.json`. Never commit your deployment configuration or environment files. Configuration is trusted operator input, not an untrusted API endpoint.

## Providers

`providers` maps configuration names to endpoints. Only enabled watchers require their selected providers:

| Watcher provider ID | Configuration key | Endpoint | Credentials |
| --- | --- | --- | --- |
| `free-work` | `freeWork` | `https://www.free-work.com/fr/tech-it/jobs` | None in the adapter |
| `pylote` | `pylote` | `https://api-prod.pylote.io` | `PYLOTE_API_KEY` |
| `collective` | `collective` | `https://api.collective.work/graphql` | No authentication in this adapter; separate authorization required |

Collective optionally accepts `userAgent` (default `job-pulse/0.1`). Check [provider restrictions](providers.md); an endpoint being reachable does not grant permission to automate it. Production endpoints and webhooks should use HTTPS. Do not put credentials in endpoint URLs. HTTP is supported for local integration tests. HTTP GET redirects are rejected to avoid sending credentials to unintended endpoints.

## Watchers

Each entry requires a unique `name`, a `provider` ID (or nonempty array of distinct IDs), nonempty `queries`, and `webhookEnv` naming a variable containing a Discord webhook URL. Multiple watchers may share a webhook.

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Disabled watchers need no credentials or provider config |
| `mentionHere` | `false` | Opt into `@here` on each notification batch |
| `contracts` | `[]` | Accepted normalized contracts, e.g. `freelance`, `cdi`; empty means any |
| `minDailyRate` | `null` | Positive integer in EUR/day; unknown rates pass; range upper bound used |
| `remote` | `[]` | Any of `full`, `partial`, `onsite`, `unknown`; empty means any |
| `locations` | `[]` | Case/accent-insensitive substrings; `remote` also matches fully remote offers |
| `maxPages` | `1` | Integer from 1 to 10, per query; provider pagination differs |
| `excludedKeywords` | `[]` | Strings use substring matching; objects support `keyword` and `match: whole-word` or `substring` |
| `requiredKeywordGroups` | `[]` | Every group must match at least one whole term |
| `requiredKeywordScope` | `offer` | Group matches use title/description/skills, or `title-skills` |
| `requiredTitleKeywords` | `[]` | At least one whole term must occur in the title |
| `excludedTitleKeywords` | `[]` | Reject any matching whole term in the title |

Queries and ordinary exclusions search title, description, skills, company, location and contracts. Group constraints exclude company/location. Matching ignores case and accents; it is lexical, not semantic. Free-Work location codes containing `~~~` are passed upstream and excluded from local substring checks.

For example, `requiredKeywordGroups: [[react, vue], [python, node]]` requires a frontend and a backend term. `excludedKeywords: [{keyword: java, match: whole-word}]` excludes Java but preserves JavaScript.

## Scheduling and runtime

`schedule.cron` must be a valid node-cron expression. `schedule.timezone` defaults to `Europe/Paris` and must be recognized by the runtime. The worker waits for a cron tick; use `--once` for an immediate check. Overlapping scheduled checks in the same process are skipped.

`runtime.userAgent` is required. Defaults: `requestTimeoutMs: 10000`, `retryCount: 1` (0–5), `maxNotificationsPerRun: 20`. The supplied example deliberately uses a lower notification budget and slower schedule. Estimate load as watchers × queries × pages × providers, plus retries. Changing notification limits does not reduce searches.

HTTP GET retries only transient failures and 429/5xx responses, with exponential delays or `Retry-After`. Delays above 60 seconds fail the search instead of retrying early. Discord retries 429 responses up to three attempts and refuses waits above 60 seconds. Other Discord failures remain eligible for a later run. The Collective curl adapter has bounded exponential retries for transient errors.

Pino logs to stdout; set `LOG_LEVEL` to `debug`, `info`, `warn`, `error` or `silent`. Logs include watcher names and counts. Request logs omit query strings and credentials. Treat logs as potentially private operational data.
