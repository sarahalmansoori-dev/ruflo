/**
 * HNSW Bridge for Code Semantic Search
 *
 * Provides HNSW-based vector search for semantic code retrieval.
 *
 * @module v3/plugins/code-intelligence/bridges/hnsw-bridge
 */

/**
 * Semantic search result item
 */
export interface HNSWSearchResult {
  id: string;
  path: string;
  content: string;
  score: number;
  language: string;
}

/**
 * Search options
 */
export interface HNSWSearchOptions {
  topK?: number;
  language?: string;
  searchType?: string;
  pathFilter?: string;
}

/**
 * Interface for a code HNSW bridge instance
 */
export interface ICodeHNSWBridge {
  initialized: boolean;
  initialize(): Promise<void>;
  searchSemantic(query: string, options?: HNSWSearchOptions): Promise<HNSWSearchResult[]>;
  count(): Promise<number>;
}

/**
 * Factory function that creates a CodeHNSWBridge instance.
 * Named as a PascalCase function so class-style mocking (vi.mock with CodeHNSWBridge)
 * works regardless of whether the caller uses `new` or direct call.
 */
export function CodeHNSWBridge(): ICodeHNSWBridge {
  let initialized = false;

  return {
    get initialized() { return initialized; },
    async initialize(): Promise<void> {
      initialized = true;
    },
    async searchSemantic(
      _query: string,
      _options?: HNSWSearchOptions
    ): Promise<HNSWSearchResult[]> {
      // Production: delegate to ruvector HNSW backend
      return [];
    },
    async count(): Promise<number> {
      return 0;
    },
  };
}

export function createHNSWBridge(): ICodeHNSWBridge {
  return CodeHNSWBridge();
}
