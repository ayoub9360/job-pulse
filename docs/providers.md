# Provider status and access

Reviewed 2026-10-16. These adapters are independent integrations, not endorsed platform APIs. Tests exercise local synthetic responses; production availability and authorization are not certified. Respect upstream restrictions and do not bypass access controls or anti-bot challenges.

## Free-Work

Parses search HTML and an indexed Nuxt metadata table. No account is used by the adapter. The [terms](https://www.free-work.com/fr/terms) govern use and restrict uses of protected content; no express automation license has been established for this project. Confirm your intended use with the platform before deployment. HTML changes and blocked pages may yield no offers. The default example is a configuration example, not a representation of permission from Free-Work.

## Collective

The [French terms](https://www.collective.work/cgu) explicitly prohibit scraping, reposting, automated and high-volume use. Do not enable this adapter against the production service without separate authorization covering your use. It is excluded from the default configuration.

The adapter uses a public-page GraphQL operation via `curl`, without cookies or authentication. This is not a stable, documented public developer API. Its availability can change or be blocked. A recognizable user agent is used; browser impersonation is not supplied by default. Local synthetic tests retain regression coverage for normalization and error handling.

## Pylote

Optional authenticated adapter using `PYLOTE_API_KEY` and `/v1/me/jobs/search`. Pylote advertises [API integration](https://pylote.io/connexion-api), but that page does not establish access rights or stability for this specific endpoint. Obtain the appropriate access and documentation from Pylote. The adapter has synthetic tests; compatibility with your account must be verified separately. Never reuse or publish someone else's credentials.

## Data and attribution

Fixtures are synthetic, including hand-authored HTML and Nuxt index tables. No captured advertisements, account data or cookies are distributed. Platform content and trademarks remain outside the project's MIT license. Do not assume permission to redistribute job descriptions because they are publicly visible.
