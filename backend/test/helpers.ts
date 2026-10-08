import type { Catalog } from '../src/upstream/ifixit';
import type { UpstreamFailure } from '../src/upstream/http';

/** A catalog that finds nothing, for tests that are about something else. */
export const emptyCatalog: Catalog = {
  search: async () => ({ ok: true, data: { guides: [], parts: [] } }),
};

/** A catalog whose upstream failed with the given reason. */
export const failingCatalog = (reason: UpstreamFailure): Catalog => ({
  search: async () => ({ ok: false, reason }),
});
