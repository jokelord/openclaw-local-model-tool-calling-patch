# 本地模型工具调用支持补丁
clawdbot fork: 
https://github.com/jokelord/local-model-tool-calling

## 🎯 补丁目标

让 Clawdbot 支持本地推理模型（sglang/vLLM）的 tool calling 功能。

**验证环境**：
- 模型：Qwen3-Coder-30B-A3B-Instruct-FP8
- 推理服务器：sglang + `--tool-call-parser qwen3_coder`
- Clawdbot 版本：2026.2.3

**验证结果**：✅ 成功调用工具

---

## 快速开始（TL;DR）

如果你只想快速让本地 Qwen3 Coder 模型支持 tool calling，按以下步骤操作：

### 1. 启动 sglang 服务器（关键：使用正确的 parser）

```bash
python -m sglang.launch_server \
  --model-path /path/to/Qwen3-Coder-30B-A3B-Instruct-FP8 \
  --tool-call-parser qwen3_coder \
  --port 30000 \
  --host 0.0.0.0
```

### 2. 配置 Clawdbot（~/.clawdbot/clawdbot.json）

完整推荐配置：

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

### 3. 应用本补丁的代码修改（见下文详细步骤）

### 4. 构建并测试

```bash
cd /path/to/clawdbot

# 安装依赖（二选一）
pnpm install   # 推荐，更快
# 或: npm install

# 构建（二选一）
pnpm build     # 如果用 pnpm
# 或: npm run build

# 全局安装
sudo npm install -g .

```

---

## 补丁原因

### 问题描述

Clawdbot 能够成功将 tool 调用请求发送给云服务商（如 OpenAI、Anthropic），但无法将 tool 调用请求发送给本地推理模型（如 sglang、vLLM）。

### 根本原因分析

经过代码分析，发现问题出在以下几点：

1. **云服务商的 tool 支持检测**：对于 OpenRouter 等云服务商，系统通过 API 返回的 `supported_parameters` 元数据来判断模型是否支持 tools：
   ```typescript
   // src/agents/model-scan.ts (line 204)
   const supportsToolsMeta = supportedParameters.includes("tools");
   ```

2. **本地模型缺乏声明机制**：本地推理模型（sglang、vLLM 等）没有类似的 API 来声明其支持的参数，也没有配置项让用户手动声明。

3. **配置 Schema 限制**：`ModelCompatSchema` 原本不支持 `supportedParameters` 字段，导致用户无法在配置中声明本地模型的 tool 支持能力。

4. **推理服务器配置**：即使 Clawdbot 发送了 tools 参数，如果 sglang/vLLM 没有启用正确的 `--tool-call-parser`，服务器也不会返回结构化的 `tool_calls`，而是在 `content` 中输出文本格式的伪工具调用。

5. **网络搜索工具限制**：原版 Clawdbot 的 `web_search` 工具仅支持 Brave Search（需要 API Key）和 Perplexity（需要 API Key）。对于本地部署或不想申请 API Key 的用户，缺乏免费的网络搜索选项。此外，原实现使用 undici/fetch 进行 HTTP 请求，在某些代理环境下会被搜索引擎的反爬虫机制拦截。

### 补丁目的

1. **允许用户声明本地模型的 tool 支持**：通过在模型配置的 `compat` 对象中添加 `supportedParameters` 字段，让用户可以显式声明本地模型支持哪些 API 参数。

2. **保持向后兼容**：对于未声明 `supportedParameters` 的模型（包括所有现有云服务商配置），继续假设支持 tools，不影响现有功能。

3. **灵活控制**：用户可以通过配置精确控制哪些模型启用/禁用 tools。

4. **提供免费网络搜索**：新增 DuckDuckGo 作为免费搜索提供商，无需 API Key 即可使用。采用 curl 命令实现（而非 undici/fetch），有效绕过 DuckDuckGo 的反爬虫检测，同时自动支持系统代理环境变量。

---

## 修改的文件

本补丁涉及修改的文件位置（树形结构展示）：

```
clawdbot/
│
└── src/
    ├── config/
    │   ├── zod-schema.core.ts         ✏️ [修改] 添加 supportedParameters 字段到 Schema
    │   ├── zod-schema.agent-runtime.ts ✏️ [修改] 添加 DuckDuckGo 提供商到 Schema
    │   ├── types.models.ts            ✏️ [修改] 添加 supportedParameters 到类型定义
    │   ├── types.tools.ts             ✏️ [修改] 添加 DuckDuckGo 提供商到类型定义
    │   └── schema.ts                  ✏️ [修改] 更新配置说明文档
    │
    └── agents/
        ├── model-compat.ts            ✏️ [修改] 新增 modelSupportsTools() 函数
        ├── tool-policy.ts             ✏️ [确认] 确保 coding profile 包含 group:web
        │
        ├── tools/
        │   └── web-search.ts          ✏️ [修改] 添加 DuckDuckGo 免费搜索（curl 实现）
        │
        └── pi-embedded-runner/
            └── run/
                └── attempt.ts         ✏️ [修改] 添加工具支持检测逻辑
```

### 修改文件清单

| 序号 | 文件路径 | 修改类型 | 说明 |
|------|----------|----------|------|
| 1 | `src/config/zod-schema.core.ts` | 修改 Schema | 在 `ModelCompatSchema` 中添加 `supportedParameters` 字段 |
| 2 | `src/config/zod-schema.agent-runtime.ts` | 修改 Schema | 在 `ToolsWebSearchSchema` 中添加 DuckDuckGo 提供商支持 |
| 3 | `src/config/types.models.ts` | 修改类型 | 在 `ModelCompatConfig` 类型中添加 `supportedParameters` 属性 |
| 4 | `src/config/types.tools.ts` | 修改类型 | 在 web search 配置类型中添加 DuckDuckGo 提供商支持 |
| 5 | `src/config/schema.ts` | 修改文档 | 更新 web search provider 配置说明 |
| 6 | `src/agents/model-compat.ts` | 新增函数 | 添加 `modelSupportsTools()` 工具支持检测函数 |
| 7 | `src/agents/tool-policy.ts` | 确认/修改 | 确保 `coding` profile 的 allow 列表包含 `group:web` |
| 8 | `src/agents/tools/web-search.ts` | 修改工具 | 添加 DuckDuckGo 免费搜索（使用 curl 实现，绕过反爬虫） |
| 9 | `src/agents/pi-embedded-runner/run/attempt.ts` | 修改逻辑 | 在工具创建前添加模型支持检查 |

### 测试文件（可选）

| 序号 | 文件路径 | 类型 | 说明 |
|------|----------|------|------|
| 11 | `src/agents/tools/duckduckgo-search.test.ts` | **新增测试** | DuckDuckGo 搜索单元测试 + 实时测试（共 8 个测试） |
| 12 | `test/run-duckduckgo-test.sh` | **新增脚本** | DuckDuckGo 搜索测试一键运行脚本 |

---

## 应用补丁

### 步骤 1：准备工作

确保你已经克隆了 Clawdbot 源码仓库并安装了依赖：

```bash
# 进入项目目录
cd /path/to/clawdbot

# 安装依赖（二选一）
pnpm install   # 推荐，更快
# 或: npm install
```

### 步骤 2：备份原始文件（可选）

在应用补丁之前，可以先备份所有要修改的文件：

```bash
# 模型 tool 支持相关
cp src/config/zod-schema.core.ts src/config/zod-schema.core.ts.backup
cp src/config/types.models.ts src/config/types.models.ts.backup
cp src/agents/model-compat.ts src/agents/model-compat.ts.backup
cp src/agents/pi-embedded-runner/run/attempt.ts src/agents/pi-embedded-runner/run/attempt.ts.backup

# DuckDuckGo 搜索相关
cp src/agents/tools/web-search.ts src/agents/tools/web-search.ts.backup
cp src/config/zod-schema.agent-runtime.ts src/config/zod-schema.agent-runtime.ts.backup
cp src/config/types.tools.ts src/config/types.tools.ts.backup
cp src/config/schema.ts src/config/schema.ts.backup
cp src/agents/tool-policy.ts src/agents/tool-policy.ts.backup
```

### 步骤 3：应用代码修改

将本仓库4个文件依各自路径覆盖源文件，或按照下方「完整代码修改」章节的说明，修改 4 个文件。

### 步骤 4：构建和安装

```bash
# 构建 TypeScript 代码（二选一）
pnpm build     # 如果用 pnpm
# 或: npm run build

# 全局安装修改后的版本
sudo npm install -g .

# 验证安装
clawdbot --version
```

### 步骤 5：配置本地模型

在 `~/.clawdbot/clawdbot.json` 中为你的本地模型添加配置。注意 `compat.supportedParameters` 是关键配置项：

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

### 步骤 6：测试验证

```bash
# 启用 debug 日志测试
CLAWDBOT_DEBUG_TOOLS=1 clawdbot agent --local --message "列出当前目录的文件"
```

---

## 完整代码修改

以下是需要修改的完整代码片段，直接复制粘贴到对应文件中即可。

### 文件 1: src/config/zod-schema.core.ts

找到 `ModelCompatSchema` 的定义，添加 `supportedParameters` 字段：

```typescript
export const ModelCompatSchema = z
  .object({
    supportsStore: z.boolean().optional(),
    supportsDeveloperRole: z.boolean().optional(),
    supportsReasoningEffort: z.boolean().optional(),
    maxTokensField: z
      .union([z.literal("max_completion_tokens"), z.literal("max_tokens")])
      .optional(),
    // 新增：允许本地模型声明 tool 支持
    supportedParameters: z.array(z.string()).optional(),
  })
  .strict()
  .optional();
```

⚠️ **重要提示**：修改此文件时，请确保不要改动其他 Schema 定义。特别注意：
- `TtsProviderSchema` 必须保持 `z.enum(["elevenlabs", "openai", "edge"])`（包含 `edge`）
- `TtsAutoSchema` 必须保持 `z.enum(["off", "always", "inbound", "tagged"])`
- `ModelDefinitionSchema` 中的字段必须保持 `optional()`

### 文件 2: src/config/types.models.ts

找到 `ModelCompatConfig` 类型定义，添加 `supportedParameters` 字段：

```typescript
export type ModelCompatConfig = {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  supportedParameters?: string[];  // 新增：声明模型支持的 API 参数
};
```

### 文件 3: src/agents/model-compat.ts

在文件**末尾**添加以下函数：

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

### 文件 4: src/agents/pi-embedded-runner/run/attempt.ts

**步骤 1**：在文件顶部的 import 区域添加：

```typescript
import { modelSupportsTools } from "../../model-compat.js";
```

**步骤 2**：找到创建 tools 的代码段（搜索 `createClawdbotCodingTools`），在其**前面**添加检查逻辑：

```typescript
// 检查模型是否支持 tools
const modelHasToolSupport = modelSupportsTools(params.model);

if (!modelHasToolSupport) {
  log.debug(
    `Tools disabled for model ${params.modelId}: compat.supportedParameters does not include "tools"`,
  );
}
```

**步骤 3**：修改 tools 创建的条件，将原来的：

```typescript
const toolsRaw =
  params.disableTools
    ? []
    : createClawdbotCodingTools({ ... });
```

改为：

```typescript
const toolsRaw =
  params.disableTools || !modelHasToolSupport
    ? []
    : createClawdbotCodingTools({ ... });
```

⚠️ **重要提示**：修改此文件时，**不要添加任何调试文件写入代码**（如 `fs.appendFileSync` 写入 `/tmp` 目录）。所有调试输出应通过 `log.debug()` 或 `console.error`（在环境变量开启时）进行。

### 文件 5: src/agents/tools/web-search.ts

**说明**：添加 DuckDuckGo 免费搜索提供商支持，无需 API Key。使用 curl 命令执行搜索（绕过 DuckDuckGo 对 undici/fetch 的反爬虫检测）。

**关键修改点**：
1. 新增 `DUCKDUCKGO_HTML_ENDPOINT` 常量
2. 新增 `parseDuckDuckGoHtml()` 函数解析 HTML 结果
3. 新增 `runDuckDuckGoSearch()` 函数使用 curl 执行搜索
4. 在 `runWebSearch()` 中添加 DuckDuckGo provider 分支
5. 在 `createWebSearchTool()` 中添加 DuckDuckGo 的 description

**为什么使用 curl 而不是 fetch/undici**：
- 原生 fetch：不支持代理环境变量
- undici + ProxyAgent：被 DuckDuckGo 反爬虫拦截（返回 HTTP 202，0 结果）
- curl：自动使用代理环境变量，且不被反爬虫拦截 ✅

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

// Cached proxy agent for reuse (用于 Brave/Perplexity，DuckDuckGo 使用 curl)
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
 * NOTE: 仅用于 Brave/Perplexity；DuckDuckGo 使用 curl 因为 undici 被反爬虫拦截
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

  // 使用 proxyFetch 支持代理（Perplexity 不会像 DuckDuckGo 那样拦截）
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

  // Brave Search API 使用 proxyFetch 支持代理
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

### 文件 6: src/config/zod-schema.agent-runtime.ts

找到 `ToolsWebSearchSchema` 的定义，添加 DuckDuckGo 提供商支持：

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

### 文件 7: src/config/types.tools.ts

找到 web search 配置的类型定义，添加 DuckDuckGo 提供商支持：

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

### 文件 8: src/config/schema.ts

找到 web search provider 的配置说明，更新支持的提供商列表：

```typescript
  "tools.web.search.provider": 'Search provider ("brave", "perplexity", or "duckduckgo"). DuckDuckGo is free and requires no API key.',
```

### 文件 9: src/agents/tool-policy.ts

**重要**：确保 `coding` profile 的 `allow` 列表包含 `group:web`。这是 `web_search` 工具生效的关键。

找到 `PRESET_PROFILES` 中的 `coding` 定义，确认或添加 `group:web`：

```typescript
export const PRESET_PROFILES: Record<ToolProfileId, ToolPolicyLike> = {
  // ... 其他 profiles ...
  coding: {
    allow: ["group:fs", "group:runtime", "group:sessions", "group:memory", "group:web", "image"],
  },
  // ... 其他 profiles ...
};
```

如果 `coding` profile 没有 `group:web`，需要添加。`group:web` 包含以下工具：
- `web_search` - 网络搜索
- `web_fetch` - 获取网页内容

---

## 使用方法

### Tools 配置（强烈推荐）

Clawdbot 的 tools 配置控制工具调用的行为。虽然不是强制性的，但**强烈建议配置**以获得最佳体验。

#### 配置项详解

| 配置项 | 默认值 | 推荐值 | 说明 |
|--------|--------|--------|------|
| `profile` | `"default"` | `"coding"` | 启用完整的编程工具集（read/write/edit/exec） |
| `allow` | 取决于 profile | `["read", "exec", "write", "edit", "web_search"]` | 明确允许的工具白名单（需要网络搜索时必须包含 `web_search`） |
| `exec.host` | `"local"` | `"gateway"` | 命令执行位置 |
| `exec.security` | `"normal"` | `"full"` | `"normal"` = 受限权限；`"full"` = 完整权限 |
| `exec.ask` | `"on"` | `"off"` | `"on"` = 每次确认；`"off"` = 自动执行 |
| `web.search.provider` | `"brave"` | `"duckduckgo"` | 搜索提供商（DuckDuckGo 免费无需 API Key） |

#### 安全性权衡

**保守配置**（安全但交互频繁）：
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

**激进配置**（流畅但需信任 LLM）：
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

⚠️ **安全警告**：`security: "full"` + `ask: "off"` 允许 LLM 执行任何命令（包括 `sudo rm -rf /` 等）。建议仅在隔离的开发环境中使用。

#### 网络搜索配置

本补丁新增支持 **DuckDuckGo 免费搜索**，无需 API Key。相比默认的 Brave Search（需要 API Key），DuckDuckGo 提供完全免费的网络搜索功能。

⚠️ **重要**：`web_search` 工具默认**不在** `coding` profile 的工具列表中。如果你使用了 `tools.allow` 配置，**必须显式添加 `web_search`** 才能启用网络搜索！

⚠️ **为什么不能用 curl 搜索**：Google、Bing、DuckDuckGo 等搜索引擎会阻止 curl 请求，返回空结果或验证页面。`web_search` 工具使用专门的 API（Brave Search API）或 HTML 解析（DuckDuckGo Lite）来获取真实搜索结果。如果 agent 尝试用 `exec curl` 搜索，应该引导它使用 `web_search` 工具。

**启用 DuckDuckGo 搜索**（完整配置）：
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

或使用 CLI 命令：
```bash
clawdbot config set tools.web.search.provider duckduckgo
```

**启用 Brave 搜索**（需要 API Key）：
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

或使用 CLI 命令：
```bash
clawdbot config set tools.web.search.apiKey your_brave_api_key_here
clawdbot config set tools.web.search.provider brave
```

**搜索提供商对比**：
| 提供商 | 需要 API Key | 费用 | 配置值 |
|--------|-------------|------|--------|
| **DuckDuckGo** | ❌ 不需要 | 免费 | `"duckduckgo"` 或 `"ddg"` |
| Brave Search | ✅ 需要 | 免费额度有限 | `"brave"` |
| Perplexity | ✅ 需要 | 付费 | `"perplexity"` |

### 模型配置场景

#### 场景 1：启用本地模型的 tool 支持

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

#### 场景 2：禁用特定模型的 tool 支持

如果某个模型不支持 tools，可以显式禁用：

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

#### 场景 3：云服务商模型（无需修改）

对于云服务商模型，不需要任何配置更改。如果 `compat.supportedParameters` 未声明，系统将保持原有行为，假设模型支持 tools。

---

## 技术细节

### 判断逻辑流程图

```
模型是否支持 tools?
    │
    ├─ model.api !== "openai-completions"
    │   └─ 返回 true (非 OpenAI API 模型默认支持)
    │
    ├─ model.compat === undefined/null
    │   └─ 返回 true (未配置 compat = 默认支持)
    │
    ├─ model.compat.supportedParameters === undefined/null
    │   └─ 返回 true (未声明 supportedParameters = 默认支持)
    │
    └─ model.compat.supportedParameters 是数组
        ├─ 包含 "tools" → 返回 true
        └─ 不包含 "tools" → 返回 false
```

### 向后兼容性保证

本补丁设计时充分考虑了向后兼容性：

- **云服务商**：因为不会设置 `compat.supportedParameters`，所以继续使用默认行为（支持 tools）
- **现有本地模型配置**：如果之前的配置没有 `compat` 或没有 `supportedParameters`，行为不变
- **新本地模型配置**：用户可以选择性地添加 `supportedParameters` 来精确控制
- **Schema 兼容**：所有新增字段都是 `optional()`，不会破坏现有配置

---

## 补丁验证与问题诊断

### 验证结果

应用补丁后进行了详细的调试验证：

#### ✅ 补丁本身工作正常

通过添加调试日志验证了以下事实：

1. **配置正确加载**：`compat.supportedParameters: ["tools", "tool_choice"]` 被正确读取
2. **工具支持检测通过**：`modelSupportsTools()` 函数正确返回 `true`
3. **工具创建成功**：4个工具（read, edit, write, exec）被成功创建
4. **工具添加到 Agent**：`agent.state.tools` 包含所有 4 个工具
5. **API 请求包含 tools 参数**：OpenAI completions provider 的 `buildParams()` 函数正确将 tools 添加到请求中

#### ❌ 真正的问题：sglang 服务器未正确配置 tool calling

通过直接使用 curl 测试 sglang API 发现了根本问题：

**测试命令**：
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

**未配置 tool-call-parser 时的响应**：
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

**问题分析**：
1. sglang 服务器**接受** `tools` 参数（不报错）
2. 但**默认情况下不启用**结构化的 function calling
3. 模型只是在 `content` 字段中输出**文本格式**的伪工具调用
4. 响应的 `tool_calls` 字段为 `null`

### 解决方案

#### 方案 A：启用 sglang 的 tool calling 功能（✅ 已验证可行）

sglang 支持通过 `--tool-call-parser` 参数启用 function calling。**关键是选择正确的解析器**。

##### Tool Call Parser 选择指南

| 模型系列 | 推荐 Parser | 验证状态 |
|----------|-------------|----------|
| **Qwen3 Coder** | `qwen3_coder` | ✅ **已验证成功** |
| Qwen 2.5 | `qwen25` | ❌ 不工作 |
| Hermes 格式 | `hermes` | ❌ 某些版本不支持 |
| DeepSeek V3 | `deepseekv3` | 未测试 |
| Llama 3 | `llama3` | 未测试 |

##### 验证成功的 sglang 启动命令

```bash
python -m sglang.launch_server \
  --model-path /path/to/Qwen3-Coder-30B-A3B-Instruct-FP8 \
  --tool-call-parser qwen3_coder \
  --port 30000 \
  --host 0.0.0.0
```

#### 方案 B：使用 vLLM 替代 sglang

vLLM 也支持 OpenAI 风格 function calling：

```bash
vllm serve /path/to/model \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --port 30000
```

### 实测经验总结

| 测试项 | 结果 | 说明 |
|--------|------|------|
| sglang + 无 parser | ❌ 失败 | 返回 `tool_calls: null` |
| sglang + `hermes` | ❌ 失败 | sglang 报错不支持 |
| sglang + `qwen25` | ❌ 失败 | 只打印不执行 |
| sglang + `qwen3_coder` | ✅ 成功 | 正确返回结构化 `tool_calls` |

### 验证 tool calling 支持的测试方法

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

**成功的响应应该包含**：
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

## 回滚方法

如果需要回滚此补丁，恢复备份文件：

```bash
cd /path/to/clawdbot

cp src/config/zod-schema.core.ts.backup src/config/zod-schema.core.ts
cp src/config/types.models.ts.backup src/config/types.models.ts
cp src/agents/model-compat.ts.backup src/agents/model-compat.ts
cp src/agents/pi-embedded-runner/run/attempt.ts.backup src/agents/pi-embedded-runner/run/attempt.ts
cp src/agents/tools/web-search.ts.backup src/agents/tools/web-search.ts

# 构建（二选一）
pnpm build     # 如果用 pnpm
# 或: npm run build

sudo npm install -g .
```

---

## 故障排除

### 问题 1：工具只打印代码但不执行

**原因**：sglang 没有启用正确的 `--tool-call-parser`

**解决**：确保 sglang 启动时使用了 `--tool-call-parser qwen3_coder`（针对 Qwen3 Coder 模型）

### 问题 2：curl 测试返回 `tool_calls: null`

**原因**：推理服务器没有正确配置 tool calling

**诊断命令**：
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

### 问题 3：Clawdbot 没有发送 tools 参数

**诊断**：设置环境变量启用调试日志
```bash
CLAWDBOT_DEBUG_TOOLS=1 clawdbot agent --local --message "test"
```

检查日志中是否有：
- `[model-compat] modelSupportsTools check:`
- `[model-compat] supportedParams array check:`

如果 `modelHasToolSupport=false`，检查配置文件中的 `compat.supportedParameters` 是否包含 `"tools"`。

---

## 常见 supportedParameters 值

以下是常见的 `supportedParameters` 值参考：

### 通用参数
- `tools` - 工具/函数调用
- `tool_choice` - 工具选择策略
- `temperature` - 温度采样
- `top_p` - 核采样
- `max_tokens` / `max_completion_tokens` - 最大输出 tokens
- `stop` - 停止序列
- `stream` - 流式输出

### OpenAI 特有
- `response_format` - 响应格式（如 JSON mode）
- `seed` - 可重复生成
- `parallel_tool_calls` - 并行工具调用

---

## 可选：systemd 服务代理配置

⚠️ **此章节为可选内容**，仅适用于以下情况：
- 通过 systemd 用户服务运行 Clawdbot Gateway
- 需要通过 HTTP 代理访问外部网络（如 DuckDuckGo）

### 不需要代理的用户

**如果你不使用 VPN/代理**，可以完全跳过此章节。curl 实现会直接连接 DuckDuckGo，无需任何额外配置。代码本身是健壮的：
- curl 在没有代理环境变量时会直接连接
- 实际的 `web-search.ts` 代码使用 `execFileSync("curl", ...)` 调用系统 curl
- curl 会自动检测 `http_proxy`/`https_proxy` 环境变量，不存在时直接连接

### 问题背景（仅代理用户）

DuckDuckGo 使用 curl 进行网络请求，curl 会自动使用环境变量中的代理设置（`http_proxy`、`https_proxy`）。但是：

1. **systemd 服务环境隔离**：systemd 用户服务不会继承桌面会话的环境变量
2. **GNOME 代理动态变化**：代理设置可能随网络环境变化而改变

### 解决方案：使用一键配置脚本（推荐 GNOME 用户）

本仓库根目录提供了 `config_gateway_proxy.sh` 一键配置脚本，可自动完成以下操作：
1. 创建代理同步脚本 `~/.config/clawdbot/update-proxy-env.sh`
2. 修改 systemd 服务配置，添加 `ExecStartPre` 和 `EnvironmentFile`

#### 使用方法

```bash
# 进入补丁仓库目录
cd /path/to/clawdbot-patch

# 运行一键配置脚本
./config_gateway_proxy.sh

# 重新加载并重启服务
systemctl --user daemon-reload
systemctl --user restart clawdbot-gateway
```

#### 验证代理配置

```bash
# 检查服务状态
systemctl --user status clawdbot-gateway

# 查看代理环境文件
cat /tmp/clawdbot-proxy.env

# 测试 DuckDuckGo 搜索
clawdbot agent --local --message "搜索一下今天的天气"
```

### 替代方案：静态代理配置

如果代理设置是固定的，可以直接在 systemd 服务中硬编码：

```ini
[Service]
Environment="http_proxy=http://proxy.example.com:8080"
Environment="https_proxy=http://proxy.example.com:8080"
Environment="no_proxy=localhost,127.0.0.1"
```

---

## 版本历史

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| 1.0.0 | 2025-02-02 | 初始补丁：添加 supportedParameters 配置支持 |
| 1.1.0 | 2026-02-02 | 添加诊断结果：发现 sglang 需要 tool-call-parser |
| 1.2.0 | 2026-02-02 | 添加 tool-call-parser 验证结果；添加完整部署指南 |
| 1.3.0 | 2026-02-03 | PR 代码审查修复：移除调试文件写入、确保向后兼容性 |
| 1.4.0 | 2026-02-03 | 添加 DuckDuckGo 免费网络搜索功能；更新构建命令说明 |
| 1.5.0 | 2026-02-03 | 添加 DuckDuckGo 配置 Schema 支持；更新类型定义和配置文档 |
| 1.6.0 | 2026-02-04 | 修复 web_search 工具未启用问题：必须在 tools.allow 中显式添加 web_search |
| 1.7.0 | 2026-02-04 | 改进 web_search 工具描述：明确告知 agent 不要使用 exec curl 搜索 |
| 1.8.0 | 2026-02-04 | DuckDuckGo 改用 curl 实现（修复 undici 被反爬虫拦截问题）；添加 tool-policy.ts 说明；添加可选的 systemd 代理配置章节 |
| 1.9.0 | 2026-02-05 | 添加 DuckDuckGo 搜索测试套件（8 个测试）；添加一键测试运行脚本；config_gateway_proxy.sh 现在自动应用配置 |
| 1.9.0 | 2026-02-05 | 添加 DuckDuckGo 搜索测试套件（8 个测试）；添加一键测试运行脚本；config_gateway_proxy.sh 现在自动应用配置 |
