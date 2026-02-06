# Local Model Tool Calling Support Patch
clawdbot fork: 
https://github.com/jokelord/local-model-tool-calling

## 🎯 Patch Objective

Enable Clawdbot to support tool calling functionality for local inference models (sglang/vLLM).

**Tested Environment**:
- Model: Qwen3-Coder-30B-A3B-Instruct-FP8
- Inference Server: sglang + `--tool-call-parser qwen3_coder`
- Clawdbot Version: 2026.1.24-0

**Test Results**: ✅ Successfully calls tools

---

## Quick Start (TL;DR)

If you just want to quickly enable tool calling for local Qwen3 Coder models, follow these steps:

### 1. Start sglang Server (Key: Use Correct Parser)

```bash
python -m sglang.launch_server \
  --model-path /path/to/Qwen3-Coder-30B-A3B-Instruct-FP8 \
  --tool-call-parser qwen3_coder \
  --port 30000 \
  --host 0.0.0.0
```

### 2. Configure Clawdbot (~/.clawdbot/clawdbot.json)

Complete recommended configuration:

```json
{
  "tools": {
    "profile": "coding",
    "allow": ["read", "exec", "write", "edit", "web_search"],
    "exec": {
      "host": "gateway",
      "security": "full",
      "ask": "off"
    },
    "web": {
      "search": {
        "enabled": true,
        "provider": "duckduckgo"
      }
    }
  },
  "models": {
    "providers": {
      "local": {
        "baseUrl": "http://127.0.0.1:30000/v1",
        "apiKey": "none",
        "api": "openai-completions",
        "models": [{
          "id": "Qwen3-Coder-30B-A3B-Instruct-FP8",
          "name": "Qwen3 Coder 30B Local",
          "reasoning": false,
          "input": ["text"],
          "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
          "contextWindow": 32768,
          "maxTokens": 8192,
          "compat": {
            "supportedParameters": ["tools", "tool_choice"]
          }
        }]
      }
    }
  }
}
```

### 3. Apply Code Modifications from This Patch (See Detailed Steps Below)

### 4. Build and Test

```bash
cd /path/to/clawdbot

# Install dependencies (either one)
pnpm install   # Recommended, faster
# Or: npm install

# Build (either one)
pnpm build     # If using pnpm
# Or: npm run build

# Global install
sudo npm install -g .

```

---

## Patch Rationale

### Problem Description

Clawdbot can successfully send tool calling requests to cloud providers (such as OpenAI, Anthropic), but cannot send tool calling requests to local inference models (such as sglang, vLLM).

### Root Cause Analysis

After code analysis, the issues were found to be:

1. **Cloud Provider Tool Support Detection**: For cloud providers like OpenRouter, the system determines model tool support through API-returned `supported_parameters` metadata:
   ```typescript
   // src/agents/model-scan.ts (line 204)
   const supportsToolsMeta = supportedParameters.includes("tools");
   ```

2. **Lack of Declaration Mechanism for Local Models**: Local inference models (sglang, vLLM, etc.) do not have similar APIs to declare supported parameters, nor do they have configuration options for users to manually declare.

3. **Configuration Schema Limitations**: The `ModelCompatSchema` originally did not support the `supportedParameters` field, preventing users from declaring local model tool support capabilities in configuration.

4. **Inference Server Configuration**: Even if Clawdbot sends tools parameters, if sglang/vLLM does not enable the correct `--tool-call-parser`, the server will not return structured `tool_calls`, but instead output pseudo-tool calls in text format within the `content` field.

5. **Web Search Tool Limitations**: The original Clawdbot's `web_search` tool only supported Brave Search (requires API key) and Perplexity (requires API key). For users with local deployments or those who don't want to apply for API keys, there was no free web search option. Additionally, the original implementation used undici/fetch for HTTP requests, which gets blocked by search engine anti-bot mechanisms in certain proxy environments.

### Patch Objectives

1. **Allow Users to Declare Local Model Tool Support**: Enable users to explicitly declare which API parameters their local models support by adding a `supportedParameters` field to the model configuration's `compat` object.

2. **Maintain Backward Compatibility**: For models without declared `supportedParameters` (including all existing cloud provider configurations), continue to assume tools are supported without affecting existing functionality.

3. **Flexible Control**: Allow users to precisely control which models enable/disable tools through configuration.

4. **Provide Free Web Search**: Added DuckDuckGo as a free search provider, requiring no API key. Uses curl command implementation (instead of undici/fetch) to effectively bypass DuckDuckGo's anti-bot detection, while automatically supporting system proxy environment variables.

---

## Modified Files

Files modified by this patch (tree structure):

```
clawdbot/
│
└── src/
    ├── config/
    │   ├── zod-schema.core.ts         ✏️ [Modified] Add supportedParameters field to Schema
    │   ├── zod-schema.agent-runtime.ts ✏️ [Modified] Add DuckDuckGo provider to Schema
    │   ├── types.models.ts            ✏️ [Modified] Add supportedParameters to type definition
    │   ├── types.tools.ts             ✏️ [Modified] Add DuckDuckGo provider to type definition
    │   └── schema.ts                  ✏️ [Modified] Update configuration documentation
    │
    └── agents/
        ├── model-compat.ts            ✏️ [Modified] Add modelSupportsTools() function
        ├── tool-policy.ts             ✏️ [Verify] Ensure coding profile includes group:web
        │
        ├── tools/
        │   └── web-search.ts          ✏️ [Modified] Add DuckDuckGo free search (curl implementation)
        │
        └── pi-embedded-runner/
            └── run/
                └── attempt.ts         ✏️ [Modified] Add tool support detection logic
```

### Modified Files List

| # | File Path | Modification Type | Description |
|---|-----------|-------------------|-------------|
| 1 | `src/config/zod-schema.core.ts` | Schema Change | Add `supportedParameters` field to `ModelCompatSchema` |
| 2 | `src/config/zod-schema.agent-runtime.ts` | Schema Change | Add DuckDuckGo provider support to `ToolsWebSearchSchema` |
| 3 | `src/config/types.models.ts` | Type Change | Add `supportedParameters` property to `ModelCompatConfig` type |
| 4 | `src/config/types.tools.ts` | Type Change | Add DuckDuckGo provider support to web search configuration types |
| 5 | `src/config/schema.ts` | Documentation Change | Update web search provider configuration description |
| 6 | `src/agents/model-compat.ts` | New Function | Add `modelSupportsTools()` tool support detection function |
| 7 | `src/agents/tool-policy.ts` | Verify/Modify | Ensure `coding` profile's allow list includes `group:web` |
| 8 | `src/agents/tools/web-search.ts` | Tool Modification | Add DuckDuckGo free search (curl implementation, bypasses anti-bot) |
| 9 | `src/agents/pi-embedded-runner/run/attempt.ts` | Logic Change | Add model support check before tool creation |


### Test Files (Optional)

| # | File Path | Type | Description |
|---|-----------|------|-------------|
| 11 | `src/agents/tools/duckduckgo-search.test.ts` | **New Test** | DuckDuckGo search unit tests + live tests (8 tests total) |
| 12 | `test/run-duckduckgo-test.sh` | **New Script** | One-click test runner for DuckDuckGo search tests |

---

## Applying the Patch

### Step 1: Preparation

Ensure you have cloned the Clawdbot source code repository and installed dependencies:

```bash
# Enter project directory
cd /path/to/clawdbot

# Install dependencies (either one)
pnpm install   # Recommended, faster
# Or: npm install
```

### Step 2: Backup Original Files (Optional)

Before applying the patch, you can backup all files to be modified:

```bash
# Model tool support related
cp src/config/zod-schema.core.ts src/config/zod-schema.core.ts.backup
cp src/config/types.models.ts src/config/types.models.ts.backup
cp src/agents/model-compat.ts src/agents/model-compat.ts.backup
cp src/agents/pi-embedded-runner/run/attempt.ts src/agents/pi-embedded-runner/run/attempt.ts.backup

# DuckDuckGo search related
cp src/agents/tools/web-search.ts src/agents/tools/web-search.ts.backup
cp src/config/zod-schema.agent-runtime.ts src/config/zod-schema.agent-runtime.ts.backup
cp src/config/types.tools.ts src/config/types.tools.ts.backup
cp src/config/schema.ts src/config/schema.ts.backup
cp src/agents/tool-policy.ts src/agents/tool-policy.ts.backup
```

### Step 3: Apply Code Changes

Overwrite the source files with the four files from this repository according to their respective paths, or modify the four files as described in the 'Complete Code Modification' section below.

### Step 4: Build and Install

```bash
# Build TypeScript code (either one)
pnpm build     # If using pnpm
# Or: npm run build

# Install modified version globally
sudo npm install -g .

# Verify installation
clawdbot --version
```

### Step 5: Configure Local Model

Add configuration for your local model in `~/.clawdbot/clawdbot.json`. Note that `compat.supportedParameters` is the key configuration:

```json
{
  "models": {
    "providers": {
      "local": {
        "baseUrl": "http://127.0.0.1:30000/v1",
        "apiKey": "none",
        "api": "openai-completions",
        "models": [{
          "id": "your-model-id",
          "name": "Your Model Name",
          "reasoning": false,
          "input": ["text"],
          "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
          "contextWindow": 32768,
          "maxTokens": 8192,
          "compat": {
            "supportedParameters": ["tools", "tool_choice"]
          }
        }]
      }
    }
  }
}
```

### Step 6: Test and Verify

```bash
# Test with debug logging enabled
CLAWDBOT_DEBUG_TOOLS=1 clawdbot agent --local --message "List files in current directory"
```

---

## Complete Code Modifications

Following are complete code snippets for modification, directly copy-paste into corresponding files.

### File 1: src/config/zod-schema.core.ts

Find the `ModelCompatSchema` definition and add the `supportedParameters` field:

```typescript
export const ModelCompatSchema = z
  .object({
    supportsStore: z.boolean().optional(),
    supportsDeveloperRole: z.boolean().optional(),
    supportsReasoningEffort: z.boolean().optional(),
    maxTokensField: z
      .union([z.literal("max_completion_tokens"), z.literal("max_tokens")])
      .optional(),
    // NEW: Allow local models to declare tool support
    supportedParameters: z.array(z.string()).optional(),
  })
  .strict()
  .optional();
```

⚠️ **Important Note**: When modifying this file, ensure you don't change other Schema definitions. Pay special attention to:
- `TtsProviderSchema` must remain `z.enum(["elevenlabs", "openai", "edge"])` (including `edge`)
- `TtsAutoSchema` must remain `z.enum(["off", "always", "inbound", "tagged"])`
- Fields in `ModelDefinitionSchema` must remain `optional()`

### File 2: src/config/types.models.ts

Find the `ModelCompatConfig` type definition and add the `supportedParameters` field:

```typescript
export type ModelCompatConfig = {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  supportedParameters?: string[];  // NEW: Declare API parameters supported by model
};
```

### File 3: src/agents/model-compat.ts

**Add at file end**:

```typescript
/**
 * Check if a model supports tools based on its compat.supportedParameters.
 *
 * Logic:
 * - If compat.supportedParameters is undefined/null, assume tools are supported
 *   (backward compatible with cloud providers that don't need explicit declaration)
 * - If compat.supportedParameters is defined but empty [], tools are NOT supported
 * - If compat.supportedParameters includes "tools", tools ARE supported
 */
export function modelSupportsTools(model: Model<Api>): boolean {
  // Non-OpenAI APIs don't use this check
  if (model.api !== "openai-completions") {
    return true;
  }

  // If no compat config, assume tools are supported (backward compatibility)
  if (!model.compat) {
    return true;
  }

  // If supportedParameters is not defined, assume tools are supported
  const supportedParams = (model.compat as Record<string, unknown>).supportedParameters;

  // Debug logging (only when CLAWDBOT_DEBUG_TOOLS is set)
  if (process.env.CLAWDBOT_DEBUG_TOOLS) {
    console.error(`[model-compat] modelSupportsTools check:`, {
      modelId: model.id,
      api: model.api,
      supportedParams,
    });
  }

  if (supportedParams === undefined || supportedParams === null) {
    return true;
  }

  // If it's an array, check if "tools" is included
  if (Array.isArray(supportedParams)) {
    const result = supportedParams.includes("tools");
    if (process.env.CLAWDBOT_DEBUG_TOOLS) {
      console.error(`[model-compat] supportedParams array check: includes("tools") = ${result}`);
    }
    return result;
  }

  // Fallback: assume not supported if format is unexpected
  return false;
}
```

### File 4: src/agents/pi-embedded-runner/run/attempt.ts

**Step 1**: Add to import area at file top:

```typescript
import { modelSupportsTools } from "../../model-compat.js";
```

**Step 2**: Find tool creation code segment (search `createClawdbotCodingTools`), **add check logic before it**:

```typescript
// Check if model supports tools
const modelHasToolSupport = modelSupportsTools(params.model);

if (!modelHasToolSupport) {
  log.debug(
    `Tools disabled for model ${params.modelId}: compat.supportedParameters does not include "tools"`,
  );
}
```

**Step 3**: Modify tool creation condition, change original:

```typescript
const toolsRaw =
  params.disableTools
    ? []
    : createClawdbotCodingTools({ ... });
```

To:

```typescript
const toolsRaw =
  params.disableTools || !modelHasToolSupport
    ? []
    : createClawdbotCodingTools({ ... });
```

⚠️ **Important Note**: When modifying this file, **do NOT add any debug file write code** (such as `fs.appendFileSync` writing to `/tmp` directory). All debug output should use `log.debug()` or `console.error` (when environment variable is enabled).

### File 5: src/agents/tools/web-search.ts

**Description**: Add DuckDuckGo free search provider support, no API key required. Uses curl command for search (bypasses DuckDuckGo anti-bot detection against undici/fetch).

**Key Modifications**:
1. Add `DUCKDUCKGO_HTML_ENDPOINT` constant
2. Add `parseDuckDuckGoHtml()` function to parse HTML results
3. Add `runDuckDuckGoSearch()` function using curl for search
4. Add DuckDuckGo provider branch in `runWebSearch()`
5. Add DuckDuckGo description in `createWebSearchTool()`

**Why curl instead of fetch/undici**:
- Native fetch: Doesn't support proxy environment variables
- undici + ProxyAgent: Blocked by DuckDuckGo anti-bot (returns HTTP 202, 0 results)
- curl: Automatically uses proxy environment variables, not blocked by anti-bot ✅

```typescript
import { Type } from "@sinclair/typebox";
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";

import type { ClawdbotConfig } from "../../config/config.js";
import { formatCliCommand } from "../../cli/command-format.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
import {
  CacheEntry,
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  normalizeCacheKey,
  readCache,
  readResponseText,
  resolveCacheTtlMs,
  resolveTimeoutSeconds,
  withTimeout,
  writeCache,
} from "./web-shared.js";

const SEARCH_PROVIDERS = ["brave", "perplexity", "duckduckgo"] as const;
const DEFAULT_SEARCH_COUNT = 5;
const MAX_SEARCH_COUNT = 10;

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DUCKDUCKGO_HTML_ENDPOINT = "https://html.duckduckgo.com/html/";
const DEFAULT_PERPLEXITY_BASE_URL = "https://openrouter.ai/api/v1";
const PERPLEXITY_DIRECT_BASE_URL = "https://api.perplexity.ai";
const DEFAULT_PERPLEXITY_MODEL = "perplexity/sonar-pro";
const PERPLEXITY_KEY_PREFIXES = ["pplx-"];
const OPENROUTER_KEY_PREFIXES = ["sk-or-"];

const SEARCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();

// Cached proxy agent for reuse (used for Brave/Perplexity, DuckDuckGo uses curl)
let proxyDispatcher: Dispatcher | undefined;

/**
 * Detect proxy URL from environment variables.
 * Checks HTTPS_PROXY, https_proxy, HTTP_PROXY, http_proxy (in that order).
 */
function detectProxyUrl(): string | undefined {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    undefined
  );
}

/**
 * Get or create a cached proxy dispatcher.
 * Returns undefined if no proxy is configured.
 */
function getProxyDispatcher(): Dispatcher | undefined {
  if (proxyDispatcher !== undefined) return proxyDispatcher;
  const proxyUrl = detectProxyUrl();
  if (!proxyUrl) return undefined;
  proxyDispatcher = new ProxyAgent(proxyUrl);
  return proxyDispatcher;
}

/**
 * Proxy-aware fetch wrapper.
 * Uses environment proxy if available, falls back to global fetch otherwise.
 * NOTE: Only used for Brave/Perplexity; DuckDuckGo uses curl because undici is blocked by anti-bot
 */
async function proxyFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const dispatcher = getProxyDispatcher();
  if (dispatcher) {
    return undiciFetch(input, { ...init, dispatcher } as Parameters<typeof undiciFetch>[1]) as unknown as Response;
  }
  return fetch(input, init);
}

const WebSearchSchema = Type.Object({
  query: Type.String({ description: "Search query string." }),
  count: Type.Optional(
    Type.Number({
      description: "Number of results to return (1-10).",
      minimum: 1,
      maximum: MAX_SEARCH_COUNT,
    }),
  ),
  country: Type.Optional(
    Type.String({
      description:
        "2-letter country code for region-specific results (e.g., 'DE', 'US', 'ALL'). Default: 'US'.",
    }),
  ),
  search_lang: Type.Optional(
    Type.String({
      description: "ISO language code for search results (e.g., 'de', 'en', 'fr').",
    }),
  ),
  ui_lang: Type.Optional(
    Type.String({
      description: "ISO language code for UI elements.",
    }),
  ),
});

type WebSearchConfig = NonNullable<ClawdbotConfig["tools"]>["web"] extends infer Web
  ? Web extends { search?: infer Search }
    ? Search
    : undefined
  : undefined;

type BraveSearchResult = {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
};

type BraveSearchResponse = {
  web?: {
    results?: BraveSearchResult[];
  };
};

type PerplexityConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

type PerplexityApiKeySource = "config" | "perplexity_env" | "openrouter_env" | "none";

type PerplexitySearchResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  citations?: string[];
};

type PerplexityBaseUrlHint = "direct" | "openrouter";

function resolveSearchConfig(cfg?: ClawdbotConfig): WebSearchConfig {
  const search = cfg?.tools?.web?.search;
  if (!search || typeof search !== "object") return undefined;
  return search as WebSearchConfig;
}

function resolveSearchEnabled(params: { search?: WebSearchConfig; sandboxed?: boolean }): boolean {
  if (typeof params.search?.enabled === "boolean") return params.search.enabled;
  if (params.sandboxed) return true;
  return true;
}

function resolveSearchApiKey(search?: WebSearchConfig): string | undefined {
  const fromConfig =
    search && "apiKey" in search && typeof search.apiKey === "string" ? search.apiKey.trim() : "";
  const fromEnv = (process.env.BRAVE_API_KEY ?? "").trim();
  return fromConfig || fromEnv || undefined;
}

function missingSearchKeyPayload(provider: (typeof SEARCH_PROVIDERS)[number]) {
  if (provider === "perplexity") {
    return {
      error: "missing_perplexity_api_key",
      message:
        "web_search (perplexity) needs an API key. Set PERPLEXITY_API_KEY or OPENROUTER_API_KEY in the Gateway environment, or configure tools.web.search.perplexity.apiKey.",
      docs: "https://docs.clawd.bot/tools/web",
    };
  }
  return {
    error: "missing_brave_api_key",
    message: `web_search needs a Brave Search API key. Run \`${formatCliCommand("clawdbot configure --section web")}\` to store it, or set BRAVE_API_KEY in the Gateway environment.`,
    docs: "https://docs.clawd.bot/tools/web",
  };
}

function resolveSearchProvider(search?: WebSearchConfig): (typeof SEARCH_PROVIDERS)[number] {
  const raw =
    search && "provider" in search && typeof search.provider === "string"
      ? search.provider.trim().toLowerCase()
      : "";
  if (raw === "perplexity") return "perplexity";
  if (raw === "duckduckgo" || raw === "ddg") return "duckduckgo";
  if (raw === "brave") return "brave";
  return "brave";
}

function resolvePerplexityConfig(search?: WebSearchConfig): PerplexityConfig {
  if (!search || typeof search !== "object") return {};
  const perplexity = "perplexity" in search ? search.perplexity : undefined;
  if (!perplexity || typeof perplexity !== "object") return {};
  return perplexity as PerplexityConfig;
}

function resolvePerplexityApiKey(perplexity?: PerplexityConfig): {
  apiKey?: string;
  source: PerplexityApiKeySource;
} {
  const fromConfig = normalizeApiKey(perplexity?.apiKey);
  if (fromConfig) {
    return { apiKey: fromConfig, source: "config" };
  }

  const fromEnvPerplexity = normalizeApiKey(process.env.PERPLEXITY_API_KEY);
  if (fromEnvPerplexity) {
    return { apiKey: fromEnvPerplexity, source: "perplexity_env" };
  }

  const fromEnvOpenRouter = normalizeApiKey(process.env.OPENROUTER_API_KEY);
  if (fromEnvOpenRouter) {
    return { apiKey: fromEnvOpenRouter, source: "openrouter_env" };
  }

  return { apiKey: undefined, source: "none" };
}

function normalizeApiKey(key: unknown): string {
  return typeof key === "string" ? key.trim() : "";
}

function inferPerplexityBaseUrlFromApiKey(apiKey?: string): PerplexityBaseUrlHint | undefined {
  if (!apiKey) return undefined;
  const normalized = apiKey.toLowerCase();
  if (PERPLEXITY_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return "direct";
  }
  if (OPENROUTER_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return "openrouter";
  }
  return undefined;
}

function resolvePerplexityBaseUrl(
  perplexity?: PerplexityConfig,
  apiKeySource: PerplexityApiKeySource = "none",
  apiKey?: string,
): string {
  const fromConfig =
    perplexity && "baseUrl" in perplexity && typeof perplexity.baseUrl === "string"
      ? perplexity.baseUrl.trim()
      : "";
  if (fromConfig) return fromConfig;
  if (apiKeySource === "perplexity_env") return PERPLEXITY_DIRECT_BASE_URL;
  if (apiKeySource === "openrouter_env") return DEFAULT_PERPLEXITY_BASE_URL;
  if (apiKeySource === "config") {
    const inferred = inferPerplexityBaseUrlFromApiKey(apiKey);
    if (inferred === "direct") return PERPLEXITY_DIRECT_BASE_URL;
    if (inferred === "openrouter") return DEFAULT_PERPLEXITY_BASE_URL;
  }
  return DEFAULT_PERPLEXITY_BASE_URL;
}

function resolvePerplexityModel(perplexity?: PerplexityConfig): string {
  const fromConfig =
    perplexity && "model" in perplexity && typeof perplexity.model === "string"
      ? perplexity.model.trim()
      : "";
  return fromConfig || DEFAULT_PERPLEXITY_MODEL;
}

function resolveSearchCount(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const clamped = Math.max(1, Math.min(MAX_SEARCH_COUNT, Math.floor(parsed)));
  return clamped;
}

function resolveSiteName(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

type DuckDuckGoSearchResult = {
  title: string;
  url: string;
  description: string;
  siteName?: string;
};

/**
 * Parse DuckDuckGo HTML search results.
 * DuckDuckGo Lite returns HTML, we extract results from it.
 */
function parseDuckDuckGoHtml(html: string): DuckDuckGoSearchResult[] {
  const results: DuckDuckGoSearchResult[] = [];

  // Match result links: <a rel="nofollow" class="result__a" href="...">title</a>
  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
  // Match snippets: <a class="result__snippet" ...>snippet text</a>
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/gi;

  const links: { url: string; title: string }[] = [];
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    let url = match[1] ?? "";
    const title = (match[2] ?? "").trim();

    // DuckDuckGo wraps URLs in redirect: //duckduckgo.com/l/?uddg=ENCODED_URL
    if (url.includes("uddg=")) {
      try {
        const parsed = new URL(url, "https://duckduckgo.com");
        const realUrl = parsed.searchParams.get("uddg");
        if (realUrl) url = decodeURIComponent(realUrl);
      } catch {
        // Keep original URL if parsing fails
      }
    }

    if (url && title && url.startsWith("http")) {
      links.push({ url, title });
    }
  }

  const snippets: string[] = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    // Remove HTML tags from snippet
    const snippet = (match[1] ?? "").replace(/<[^>]*>/g, "").trim();
    snippets.push(snippet);
  }

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    if (!link) continue;
    results.push({
      title: link.title,
      url: link.url,
      description: snippets[i] ?? "",
      siteName: resolveSiteName(link.url),
    });
  }

  return results;
}

/**
 * Run DuckDuckGo search using curl command.
 * Uses curl because undici/fetch triggers DuckDuckGo's anti-bot detection.
 * This is a free, no-API-key-required search method.
 * Automatically uses HTTP/HTTPS proxy from environment variables.
 */
async function runDuckDuckGoSearch(params: {
  query: string;
  count: number;
  timeoutSeconds: number;
}): Promise<DuckDuckGoSearchResult[]> {
  const { execFileSync } = await import("child_process");

  // Build curl command arguments - curl automatically uses https_proxy/http_proxy env vars
  const curlArgs = [
    "-s", // silent
    "--max-time",
    String(params.timeoutSeconds),
    "-X",
    "POST",
    "-H",
    "Content-Type: application/x-www-form-urlencoded",
    "-H",
    "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "-H",
    "Accept: text/html",
    "-d",
    `q=${encodeURIComponent(params.query)}`,
    DUCKDUCKGO_HTML_ENDPOINT,
  ];

  try {
    // Use execFileSync with array args to avoid shell escaping issues
    const html = execFileSync("curl", curlArgs, {
      encoding: "utf-8",
      maxBuffer: 2 * 1024 * 1024, // 2MB buffer
      timeout: params.timeoutSeconds * 1000,
    });

    const allResults = parseDuckDuckGoHtml(html);

    // If no results found, check if we got the homepage (anti-bot detection)
    if (allResults.length === 0 && html.includes("<title>") && !html.includes("at DuckDuckGo")) {
      throw new Error("DuckDuckGo returned homepage instead of search results (possible anti-bot detection)");
    }

    return allResults.slice(0, params.count);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`DuckDuckGo search failed: ${message}`);
  }
}

async function runPerplexitySearch(params: {
  query: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
}): Promise<{ content: string; citations: string[] }> {
  const endpoint = `${params.baseUrl.replace(/\/$/, "")}/chat/completions`;

  // Use proxyFetch for proxy support (Perplexity doesn't block like DuckDuckGo)
  const res = await proxyFetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
      "HTTP-Referer": "https://clawdbot.com",
      "X-Title": "Clawdbot Web Search",
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        {
          role: "user",
          content: params.query,
        },
      ],
    }),
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detail = await readResponseText(res);
    throw new Error(`Perplexity API error (${res.status}): ${detail || res.statusText}`);
  }

  const data = (await res.json()) as PerplexitySearchResponse;
  const content = data.choices?.[0]?.message?.content ?? "No response";
  const citations = data.citations ?? [];

  return { content, citations };
}

async function runWebSearch(params: {
  query: string;
  count: number;
  apiKey?: string;
  timeoutSeconds: number;
  cacheTtlMs: number;
  provider: (typeof SEARCH_PROVIDERS)[number];
  country?: string;
  search_lang?: string;
  ui_lang?: string;
  perplexityBaseUrl?: string;
  perplexityModel?: string;
}): Promise<Record<string, unknown>> {
  const cacheKey = normalizeCacheKey(
    `${params.provider}:${params.query}:${params.count}:${params.country || "default"}:${params.search_lang || "default"}:${params.ui_lang || "default"}`,
  );
  const cached = readCache(SEARCH_CACHE, cacheKey);
  if (cached) return { ...cached.value, cached: true };

  const start = Date.now();

  if (params.provider === "perplexity") {
    const { content, citations } = await runPerplexitySearch({
      query: params.query,
      apiKey: params.apiKey,
      baseUrl: params.perplexityBaseUrl ?? DEFAULT_PERPLEXITY_BASE_URL,
      model: params.perplexityModel ?? DEFAULT_PERPLEXITY_MODEL,
      timeoutSeconds: params.timeoutSeconds,
    });

    const payload = {
      query: params.query,
      provider: params.provider,
      model: params.perplexityModel ?? DEFAULT_PERPLEXITY_MODEL,
      tookMs: Date.now() - start,
      content,
      citations,
    };
    writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
    return payload;
  }

  if (params.provider === "duckduckgo") {
    const ddgResults = await runDuckDuckGoSearch({
      query: params.query,
      count: params.count,
      timeoutSeconds: params.timeoutSeconds,
    });
    const payload = {
      query: params.query,
      provider: params.provider,
      count: ddgResults.length,
      tookMs: Date.now() - start,
      results: ddgResults,
    };
    writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
    return payload;
  }

  if (params.provider !== "brave") {
    throw new Error("Unsupported web search provider.");
  }

  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", params.query);
  url.searchParams.set("count", String(params.count));
  if (params.country) {
    url.searchParams.set("country", params.country);
  }
  if (params.search_lang) {
    url.searchParams.set("search_lang", params.search_lang);
  }
  if (params.ui_lang) {
    url.searchParams.set("ui_lang", params.ui_lang);
  }

  // Brave Search API uses proxyFetch for proxy support
  const res = await proxyFetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": params.apiKey,
    },
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detail = await readResponseText(res);
    throw new Error(`Brave Search API error (${res.status}): ${detail || res.statusText}`);
  }

  const data = (await res.json()) as BraveSearchResponse;
  const results = Array.isArray(data.web?.results) ? (data.web?.results ?? []) : [];
  const mapped = results.map((entry) => ({
    title: entry.title ?? "",
    url: entry.url ?? "",
    description: entry.description ?? "",
    published: entry.age ?? undefined,
    siteName: resolveSiteName(entry.url ?? ""),
  }));

  const payload = {
    query: params.query,
    provider: params.provider,
    count: mapped.length,
    tookMs: Date.now() - start,
    results: mapped,
  };
  writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
  return payload;
}

export function createWebSearchTool(options?: {
  config?: ClawdbotConfig;
  sandboxed?: boolean;
}): AnyAgentTool | null {
  const search = resolveSearchConfig(options?.config);
  if (!resolveSearchEnabled({ search, sandboxed: options?.sandboxed })) return null;

  const provider = resolveSearchProvider(search);
  const perplexityConfig = resolvePerplexityConfig(search);

  const description =
    provider === "perplexity"
      ? "Search the web using Perplexity Sonar (direct or via OpenRouter). Returns AI-synthesized answers with citations from real-time web search. IMPORTANT: Always use this tool for web searches instead of exec curl - search engines block curl requests and return no useful data."
      : provider === "duckduckgo"
        ? "Search the web using DuckDuckGo. Free, no API key required. Returns titles, URLs, and snippets. IMPORTANT: Always use this tool for web searches instead of exec curl - search engines block curl requests and return no useful data."
        : "Search the web using Brave Search API. Supports region-specific and localized search via country and language parameters. Returns titles, URLs, and snippets for fast research. IMPORTANT: Always use this tool for web searches instead of exec curl - search engines block curl requests and return no useful data.";

  return {
    label: "Web Search",
    name: "web_search",
    description,
    parameters: WebSearchSchema,
    execute: async (_toolCallId, args) => {
      const perplexityAuth =
        provider === "perplexity" ? resolvePerplexityApiKey(perplexityConfig) : undefined;
      const apiKey =
        provider === "perplexity" ? perplexityAuth?.apiKey : resolveSearchApiKey(search);

      if (!apiKey && provider !== "duckduckgo") {
        return jsonResult(missingSearchKeyPayload(provider));
      }
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const count =
        readNumberParam(params, "count", { integer: true }) ?? search?.maxResults ?? undefined;
      const country = readStringParam(params, "country");
      const search_lang = readStringParam(params, "search_lang");
      const ui_lang = readStringParam(params, "ui_lang");
      const result = await runWebSearch({
        query,
        count: resolveSearchCount(count, DEFAULT_SEARCH_COUNT),
        apiKey,
        timeoutSeconds: resolveTimeoutSeconds(search?.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS),
        cacheTtlMs: resolveCacheTtlMs(search?.cacheTtlMinutes, DEFAULT_CACHE_TTL_MINUTES),
        provider,
        country,
        search_lang,
        ui_lang,
        perplexityBaseUrl: resolvePerplexityBaseUrl(
          perplexityConfig,
          perplexityAuth?.source,
          perplexityAuth?.apiKey,
        ),
        perplexityModel: resolvePerplexityModel(perplexityConfig),
      });
      return jsonResult(result);
    },
  };
}

export const __testing = {
  inferPerplexityBaseUrlFromApiKey,
  resolvePerplexityBaseUrl,
} as const;

---

### File 6: src/config/zod-schema.agent-runtime.ts

Find the `ToolsWebSearchSchema` definition and add DuckDuckGo provider support:

```typescript
export const ToolsWebSearchSchema = z
  .object({
    enabled: z.boolean().optional(),
    provider: z.union([z.literal("brave"), z.literal("perplexity"), z.literal("duckduckgo"), z.literal("ddg")]).optional(),
    apiKey: z.string().optional(),
    maxResults: z.number().int().positive().optional(),
    timeoutSeconds: z.number().int().positive().optional(),
    cacheTtlMinutes: z.number().nonnegative().optional(),
    perplexity: z
      .object({
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
        model: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();
```

### File 7: src/config/types.tools.ts

Find the web search configuration type definition and add DuckDuckGo provider support:

```typescript
  web?: {
    search?: {
      /** Enable web search tool (default: true when API key is present). */
      enabled?: boolean;
      /** Search provider ("brave", "perplexity", or "duckduckgo"). DuckDuckGo is free and requires no API key. */
      provider?: "brave" | "perplexity" | "duckduckgo" | "ddg";
      /** Brave Search API key (optional; defaults to BRAVE_API_KEY env var). */
      apiKey?: string;
      /** Default search results count (1-10). */
      maxResults?: number;
      /** Timeout in seconds for search requests. */
      timeoutSeconds?: number;
      /** Cache TTL in minutes for search results. */
      cacheTtlMinutes?: number;
      /** Perplexity-specific configuration (used when provider="perplexity"). */
      perplexity?: {
        /** API key for Perplexity or OpenRouter (defaults to PERPLEXITY_API_KEY or OPENROUTER_API_KEY env var). */
        apiKey?: string;
        /** Base URL for Perplexity API (defaults to https://api.perplexity.ai for direct access, or https://openrouter.ai/api for OpenRouter). */
        baseUrl?: string;
        /** Model to use for Perplexity searches (defaults to perplexity/sonar-pro). */
        model?: string;
      };
    };
    fetch?: {
      /** Enable web fetch tool (default: true). */
      enabled?: boolean;
      /** Maximum characters to extract from web pages. */
      maxChars?: number;
      /** Timeout in seconds for fetch requests. */
      timeoutSeconds?: number;
      /** Cache TTL in minutes for fetched content. */
      cacheTtlMinutes?: number;
      /** Maximum number of redirects to follow. */
      maxRedirects?: number;
      /** Custom User-Agent string for requests. */
      userAgent?: string;
    };
  };
```

### File 8: src/config/schema.ts

Find the web search provider configuration description and update the supported provider list:

```typescript
  "tools.web.search.provider": 'Search provider ("brave", "perplexity", or "duckduckgo"). DuckDuckGo is free and requires no API key.',
```

### File 9: src/agents/tool-policy.ts

**Important**: Ensure the `coding` profile's `allow` list includes `group:web`. This is critical for the `web_search` tool to work.

Find the `coding` definition in `PRESET_PROFILES` and confirm or add `group:web`:

```typescript
export const PRESET_PROFILES: Record<ToolProfileId, ToolPolicyLike> = {
  // ... other profiles ...
  coding: {
    allow: ["group:fs", "group:runtime", "group:sessions", "group:memory", "group:web", "image"],
  },
  // ... other profiles ...
};
```

If the `coding` profile doesn't have `group:web`, add it. `group:web` includes the following tools:
- `web_search` - Web search
- `web_fetch` - Fetch web page content

---

## Usage Methods

### Tools Configuration (Strongly Recommended)

Clawdbot's tools configuration controls tool calling behavior. Although not mandatory, **it is strongly recommended** for optimal experience.

#### Configuration Item Details

| Configuration Item | Default Value | Recommended Value | Description |
|--------------------|----------------|-------------------|-------------|
| `profile` | `"default"` | `"coding"` | Enable complete coding toolset (read/write/edit/exec) |
| `allow` | Depends on profile | `["read", "exec", "write", "edit", "web_search"]` | Explicit whitelist of allowed tools (must include `web_search` for web search) |
| `exec.host` | `"local"` | `"gateway"` | Command execution location |
| `exec.security` | `"normal"` | `"full"` | `"normal"` = restricted permissions; `"full"` = full permissions |
| `exec.ask` | `"on"` | `"off"` | `"on"` = confirm each time; `"off"` = auto-execute |
| `web.search.provider` | `"brave"` | `"duckduckgo"` | Search provider (DuckDuckGo is free, no API key needed) |

#### Security Trade-offs

**Conservative Configuration** (Safe but interactive):
```json
{
  "tools": {
    "profile": "coding",
    "exec": {
      "security": "normal",
      "ask": "on"
    }
  }
}
```

**Aggressive Configuration** (Smooth but trust LLM):
```json
{
  "tools": {
    "profile": "coding",
    "allow": ["read", "exec", "write", "edit", "web_search"],
    "exec": {
      "host": "gateway",
      "security": "full",
      "ask": "off"
    }
  }
}
```

⚠️ **Security Warning**: `security: "full"` + `ask: "off"` allows LLM to execute any commands (including `sudo rm -rf /` etc.). Recommended only for isolated development environments.

#### Web Search Configuration

This patch adds support for **DuckDuckGo free search**, requiring no API key. Compared to the default Brave Search (which requires an API key), DuckDuckGo provides completely free web search functionality.

⚠️ **Important**: The `web_search` tool is **NOT included** in the `coding` profile by default. If you use the `tools.allow` configuration, you **must explicitly add `web_search`** to enable web search!

⚠️ **Why curl searches don't work**: Search engines like Google, Bing, and DuckDuckGo block curl requests, returning empty results or CAPTCHA pages. The `web_search` tool uses dedicated APIs (Brave Search API) or HTML parsing (DuckDuckGo Lite) to get real search results. If the agent tries to use `exec curl` for searches, guide it to use the `web_search` tool instead.

**Enable DuckDuckGo Search** (complete configuration):
```json
{
  "tools": {
    "allow": ["read", "exec", "write", "edit", "web_search"],
    "web": {
      "search": {
        "enabled": true,
        "provider": "duckduckgo"
      }
    }
  }
}
```

Or using CLI command:
```bash
clawdbot config set tools.web.search.provider duckduckgo
```

**Enable Brave Search** (requires API key):
```json
{
  "tools": {
    "allow": ["read", "exec", "write", "edit", "web_search"],
    "web": {
      "search": {
        "enabled": true,
        "provider": "brave",
        "apiKey": "your_brave_api_key_here"
      }
    }
  }
}
```

Or using CLI commands:
```bash
clawdbot config set tools.web.search.apiKey your_brave_api_key_here
clawdbot config set tools.web.search.provider brave
```

**Search Provider Comparison**:
| Provider | Requires API Key | Cost | Config Value |
|----------|------------------|------|--------------|
| **DuckDuckGo** | ❌ No | Free | `"duckduckgo"` or `"ddg"` |
| Brave Search | ✅ Yes | Limited free quota | `"brave"` |
| Perplexity | ✅ Yes | Paid | `"perplexity"` |

### Model Configuration Scenarios

#### Scenario 1: Enable Tool Support for Local Models

```json
{
  "models": {
    "providers": {
      "local": {
        "baseUrl": "http://127.0.0.1:30000/v1",
        "apiKey": "none",
        "api": "openai-completions",
        "models": [{
          "id": "Qwen3-Coder-30B-A3B-Instruct-FP8",
          "name": "Qwen3 Coder 30B Local",
          "reasoning": false,
          "input": ["text"],
          "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
          "contextWindow": 32768,
          "maxTokens": 8192,
          "compat": {
            "supportedParameters": ["tools", "tool_choice"]
          }
        }]
      }
    }
  }
}
```

#### Scenario 2: Disable Tool Support for Specific Models

If a model doesn't support tools, explicitly disable it:

```json
{
  "models": {
    "providers": {
      "local": {
        "baseUrl": "http://localhost:30000/v1",
        "api": "openai-completions",
        "models": [{
          "id": "llama-3-8b",
          "name": "Llama 3 8B (No Tools)",
          "reasoning": false,
          "input": ["text"],
          "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
          "contextWindow": 8192,
          "maxTokens": 4096,
          "compat": {
            "supportedParameters": []
          }
        }]
      }
    }
  }
}
```

#### Scenario 3: Cloud Provider Models (No Changes Needed)

For cloud provider models, no configuration changes are needed. If `compat.supportedParameters` is not declared, the system will maintain existing behavior and assume the model supports tools.

---

## Technical Details

### Logic Flow Diagram

```
Does model support tools?
    │
    ├─ model.api !== "openai-completions"
    │   └─ Return true (non-OpenAI API models default to supported)
    │
    ├─ model.compat === undefined/null
    │   └─ Return true (no compat config = default supported)
    │
    ├─ model.compat.supportedParameters === undefined/null
    │   └─ Return true (no supportedParameters declared = default supported)
    │
    └─ model.compat.supportedParameters is array
        ├─ includes "tools" → return true
        └─ does not include "tools" → return false
```

### Backward Compatibility Guarantee

This patch was designed with full backward compatibility in mind:

- **Cloud Providers**: Since they won't set `compat.supportedParameters`, they will continue with default behavior (tools supported)
- **Existing Local Model Configurations**: If previous configs have no `compat` or no `supportedParameters`, behavior remains unchanged
- **New Local Model Configurations**: Users can optionally add `supportedParameters` for precise control
- **Schema Compatibility**: All new fields are `optional()`, which won't break existing configurations

---

## Patch Verification and Problem Diagnosis

### Verification Results

After applying the patch, detailed debugging revealed:

#### ✅ Patch Works Correctly

Through debug logging verification, the following facts were confirmed:

1. **Configuration loaded correctly**: `compat.supportedParameters: ["tools", "tool_choice"]` read correctly
2. **Tool support detection passed**: `modelSupportsTools()` function correctly returns `true`
3. **Tools created successfully**: 4 tools (read, edit, write, exec) created successfully
4. **Tools added to Agent**: `agent.state.tools` contains all 4 tools
5. **API request includes tools parameter**: OpenAI completions provider's `buildParams()` function correctly adds tools to request

#### ❌ Real Issue: sglang Server Not Properly Configured for Tool Calling

Through direct curl testing of sglang API, the root issue was discovered:

**Test Command**:
```bash
curl -X POST http://127.0.0.1:30000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen3-Coder-30B-A3B-Instruct-FP8",
    "messages": [{"role": "user", "content": "Please call get_weather for Beijing"}],
    "tools": [{"type": "function", "function": {"name": "get_weather", "description": "Get weather", "parameters": {"type": "object", "properties": {"location": {"type": "string"}}, "required": ["location"]}}}],
    "tool_choice": "auto"
  }'
```

**Response when tool-call-parser is not configured**:
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "<tool_call>\n<function=get_weather>\n<parameter=location>\nBeijing\n</parameter>\n</function>\n</tool_call>",
      "tool_calls": null
    }
  }]
}
```

**Problem Analysis**:
1. sglang server **accepts** `tools` parameter (no error)
2. But **does not enable** structured function calling by default
3. Model only outputs **text format** pseudo-tool calls in `content` field
4. Response `tool_calls` field is `null`

### Solutions

#### Solution A: Enable sglang Tool Calling Function (✅ Verified Working)

sglang supports enabling function calling through the `--tool-call-parser` parameter. **The key is choosing the correct parser**.

##### Tool Call Parser Selection Guide

| Model Series | Recommended Parser | Verification Status |
|--------------|-------------------|-------------------|
| **Qwen3 Coder** | `qwen3_coder` | ✅ **Verified Working** |
| Qwen 2.5 | `qwen25` | ❌ Doesn't work |
| Hermes Format | `hermes` | ❌ Some versions unsupported |
| DeepSeek V3 | `deepseekv3` | Untested |
| Llama 3 | `llama3` | Untested |

##### Verified Working sglang Launch Command

```bash
python -m sglang.launch_server \
  --model-path /path/to/Qwen3-Coder-30B-A3B-Instruct-FP8 \
  --tool-call-parser qwen3_coder \
  --port 30000 \
  --host 0.0.0.0
```

#### Solution B: Replace sglang with vLLM

vLLM also supports OpenAI-style function calling:

```bash
vllm serve /path/to/model \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --port 30000
```

### Practical Experience Summary

| Test Item | Result | Explanation |
|-----------|--------|-------------|
| sglang + no parser | ❌ Failed | Returns `tool_calls: null` |
| sglang + `hermes` | ❌ Failed | sglang reports unsupported |
| sglang + `qwen25` | ❌ Failed | Prints only, doesn't execute |
| sglang + `qwen3_coder` | ✅ Success | Correctly returns structured `tool_calls` |

### Method to Test Tool Calling Support

```bash
curl -X POST http://localhost:30000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-model-id",
    "messages": [{"role": "user", "content": "What is the weather in Beijing?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather information",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string", "description": "City name"}
          },
          "required": ["location"]
        }
      }
    }],
    "tool_choice": "auto"
  }' | jq .
```

**Successful Response Should Contain**:
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_xxx",
        "type": "function",
        "function": {
          "name": "get_weather",
          "arguments": "{\"location\": \"Beijing\"}"
        }
      }]
    }
  }]
}
```

---

## Rollback Method

If you need to rollback this patch, restore backup files:

```bash
cd /path/to/clawdbot

cp src/config/zod-schema.core.ts.backup src/config/zod-schema.core.ts
cp src/config/types.models.ts.backup src/config/types.models.ts
cp src/agents/model-compat.ts.backup src/agents/model-compat.ts
cp src/agents/pi-embedded-runner/run/attempt.ts.backup src/agents/pi-embedded-runner/run/attempt.ts
cp src/agents/tools/web-search.ts.backup src/agents/tools/web-search.ts

# Build (either one)
pnpm build     # If using pnpm
# Or: npm run build

sudo npm install -g .
```

---

## Troubleshooting

### Problem 1: Tools Print Code But Don't Execute

**Cause**: sglang not enabled with correct `--tool-call-parser`

**Solution**: Ensure sglang launch uses `--tool-call-parser qwen3_coder` (for Qwen3 Coder models)

### Problem 2: curl Test Returns `tool_calls: null`

**Cause**: Inference server not configured correctly for tool calling

**Diagnostic Command**:
```bash
curl -X POST http://127.0.0.1:30000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen3-Coder-30B-A3B-Instruct-FP8",
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "tools": [{"type": "function", "function": {"name": "calculator", "description": "Calculate math", "parameters": {"type": "object", "properties": {"expr": {"type": "string"}}, "required": ["expr"]}}}],
    "tool_choice": "auto"
  }' | jq '.choices[0].message'
```

### Problem 3: Clawdbot Not Sending Tools Parameters

**Diagnostic**: Enable debug logging with environment variable
```bash
CLAWDBOT_DEBUG_TOOLS=1 clawdbot agent --local --message "test"
```

Check logs for:
- `[model-compat] modelSupportsTools check:`
- `[model-compat] supportedParams array check:`

If `modelHasToolSupport=false`, check if `compat.supportedParameters` in configuration includes `"tools"`.

---

## Common supportedParameters Values

Reference for common `supportedParameters` values:

### General Parameters
- `tools` - Tool/function calling
- `tool_choice` - Tool selection strategy
- `temperature` - Temperature sampling
- `top_p` - Nucleus sampling
- `max_tokens` / `max_completion_tokens` - Maximum output tokens
- `stop` - Stop sequences
- `stream` - Streaming output

### OpenAI Specific
- `response_format` - Response format (e.g., JSON mode)
- `seed` - Reproducible generation
- `parallel_tool_calls` - Parallel tool calls

---

## Optional: systemd Service Proxy Configuration

⚠️ **This section is optional**, applicable only in the following situations:
- Running Clawdbot Gateway via systemd user service
- Need to access external networks (e.g., DuckDuckGo) through HTTP proxy

### Users Without Proxy

**If you don't use VPN/proxy**, you can skip this entire section. The curl implementation will connect directly to DuckDuckGo without any additional configuration. The code is robust:
- curl connects directly when no proxy environment variables are set
- The actual `web-search.ts` code uses `execFileSync("curl", ...)` to invoke system curl
- curl automatically detects `http_proxy`/`https_proxy` environment variables, connects directly when absent

### Background (Proxy Users Only)

DuckDuckGo uses curl for network requests, and curl automatically uses proxy settings from environment variables (`http_proxy`, `https_proxy`). However:

1. **systemd service environment isolation**: systemd user services don't inherit desktop session environment variables
2. **GNOME proxy changes dynamically**: Proxy settings may change with network environment

### Solution: Use One-Click Configuration Script (Recommended for GNOME Users)

This repository provides `config_gateway_proxy.sh` in the root directory, which automatically:
1. Creates the proxy sync script `~/.config/clawdbot/update-proxy-env.sh`
2. Modifies the systemd service configuration, adding `ExecStartPre` and `EnvironmentFile`

#### Usage

```bash
# Enter the patch repository directory
cd /path/to/clawdbot-patch

# Run the one-click configuration script
./config_gateway_proxy.sh

# Reload and restart service
systemctl --user daemon-reload
systemctl --user restart clawdbot-gateway
```

#### Verify Proxy Configuration

```bash
# Check service status
systemctl --user status clawdbot-gateway

# View proxy environment file
cat /tmp/clawdbot-proxy.env

# Test DuckDuckGo search
clawdbot agent --local --message "search for today's weather"
```

### Alternative: Static Proxy Configuration

If proxy settings are fixed, you can hardcode them directly in the systemd service:

```ini
[Service]
Environment="http_proxy=http://proxy.example.com:8080"
Environment="https_proxy=http://proxy.example.com:8080"
Environment="no_proxy=localhost,127.0.0.1"
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-02-02 | Initial patch: Added supportedParameters configuration support |
| 1.1.0 | 2026-02-02 | Added diagnostic results: Discovered sglang needs tool-call-parser |
| 1.2.0 | 2026-02-02 | Added tool-call-parser verification results; added complete deployment guide |
| 1.3.0 | 2026-02-03 | PR code review fixes: Removed debug file writes, ensured backward compatibility |
| 1.4.0 | 2026-02-03 | Added DuckDuckGo free web search; updated build command instructions |
| 1.5.0 | 2026-02-03 | Added DuckDuckGo configuration Schema support; updated type definitions and configuration docs |
| 1.6.0 | 2026-02-04 | Fixed web_search tool not enabled issue: must explicitly add web_search to tools.allow |
| 1.7.0 | 2026-02-04 | Improved web_search tool description: explicitly tell agent not to use exec curl for searches |
| 1.8.0 | 2026-02-04 | DuckDuckGo now uses curl (fixes undici anti-bot detection issue); added tool-policy.ts documentation; added optional systemd proxy configuration section |
| 1.9.0 | 2026-02-05 | Added DuckDuckGo search test suite (8 tests); added one-click test runner script; config_gateway_proxy.sh now auto-applies changes |
