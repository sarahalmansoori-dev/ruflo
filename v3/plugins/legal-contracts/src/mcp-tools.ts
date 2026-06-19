/**
 * Legal Contracts Plugin - MCP Tools
 *
 * Implements 5 MCP tools for legal contract analysis:
 * 1. legal/clause-extract - Extract and classify clauses
 * 2. legal/risk-assess - Identify and score contractual risks
 * 3. legal/contract-compare - Compare contracts
 * 4. legal/obligation-track - Extract obligations with DAG analysis
 * 5. legal/playbook-match - Match clauses against negotiation playbook
 *
 * Based on ADR-034: Legal Contract Analysis Plugin
 *
 * @module v3/plugins/legal-contracts/mcp-tools
 */

import { z } from 'zod';
import { LegalDAGBridge } from './bridges/dag-bridge.js';
import { LegalMinCutBridge } from './bridges/mincut-bridge.js';

// ============================================================================
// MCP Tool Interface Types (JSON-Schema based, per cognitive-kernel convention)
// ============================================================================

export interface MCPToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: MCPToolInputSchema;
  category?: string;
  tags?: string[];
  version?: string;
  cacheable?: boolean;
  cacheTTL?: number;
  handler: (input: Record<string, unknown>, context?: ToolContext) => Promise<MCPToolResult>;
}

// ============================================================================
// Tool Context
// ============================================================================

export interface ToolContext {
  logger?: {
    debug(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
  userId?: string;
  userRoles?: string[];
  auditLogger?: {
    log(entry: Record<string, unknown>): Promise<void>;
  };
  matterContext?: {
    matterId?: string;
    clientId?: string;
  };
  [key: string]: unknown;
}

// ============================================================================
// Role Permissions
// ============================================================================

const TOOL_PERMISSIONS: Record<string, string[]> = {
  'clause-extract': ['partner', 'associate', 'paralegal', 'contract_manager'],
  'risk-assess': ['partner', 'associate'],
  'contract-compare': ['partner', 'associate'],
  'obligation-track': ['partner', 'associate', 'paralegal', 'contract_manager'],
  'playbook-match': ['partner', 'contract_manager'],
};

function checkAccess(toolShortName: string, userRoles?: string[]): boolean {
  // No RBAC if userRoles is undefined
  if (userRoles === undefined) return true;

  const allowed = TOOL_PERMISSIONS[toolShortName] ?? [];
  return userRoles.some((role) => allowed.includes(role));
}

// ============================================================================
// Result Helpers
// ============================================================================

function successResult(data: unknown): MCPToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
  };
}

function errorResult(message: string, extra?: Record<string, unknown>): MCPToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: true,
        message,
        timestamp: new Date().toISOString(),
        ...extra,
      }),
    }],
    isError: true,
  };
}

// ============================================================================
// Simple document hash
// ============================================================================

function hashDocument(doc: string): string {
  let h = 0;
  for (let i = 0; i < doc.length; i++) {
    h = ((h << 5) - h) + doc.charCodeAt(i);
    h = h & h;
  }
  return Math.abs(h).toString(16).padStart(16, '0');
}

// ============================================================================
// Zod Schemas
// ============================================================================

const ClauseExtractZod = z.object({
  document: z.string().min(1).max(10_000_000),
  clauseTypes: z.array(z.string()).optional(),
  jurisdiction: z.string().max(50).default('US'),
  matterContext: z.object({ matterId: z.string(), clientId: z.string() }).optional(),
});

const RiskAssessZod = z.object({
  document: z.string().min(1).max(10_000_000),
  partyRole: z.enum(['buyer', 'seller', 'licensor', 'licensee', 'employer', 'employee', 'landlord', 'tenant', 'lender', 'borrower', 'service_provider', 'client']),
  riskCategories: z.array(z.string()).optional(),
  industryContext: z.string().max(200).optional(),
  threshold: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});

const ContractCompareZod = z.object({
  baseDocument: z.string().min(1).max(10_000_000),
  compareDocument: z.string().min(1).max(10_000_000),
  comparisonMode: z.enum(['structural', 'semantic', 'full']).default('full'),
  focusClauseTypes: z.array(z.string()).optional(),
});

const ObligationTrackZod = z.object({
  document: z.string().min(1).max(10_000_000),
  party: z.string().max(200).optional(),
  obligationTypes: z.array(z.string()).optional(),
  timeframe: z.string().max(50).optional(),
});

const PlaybookMatchZod = z.object({
  document: z.string().min(1).max(10_000_000),
  playbook: z.string().min(1).max(1_000_000),
  strictness: z.enum(['strict', 'moderate', 'flexible']).default('moderate'),
  prioritizeClauses: z.array(z.string()).optional(),
});

// ============================================================================
// legal/clause-extract
// ============================================================================

export const clauseExtractTool: MCPTool = {
  name: 'legal/clause-extract',
  description: 'Extract and classify clauses from legal documents',
  category: 'legal',
  version: '1.0.0',
  cacheable: true,
  inputSchema: {
    type: 'object',
    properties: {
      document: { type: 'string', maxLength: 10_000_000 },
      clauseTypes: { type: 'array', items: { type: 'string' } },
      jurisdiction: { type: 'string', default: 'US' },
      matterContext: { type: 'object' },
    },
    required: ['document'],
  },
  handler: async (input, context) => {
    const startTime = Date.now();
    const toolShortName = 'clause-extract';

    // Authorization
    if (!checkAccess(toolShortName, context?.userRoles)) {
      return errorResult('Unauthorized: insufficient role permissions', { code: 'UNAUTHORIZED' });
    }

    const parsed = ClauseExtractZod.safeParse(input);
    if (!parsed.success) {
      return errorResult(parsed.error.message, { code: 'VALIDATION_ERROR' });
    }

    const validated = parsed.data;

    try {
      const bridge = LegalDAGBridge();
      await bridge.initialize();

      const clauses = await bridge.extractClauses(validated.document, {
        clauseTypes: validated.clauseTypes,
        jurisdiction: validated.jurisdiction,
      });

      const extractionTime = Date.now() - startTime;
      const documentHash = hashDocument(validated.document);

      // Audit log
      if (context?.auditLogger) {
        await context.auditLogger.log({
          toolName: toolShortName,
          userId: context.userId,
          success: true,
          documentHash,
          matterId: context.matterContext?.matterId ?? validated.matterContext?.matterId,
          timestamp: new Date().toISOString(),
        });
      }

      context?.logger?.info(`${toolShortName} completed`, { durationMs: String(extractionTime) });

      return successResult({
        clauses,
        extractionTime,
        jurisdiction: validated.jurisdiction,
        documentHash,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return errorResult(message, { code: 'EXTRACTION_ERROR' });
    }
  },
};

// ============================================================================
// legal/risk-assess
// ============================================================================

export const riskAssessTool: MCPTool = {
  name: 'legal/risk-assess',
  description: 'Assess contractual risks with severity scoring',
  category: 'legal',
  version: '1.0.0',
  cacheable: true,
  inputSchema: {
    type: 'object',
    properties: {
      document: { type: 'string', maxLength: 10_000_000 },
      partyRole: { type: 'string', enum: ['buyer', 'seller', 'licensor', 'licensee', 'employer', 'employee'] },
      riskCategories: { type: 'array', items: { type: 'string' } },
      industryContext: { type: 'string' },
      threshold: { type: 'string' },
    },
    required: ['document', 'partyRole'],
  },
  handler: async (input, context) => {
    const startTime = Date.now();
    const toolShortName = 'risk-assess';

    // Authorization
    if (!checkAccess(toolShortName, context?.userRoles)) {
      return errorResult('Unauthorized: insufficient role permissions', { code: 'UNAUTHORIZED' });
    }

    const parsed = RiskAssessZod.safeParse(input);
    if (!parsed.success) {
      return errorResult(parsed.error.message, { code: 'VALIDATION_ERROR' });
    }

    const validated = parsed.data;

    try {
      const bridge = LegalDAGBridge();
      await bridge.initialize();

      const risks = await bridge.analyzeRisks(validated.document, {
        partyRole: validated.partyRole,
        riskCategories: validated.riskCategories,
        industryContext: validated.industryContext,
        threshold: validated.threshold,
      });

      const assessmentTime = Date.now() - startTime;

      // Compute overall risk score
      const severityWeights: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
      const totalWeight = risks.reduce((sum, r) => sum + (severityWeights[r.severity] ?? 1), 0);
      const overallRiskScore = risks.length === 0 ? 100 : Math.max(0, 100 - totalWeight * 5);

      const recommendations = risks.map((r) => r.recommendation);

      context?.logger?.info(`${toolShortName} completed`, { durationMs: String(assessmentTime) });

      return successResult({
        risks,
        overallRiskScore,
        recommendations,
        assessmentTime,
        partyRole: validated.partyRole,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return errorResult(message, { code: 'RISK_ERROR' });
    }
  },
};

// ============================================================================
// legal/contract-compare
// ============================================================================

export const contractCompareTool: MCPTool = {
  name: 'legal/contract-compare',
  description: 'Compare two contracts with detailed diff and semantic alignment',
  category: 'legal',
  version: '1.0.0',
  cacheable: true,
  inputSchema: {
    type: 'object',
    properties: {
      baseDocument: { type: 'string', maxLength: 10_000_000 },
      compareDocument: { type: 'string', maxLength: 10_000_000 },
      comparisonMode: { type: 'string', enum: ['structural', 'semantic', 'full'], default: 'full' },
      focusClauseTypes: { type: 'array', items: { type: 'string' } },
    },
    required: ['baseDocument', 'compareDocument'],
  },
  handler: async (input, context) => {
    const startTime = Date.now();
    const toolShortName = 'contract-compare';

    // Authorization
    if (!checkAccess(toolShortName, context?.userRoles)) {
      return errorResult('Unauthorized: insufficient role permissions', { code: 'UNAUTHORIZED' });
    }

    const parsed = ContractCompareZod.safeParse(input);
    if (!parsed.success) {
      return errorResult(parsed.error.message, { code: 'VALIDATION_ERROR' });
    }

    const validated = parsed.data;

    try {
      const bridge = LegalDAGBridge();
      await bridge.initialize();

      const comparison = await bridge.compareContracts(
        validated.baseDocument,
        validated.compareDocument,
        { comparisonMode: validated.comparisonMode, focusClauseTypes: validated.focusClauseTypes }
      );

      const comparisonTime = Date.now() - startTime;

      context?.logger?.info(`${toolShortName} completed`, { durationMs: String(comparisonTime) });

      return successResult({
        similarity: comparison.similarity,
        differences: comparison.differences,
        comparisonTime,
        mode: validated.comparisonMode,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return errorResult(message, { code: 'COMPARE_ERROR' });
    }
  },
};

// ============================================================================
// legal/obligation-track
// ============================================================================

export const obligationTrackTool: MCPTool = {
  name: 'legal/obligation-track',
  description: 'Extract obligations, deadlines, and dependencies using DAG analysis',
  category: 'legal',
  version: '1.0.0',
  cacheable: true,
  inputSchema: {
    type: 'object',
    properties: {
      document: { type: 'string', maxLength: 10_000_000 },
      party: { type: 'string' },
      obligationTypes: { type: 'array', items: { type: 'string' } },
      timeframe: { type: 'string' },
    },
    required: ['document'],
  },
  handler: async (input, context) => {
    const startTime = Date.now();
    const toolShortName = 'obligation-track';

    // Authorization
    if (!checkAccess(toolShortName, context?.userRoles)) {
      return errorResult('Unauthorized: insufficient role permissions', { code: 'UNAUTHORIZED' });
    }

    const parsed = ObligationTrackZod.safeParse(input);
    if (!parsed.success) {
      return errorResult(parsed.error.message, { code: 'VALIDATION_ERROR' });
    }

    const validated = parsed.data;

    try {
      const bridge = LegalDAGBridge();
      await bridge.initialize();

      const obligations = await bridge.extractObligations(validated.document, {
        party: validated.party,
        obligationTypes: validated.obligationTypes,
        timeframe: validated.timeframe,
      });

      const trackingTime = Date.now() - startTime;

      // Build a simple timeline from obligations
      const timeline = obligations.map((obl) => ({
        obligationId: obl.id,
        deadline: obl.deadline,
        party: obl.party,
        status: obl.status,
      }));

      context?.logger?.info(`${toolShortName} completed`, { durationMs: String(trackingTime) });

      return successResult({
        obligations,
        timeline,
        trackingTime,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return errorResult(message, { code: 'OBLIGATION_ERROR' });
    }
  },
};

// ============================================================================
// legal/playbook-match
// ============================================================================

export const playbookMatchTool: MCPTool = {
  name: 'legal/playbook-match',
  description: 'Compare contract clauses against negotiation playbook',
  category: 'legal',
  version: '1.0.0',
  cacheable: true,
  inputSchema: {
    type: 'object',
    properties: {
      document: { type: 'string', maxLength: 10_000_000 },
      playbook: { type: 'string', maxLength: 1_000_000 },
      strictness: { type: 'string', enum: ['strict', 'moderate', 'flexible'], default: 'moderate' },
      prioritizeClauses: { type: 'array', items: { type: 'string' } },
    },
    required: ['document', 'playbook'],
  },
  handler: async (input, context) => {
    const startTime = Date.now();
    const toolShortName = 'playbook-match';

    // Authorization
    if (!checkAccess(toolShortName, context?.userRoles)) {
      return errorResult('Unauthorized: insufficient role permissions', { code: 'UNAUTHORIZED' });
    }

    const parsed = PlaybookMatchZod.safeParse(input);
    if (!parsed.success) {
      return errorResult(parsed.error.message, { code: 'VALIDATION_ERROR' });
    }

    const validated = parsed.data;

    try {
      const bridge = LegalDAGBridge();
      await bridge.initialize();

      const match = await bridge.matchPlaybook(validated.document, validated.playbook, {
        strictness: validated.strictness,
        prioritizeClauses: validated.prioritizeClauses,
      });

      const matchTime = Date.now() - startTime;

      // Build recommendations from deviations
      const recommendations = match.deviations.map((d) =>
        `${d.severity.toUpperCase()}: Position '${d.position}' - expected '${d.expected}' but found '${d.actual}'`
      );

      context?.logger?.info(`${toolShortName} completed`, { durationMs: String(matchTime) });

      return successResult({
        matchScore: match.matchScore,
        deviations: match.deviations,
        recommendations,
        strictness: validated.strictness,
        matchTime,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return errorResult(message, { code: 'PLAYBOOK_ERROR' });
    }
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * All Legal Contracts MCP Tools
 */
export const legalContractsTools: MCPTool[] = [
  clauseExtractTool,
  riskAssessTool,
  contractCompareTool,
  obligationTrackTool,
  playbookMatchTool,
];

/**
 * Look up a tool by its registered name.
 */
export function getTool(name: string): MCPTool | undefined {
  return legalContractsTools.find((t) => t.name === name);
}

/**
 * List all registered tool names.
 */
export function getToolNames(): string[] {
  return legalContractsTools.map((t) => t.name);
}

/**
 * Tool name to handler map
 */
export const toolHandlers = new Map<string, MCPTool['handler']>(
  legalContractsTools.map((t) => [t.name, t.handler])
);

/**
 * Create a minimal tool context (for production use)
 */
export function createToolContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    logger: {
      debug: (msg, meta) => console.debug(`[legal-contracts] ${msg}`, meta),
      info: (msg, meta) => console.info(`[legal-contracts] ${msg}`, meta),
      warn: (msg, meta) => console.warn(`[legal-contracts] ${msg}`, meta),
      error: (msg, meta) => console.error(`[legal-contracts] ${msg}`, meta),
    },
    ...overrides,
  };
}

export default legalContractsTools;
