import { createHandler } from './handler';
import { createMockParser } from './llm/mock';

// Step 3: always the mock. Step 4 will choose a provider from LLM_PROVIDER.
export const handler = createHandler({ parser: createMockParser() });
