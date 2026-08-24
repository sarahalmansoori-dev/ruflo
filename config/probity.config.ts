import { defineConfig, enforceTdd } from '@nizos/probity'

/**
 * Probity — automated TDD enforcement for AI coding agents.
 *
 * Wired into Claude Code via the PreToolUse hook in .claude/settings.json,
 * which passes --config to point here (CLAUDE.md forbids root-level files).
 *
 * Scope below covers the TypeScript source and test trees where CLAUDE.md's
 * "Prefer TDD London School (mock-first) for new code" rule applies. Tests in
 * this repo live in three places per package — __tests__/ (179 files),
 * tests/ (53), and colocated in src/ (31) — so all three are included.
 *
 * Deliberately NOT covered: docs/, scripts/, data/, bin/, plugins/, and
 * v3/plugins/. Add globs here to widen enforcement.
 */
export default defineConfig({
  rules: [
    {
      files: [
        'v3/@claude-flow/*/src/**',
        'v3/@claude-flow/*/__tests__/**',
        'v3/@claude-flow/*/tests/**',
        'ruflo/src/**',
        'tests/**',
      ],
      rules: [enforceTdd()],
    },
  ],
})
