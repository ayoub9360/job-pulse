# Security

The latest main branch is maintained. Keep Node.js, dependencies and container images updated. Dependency checks do not prove absence of vulnerabilities.

Do not include secrets or personal data in public issues. If private vulnerability reporting is enabled, use the repository Security tab to submit a private report. Otherwise contact the maintainer privately through their GitHub profile before sharing sensitive details; no response-time guarantee is offered.

Webhooks and API keys belong in the ignored `.env` or deployment secret store. A Discord webhook URL is a credential. Rotate a credential if exposed, even if the file or commit is later deleted. Never publish configuration/state/log files from a deployment.

Run one instance per state file. Configuration and environment variables are trusted operator input. The worker fetches configured endpoints and sends selected job metadata to Discord; restrict deployment network access as appropriate for your environment. Do not expose the worker as a service accepting untrusted configuration.

CI runs Gitleaks against Git history and audits locked dependencies. Local checks: `gitleaks git --redact` and `pnpm audit`. Integration tests run against local synthetic servers only.
