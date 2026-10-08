import { createHandler } from './handler';
import { buildParser } from './llm/config';

// LLM_PROVIDER picks the parser: mock (default, free) or anthropic. Bedrock comes later.
export const handler = createHandler({ parser: buildParser(process.env) });
