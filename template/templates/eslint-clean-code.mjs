/**
 * hstack — clean-code ESLint reference config.
 *
 * The mechanical half of `hstack/context/code-standards.md`: everything a
 * linter can measure lives here, at `error`, so `lint` fails instead of
 * warning. A `warn` is a message an agent learns to scroll past; an `error`
 * is a message it has to act on. Nothing here is a style preference — each
 * rule maps to a way agent-written code has actually gone wrong.
 *
 * Usage, from the consumer's `eslint.config.mjs`:
 *
 *   import { defineConfig } from 'eslint/config'
 *   import { cleanCode } from './hstack/templates/eslint-clean-code.mjs'
 *
 *   export default defineConfig([
 *     ...yourFrameworkConfig,          // e.g. eslint-config-next, which registers
 *                                      // the @typescript-eslint and import plugins
 *     ...cleanCode({
 *       typescript: true,              // rules that need @typescript-eslint registered
 *       imports: true,                 // rules that need eslint-plugin-import registered
 *       supabase: true,                // the unread-`error` rule (see below)
 *       modules: {
 *         logger: 'lib/observability/logger',
 *         config: 'lib/env',
 *         dbClient: 'lib/supabase',
 *       },
 *     }),
 *   ])
 *
 * The ratchet. Turning these on against an existing codebase fails `lint`
 * hundreds of times at once. Freeze the current violations once —
 *
 *   npx eslint --suppress-all
 *
 * — which writes `eslint-suppressions.json`. From then on only *new*
 * violations fail; touching a file that carries old ones is the moment to
 * pay them down (`npx eslint --prune-suppressions` drops the entries that no
 * longer apply). Commit the suppressions file. The count only goes down.
 *
 * This file is framework-owned: `hstack update` overwrites it. Adjust
 * thresholds through the `thresholds` option, not by editing here.
 */

const DEFAULT_FILES = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}']
const DEFAULT_TEST_FILES = [
  '**/*.test.{ts,tsx,js,jsx}',
  '**/*.spec.{ts,tsx,js,jsx}',
  '**/__tests__/**',
  '**/e2e/**',
]
const DEFAULT_SCRIPT_FILES = ['scripts/**']

const DEFAULT_THRESHOLDS = {
  /** Lines per function, blank lines and comments excluded. */
  functionLines: 60,
  /** Lines per file, blank lines and comments excluded. */
  fileLines: 400,
  /** Independent paths through a function (if / for / && / ?: each add one). */
  complexity: 15,
  /** Nested blocks. Four is already a function that wants splitting. */
  depth: 4,
  /** Positional parameters. Past three, pass a named object. */
  params: 3,
  /** Nested callbacks. */
  callbacks: 3,
}

/**
 * Supabase returns `{ data, error }` and never throws. Code that takes `data`
 * and ignores `error` reads as correct and fails silently — an RLS denial
 * becomes an HTTP 200 that lies. This rule flags an awaited query-builder
 * chain (`.from(…)`, `.rpc(…)`, `.storage.from(…)`) whose result is
 * discarded, destructured without `error`, or read through `.data` only.
 * Chaining `.throwOnError()` turns the result into an exception and satisfies
 * the rule.
 */
const supabaseUnreadErrorRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require the `error` half of a Supabase `{ data, error }` result to be read.',
    },
    schema: [],
    messages: {
      unreadError:
        'The Supabase client never throws; it returns `{ data, error }`. Read `error` here ' +
        '(or chain `.throwOnError()`). An unread error is a silent failure.',
      discardedResult:
        'The result of this Supabase call is discarded, so a failed write goes unnoticed. ' +
        'Read `error` (or chain `.throwOnError()`).',
    },
  },
  create(context) {
    const QUERY_ROOTS = new Set(['from', 'rpc'])

    /** Walks a call chain and reports whether it starts a Supabase query and whether it throws on error. */
    function describeChain(node) {
      let startsQuery = false
      let throwsOnError = false
      let current = node
      while (current) {
        if (current.type === 'CallExpression') {
          const callee = current.callee
          if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
            if (QUERY_ROOTS.has(callee.property.name)) startsQuery = true
            if (callee.property.name === 'throwOnError') throwsOnError = true
          }
          current = callee
        } else if (current.type === 'MemberExpression') {
          current = current.object
        } else {
          break
        }
      }
      return { startsQuery, throwsOnError }
    }

    function patternReadsError(pattern) {
      return pattern.properties.some(
        (property) =>
          property.type === 'RestElement' ||
          (property.key && property.key.type === 'Identifier' && property.key.name === 'error'),
      )
    }

    return {
      AwaitExpression(node) {
        const { startsQuery, throwsOnError } = describeChain(node.argument)
        if (!startsQuery || throwsOnError) return

        const parent = node.parent
        if (parent.type === 'ExpressionStatement') {
          context.report({ node, messageId: 'discardedResult' })
          return
        }
        if (parent.type === 'VariableDeclarator' && parent.id.type === 'ObjectPattern') {
          if (!patternReadsError(parent.id)) {
            context.report({ node, messageId: 'unreadError' })
          }
          return
        }
        if (
          parent.type === 'MemberExpression' &&
          parent.object === node &&
          parent.property.type === 'Identifier' &&
          parent.property.name === 'data'
        ) {
          context.report({ node, messageId: 'unreadError' })
        }
      },
    }
  },
}

export const hstackPlugin = {
  meta: { name: 'hstack', version: '1.0.0' },
  rules: {
    'supabase-unread-error': supabaseUnreadErrorRule,
  },
}

/**
 * @param {object} [options]
 * @param {string[]} [options.files]        Files the rules apply to.
 * @param {string[]} [options.testFiles]    Files where size rules are relaxed.
 * @param {string[]} [options.scriptFiles]  Operator CLIs, where stdout is the interface.
 * @param {boolean}  [options.typescript]   Emit rules that need `@typescript-eslint` registered. Default true.
 * @param {boolean}  [options.imports]      Emit rules that need `eslint-plugin-import` registered. Default false.
 * @param {boolean}  [options.supabase]     Emit the unread-`error` rule. Default false.
 * @param {Partial<typeof DEFAULT_THRESHOLDS>} [options.thresholds]
 * @param {object}   [options.modules]      Where the one sanctioned path for each concern lives; used in messages.
 * @param {string}   [options.modules.logger]    e.g. 'lib/observability/logger'
 * @param {string}   [options.modules.config]    e.g. 'lib/env'
 * @param {string}   [options.modules.dbClient]  e.g. 'lib/supabase'
 * @returns {object[]} Flat-config objects to spread into `defineConfig([...])`.
 */
export function cleanCode(options = {}) {
  const files = options.files ?? DEFAULT_FILES
  const testFiles = options.testFiles ?? DEFAULT_TEST_FILES
  const scriptFiles = options.scriptFiles ?? DEFAULT_SCRIPT_FILES
  const typescript = options.typescript ?? true
  const imports = options.imports ?? false
  const supabase = options.supabase ?? false
  const t = { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) }
  const modules = options.modules ?? {}

  const loggerHint = modules.logger ? ` Use ${modules.logger}.` : ' Use the repo logger.'
  const configHint = modules.config
    ? ` Read it through ${modules.config}, which validates every variable once at boot.`
    : ' Read it through the one config module that validates every variable at boot.'
  const dbClientHint = modules.dbClient
    ? ` Get a client from ${modules.dbClient}; a client built elsewhere can bypass RLS.`
    : ' Get a client from the one sanctioned module; a client built elsewhere can bypass RLS.'

  const sizeAndShape = {
    'max-lines-per-function': [
      'error',
      { max: t.functionLines, skipBlankLines: true, skipComments: true, IIFEs: true },
    ],
    'max-lines': ['error', { max: t.fileLines, skipBlankLines: true, skipComments: true }],
    complexity: ['error', t.complexity],
    'max-depth': ['error', t.depth],
    'max-params': ['error', t.params],
    'max-nested-callbacks': ['error', t.callbacks],
  }

  const errorsAreHandled = {
    'no-empty': ['error', { allowEmptyCatch: false }],
    'prefer-promise-reject-errors': 'error',
    'no-throw-literal': 'error',
  }

  // `no-console` carries no custom message; when the consumer names a logger,
  // the restricted-global form says where to go instead.
  const consoleRules = modules.logger
    ? {
        'no-console': 'off',
        'no-restricted-globals': [
          'error',
          { name: 'console', message: `Do not log through console.${loggerHint}` },
        ],
      }
    : { 'no-console': ['error', { allow: [] }] }
  const consoleOff = { 'no-console': 'off', 'no-restricted-globals': 'off' }

  const onePathPerConcern = {
    ...consoleRules,
    'no-restricted-syntax': [
      'error',
      {
        selector: "MemberExpression[object.name='process'][property.name='env']",
        message: `Do not read process.env here.${configHint}`,
      },
    ],
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@supabase/supabase-js',
            message: `Do not import @supabase/supabase-js directly.${dbClientHint}`,
          },
        ],
      },
    ],
  }

  const deadCode = {
    // The core rule is replaced by its type-aware twin when TypeScript is on.
    'no-unused-vars': typescript ? 'off' : 'error',
    'no-duplicate-imports': 'error',
    'no-unreachable': 'error',
    'no-useless-return': 'error',
  }

  const typescriptRules = typescript
    ? {
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-non-null-assertion': 'error',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
        ],
        // Type-aware: needs `parserOptions.projectService` (or `project`) set by the consumer.
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/only-throw-error': 'error',
      }
    : {}

  const importRules = imports ? { 'import/no-cycle': ['error', { maxDepth: Infinity }] } : {}

  const supabaseRules = supabase ? { 'hstack/supabase-unread-error': 'error' } : {}

  const configs = [
    {
      name: 'hstack/clean-code',
      files,
      ...(supabase ? { plugins: { hstack: hstackPlugin } } : {}),
      rules: {
        ...sizeAndShape,
        ...errorsAreHandled,
        ...onePathPerConcern,
        ...deadCode,
        ...typescriptRules,
        ...importRules,
        ...supabaseRules,
      },
    },
    {
      // A long test is a normal test, and a test file reads the environment to
      // decide what it can run against.
      name: 'hstack/clean-code/tests',
      files: testFiles,
      rules: {
        'max-lines-per-function': 'off',
        'max-lines': 'off',
        'max-nested-callbacks': 'off',
        'no-restricted-syntax': 'off',
        ...(typescript ? { '@typescript-eslint/no-non-null-assertion': 'off' } : {}),
      },
    },
    {
      // Operator-run CLIs: stdout is the interface, and the process reads its
      // own environment.
      name: 'hstack/clean-code/scripts',
      files: scriptFiles,
      rules: {
        ...consoleOff,
        'no-restricted-syntax': 'off',
      },
    },
  ]

  return configs
}

export default cleanCode
