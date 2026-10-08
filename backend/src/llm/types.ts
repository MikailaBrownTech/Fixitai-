/**
 * The one thing the rest of the backend knows about an LLM.
 *
 * `parse` takes the (already validated) user query and returns the model's RAW
 * text. It must NOT validate or clean that text: the handler does that with the
 * Zod schema, the same way no matter which provider produced it.
 *
 * Three implementations will exist: mock (step 3), anthropic and bedrock (step 4).
 * Swapping providers is a one-file change because only this interface is shared.
 */
export interface QueryParser {
  parse(query: string): Promise<string>;
}
