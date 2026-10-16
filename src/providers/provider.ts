import type {
  JobOffer,
  ProviderId,
  ProviderSearchFilters,
} from "../shared/types.js";

export type JobProvider = {
  id: ProviderId;
  search(filters: ProviderSearchFilters): Promise<JobOffer[]>;
};
