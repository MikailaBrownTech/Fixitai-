import { createHandler } from './handler';
import { buildParser } from './llm/config';
import { createUpstreamClient } from './upstream/http';
import { IFIXIT_API_BASE, createIfixitCatalog } from './upstream/ifixit';

// LLM_PROVIDER picks the parser: mock (default, free) or anthropic. Bedrock comes later.
// iFixit read-only search needs no API key, so there is no secret for that service.
export const handler = createHandler({
  parser: buildParser(process.env),
  catalog: createIfixitCatalog(createUpstreamClient({ baseUrl: IFIXIT_API_BASE })),
});
