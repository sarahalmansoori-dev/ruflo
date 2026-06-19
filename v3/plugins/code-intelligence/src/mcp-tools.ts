/**
 * Code Intelligence Plugin - MCP Tools
 *
 * Implements 5 MCP tools for advanced code analysis:
 * 1. code/semantic-search - Find semantically similar code patterns
 * 2. code/architecture-analyze - Analyze codebase architecture
 * 3. code/refactor-impact - Predict refactoring impact
 * 4. code/split-suggest - Suggest module splits
 * 5. code/learn-patterns - Learn patterns from code history
 *
 * Based on ADR-035: Advanced Code Intelligence Plugin
 *
 * @module v3/plugins/code-intelligence/mcp-tools
 */

import { z } from 'zod';
import { CodeHNSWBridge } from './bridges/hnsw-bridge.js';
import { CodeGNNBridge } from './bridges/gnn-bridge.js';

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
  [key: string]: unknown;
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
// Zod Schemas (for validation only, not exposed as inputSchema)
// ============================================================================

const SearchTypeEnum = z.enum(['function', 'class', 'interface', 'type', 'variable', 'comment', 'any']);
const ChangeTypeEnum = z.enum(['rename', 'move', 'delete', 'signature_change', 'type_change', 'dependency_change']);
const SplitStrategyEnum = z.enum(['responsibility', 'cohesion', 'size', 'complexity']);
const PatternTypeEnum = z.enum(['design_patterns', 'anti_patterns', 'idioms', 'conventions', 'architecture']);
const AnalysisTypeEnum = z.enum(['dependencies', 'modularity', 'complexity', 'coupling', 'cohesion', 'layers']);

const SemanticSearchZod = z.object({
  query: z.string().min(1).max(1000),
  topK: z.number().int().min(1).max(100).default(10).optional(),
  language: z.string().optional(),
  searchType: SearchTypeEnum.optional(),
  pathFilter: z.string().optional(),
});

const ArchitectureAnalyzeZod = z.object({
  targetPath: z.string().min(1).max(500),
  analysisTypes: z.array(AnalysisTypeEnum).optional(),
  depth: z.number().int().min(1).max(20).optional(),
  excludePatterns: z.array(z.string()).optional(),
  outputFormat: z.enum(['json', 'markdown', 'summary']).optional(),
});

const RefactorImpactZod = z.object({
  targetPath: z.string().min(1).max(500),
  changeType: ChangeTypeEnum,
  description: z.string().optional(),
  includeTests: z.boolean().optional(),
  depth: z.number().int().min(1).max(10).optional(),
});

const SplitSuggestZod = z.object({
  targetPath: z.string().min(1).max(500),
  threshold: z.number().int().min(50).max(10000).default(500).optional(),
  strategy: SplitStrategyEnum.optional(),
  includePatterns: z.array(z.string()).optional(),
});

const LearnPatternsZod = z.object({
  targetPath: z.string().min(1).max(500),
  patternTypes: z.array(PatternTypeEnum).optional(),
  language: z.string().optional(),
  minConfidence: z.number().min(0).max(1).optional(),
});

// ============================================================================
// code/semantic-search
// ============================================================================

export const semanticSearchTool: MCPTool = {
  name: 'code/semantic-search',
  description: 'Search for semantically similar code patterns',
  category: 'code-intelligence',
  version: '0.1.0',
  cacheable: true,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', maxLength: 1000 },
      topK: { type: 'integer', minimum: 1, maximum: 100 },
      language: { type: 'string' },
      searchType: { type: 'string', enum: ['function', 'class', 'interface', 'type', 'variable', 'comment', 'any'] },
      pathFilter: { type: 'string' },
    },
    required: ['query'],
  },
  handler: async (input, context) => {
    const startTime = Date.now();

    const parsed = SemanticSearchZod.safeParse(input);
    if (!parsed.success) {
      return errorResult(parsed.error.message, { code: 'VALIDATION_ERROR' });
    }

    const validated = parsed.data;
    const topK = validated.topK ?? 10;

    try {
      const bridge = CodeHNSWBridge();
      await bridge.initialize();

      const results = await bridge.searchSemantic(validated.query, {
        topK,
        language: validated.language,
        searchType: validated.searchType,
        pathFilter: validated.pathFilter,
      });

      const durationMs = Date.now() - startTime;

      context?.logger?.info('code/semantic-search completed', { durationMs: String(durationMs) });

      return successResult({
        results,
        searchTime: durationMs,
        durationMs,
        query: validated.query,
        total: results.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return errorResult(message, { code: 'SEARCH_ERROR' });
    }
  },
};

// ============================================================================
// code/architecture-analyze
// ============================================================================

export const architectureAnalyzeTool: MCPTool = {
  name: 'code/architecture-analyze',
  description: 'Analyze codebase architecture and detect drift',
  category: 'code-intelligence',
  version: '0.1.0',
  cacheable: true,
  inputSchema: {
    type: 'object',
    properties: {
      targetPath: { type: 'string', maxLength: 500 },
      analysisTypes: { type: 'array', items: { type: 'string' } },
      depth: { type: 'integer', minimum: 1, maximum: 20 },
      excludePatterns: { type: 'array', items: { type: 'string' } },
      outputFormat: { type: 'string', enum: ['json', 'markdown', 'summary'] },
    },
    required: ['targetPath'],
  },
  handler: async (input, context) => {
    const startTime = Date.now();

    const parsed = ArchitectureAnalyzeZod.safeParse(input);
    if (!parsed.success) {
      return errorResult(parsed.error.message, { code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
    }

    const validated = parsed.data;

    try {
      const bridge = CodeGNNBridge();
      await bridge.initialize();

      const analysis = await bridge.analyzeArchitecture(validated.targetPath, {
        analysisTypes: validated.analysisTypes,
        depth: validated.depth,
        excludePatterns: validated.excludePatterns,
      });

      const durationMs = Date.now() - startTime;

      context?.logger?.info('code/architecture-analyze completed', { durationMs: String(durationMs) });

      return successResult({
        components: analysis.components,
        metrics: analysis.metrics,
        issues: analysis.issues,
        analysisTime: durationMs,
        durationMs,
        targetPath: validated.targetPath,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return errorResult(message, { code: 'ANALYSIS_ERROR', timestamp: new Date().toISOString() });
    }
  },
};

// ============================================================================
// code/refactor-impact
// ============================================================================

export const refactorImpactTool: MCPTool = {
  name: 'code/refactor-impact',
  description: 'Analyze impact of proposed code changes',
  category: 'code-intelligence',
  version: '0.1.0',
  cacheable: false,
  inputSchema: {
    type: 'object',
    properties: {
      targetPath: { type: 'string', maxLength: 500 },
      changeType: { type: 'string', enum: ['rename', 'move', 'delete', 'signature_change', 'type_change', 'dependency_change'] },
      description: { type: 'string' },
      includeTests: { type: 'boolean' },
      depth: { type: 'integer', minimum: 1, maximum: 10 },
    },
    required: ['targetPath', 'changeType'],
  },
  handler: async (input, context) => {
    const startTime = Date.now();

    const parsed = RefactorImpactZod.safeParse(input);
    if (!parsed.success) {
      return errorResult(parsed.error.message, { code: 'VALIDATION_ERROR' });
    }

    const validated = parsed.data;

    try {
      const bridge = CodeGNNBridge();
      await bridge.initialize();

      const impact = await bridge.analyzeRefactorImpact(validated.targetPath, {
        changeType: validated.changeType,
        description: validated.description,
        includeTests: validated.includeTests,
        depth: validated.depth,
      });

      const durationMs = Date.now() - startTime;

      context?.logger?.info('code/refactor-impact completed', { durationMs: String(durationMs) });

      return successResult({
        directImpact: impact.directImpact,
        indirectImpact: impact.indirectImpact,
        riskLevel: impact.riskLevel,
        breakingChanges: impact.breakingChanges,
        durationMs,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return errorResult(message, { code: 'IMPACT_ERROR' });
    }
  },
};

// ============================================================================
// code/split-suggest
// ============================================================================

export const splitSuggestTool: MCPTool = {
  name: 'code/split-suggest',
  description: 'Suggest optimal code splitting',
  category: 'code-intelligence',
  version: '0.1.0',
  cacheable: true,
  inputSchema: {
    type: 'object',
    properties: {
      targetPath: { type: 'string', maxLength: 500 },
      threshold: { type: 'integer', minimum: 50, maximum: 10000 },
      strategy: { type: 'string', enum: ['responsibility', 'cohesion', 'size', 'complexity'] },
      includePatterns: { type: 'array', items: { type: 'string' } },
    },
    required: ['targetPath'],
  },
  handler: async (input, context) => {
    const startTime = Date.now();

    const parsed = SplitSuggestZod.safeParse(input);
    if (!parsed.success) {
      return errorResult(parsed.error.message, { code: 'VALIDATION_ERROR' });
    }

    const validated = parsed.data;
    const threshold = validated.threshold ?? 500;

    try {
      const bridge = CodeGNNBridge();
      await bridge.initialize();

      const suggestions = await bridge.suggestSplit(validated.targetPath, {
        threshold,
        strategy: validated.strategy,
        includePatterns: validated.includePatterns,
      });

      const durationMs = Date.now() - startTime;

      context?.logger?.info('code/split-suggest completed', { durationMs: String(durationMs) });

      return successResult({
        suggestions,
        threshold,
        analysisTime: durationMs,
        durationMs,
        targetPath: validated.targetPath,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return errorResult(message, { code: 'SPLIT_ERROR' });
    }
  },
};

// ============================================================================
// code/learn-patterns
// ============================================================================

export const learnPatternsTool: MCPTool = {
  name: 'code/learn-patterns',
  description: 'Learn recurring patterns from code history using SONA',
  category: 'code-intelligence',
  version: '0.1.0',
  cacheable: true,
  inputSchema: {
    type: 'object',
    properties: {
      targetPath: { type: 'string', maxLength: 500 },
      patternTypes: { type: 'array', items: { type: 'string' } },
      language: { type: 'string' },
      minConfidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['targetPath'],
  },
  handler: async (input, context) => {
    const startTime = Date.now();

    const parsed = LearnPatternsZod.safeParse(input);
    if (!parsed.success) {
      return errorResult(parsed.error.message, { code: 'VALIDATION_ERROR' });
    }

    const validated = parsed.data;

    try {
      const bridge = CodeGNNBridge();
      await bridge.initialize();

      const learned = await bridge.learnPatterns(validated.targetPath, {
        patternTypes: validated.patternTypes,
        language: validated.language,
        minConfidence: validated.minConfidence,
      });

      const durationMs = Date.now() - startTime;

      context?.logger?.info('code/learn-patterns completed', { durationMs: String(durationMs) });

      return successResult({
        patterns: learned.patterns,
        antiPatterns: learned.antiPatterns,
        analysisTime: durationMs,
        durationMs,
        targetPath: validated.targetPath,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return errorResult(message, { code: 'PATTERN_ERROR' });
    }
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * All Code Intelligence MCP Tools
 */
export const codeIntelligenceTools: MCPTool[] = [
  semanticSearchTool,
  architectureAnalyzeTool,
  refactorImpactTool,
  splitSuggestTool,
  learnPatternsTool,
];

/**
 * Look up a tool by its registered name.
 */
export function getTool(name: string): MCPTool | undefined {
  return codeIntelligenceTools.find((t) => t.name === name);
}

/**
 * List all registered tool names.
 */
export function getToolNames(): string[] {
  return codeIntelligenceTools.map((t) => t.name);
}

/**
 * Tool name to handler map
 */
export const toolHandlers = new Map<string, MCPTool['handler']>(
  codeIntelligenceTools.map((t) => [t.name, t.handler])
);

/**
 * Create a minimal tool context (for production use)
 */
export function createToolContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    logger: {
      debug: (msg, meta) => console.debug(`[code-intelligence] ${msg}`, meta),
      info: (msg, meta) => console.info(`[code-intelligence] ${msg}`, meta),
      warn: (msg, meta) => console.warn(`[code-intelligence] ${msg}`, meta),
      error: (msg, meta) => console.error(`[code-intelligence] ${msg}`, meta),
    },
    ...overrides,
  };
}

export default codeIntelligenceTools;
