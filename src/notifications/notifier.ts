import type { JobOffer } from "../shared/types.js";

export type Notifier = {
  notify(offers: JobOffer[]): Promise<void>;
};
