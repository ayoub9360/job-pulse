# Architecture

`main.ts` loads YAML with Zod validation, instantiates the selected providers and Discord notifiers, and runs once or schedules checks with node-cron.

`check-new-offers.ts` orchestrates search → local filtering → state lookup → notification → state persistence. A failed provider does not prevent others from running. Notification/state failures stop the run. `SeenOffersStore` replaces a JSON file atomically after each successful batch. It is intentionally a single-process store, not a distributed queue.

Providers implement `JobProvider.search(filters): Promise<JobOffer[]>`. Each adapter normalizes its source into `JobOffer`; filters remain provider-independent. HTTP and curl clients enforce request timeouts. Tests inject network implementations or use loopback HTTP servers.

To add a provider, add its ID to the type/schema, implement and test its adapter using synthetic responses, instantiate it in the runtime, add the notification display label, and document credentials, pagination and access conditions. Do not add a live integration to CI or commit captured pages with third-party content/secrets.

Future changes such as cross-provider deduplication, fair notification scheduling or state retention should preserve the documented delivery semantics. A crash between notification delivery and state persistence can cause a duplicate; exactly-once delivery is not promised.
