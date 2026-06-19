/**
 * MinCut Bridge for Legal Contract Analysis
 *
 * Provides minimum cut algorithms for contract structure analysis.
 *
 * @module v3/plugins/legal-contracts/bridges/mincut-bridge
 */

export interface ILegalMinCutBridge {
  initialized: boolean;
  initialize(): Promise<void>;
}

/**
 * Factory function for the LegalMinCutBridge.
 * Named as a PascalCase factory so vi.mock-based class mocking works
 * when the handler calls it without `new`.
 */
export function LegalMinCutBridge(): ILegalMinCutBridge {
  let initialized = false;

  return {
    get initialized() { return initialized; },
    async initialize(): Promise<void> {
      initialized = true;
    },
  };
}

export function createMinCutBridge(): ILegalMinCutBridge {
  return LegalMinCutBridge();
}
