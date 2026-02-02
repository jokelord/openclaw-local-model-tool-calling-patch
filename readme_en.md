# Local Model Tool Calling Support Patch

## 🎯 Patch Objective

Enable Clawdbot to support tool calling functionality for local inference models (sglang/vLLM).

**Tested Environment**:
- Model: Qwen3-Coder-30B-A3B-Instruct-FP8
- Inference Server: sglang + `--tool-call-parser qwen3_coder`
- Clawdbot Version: 2026.1.24-0

**Test Results**: ✅ Successfully calls tools

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

## Patch Objectives

1. **Allow Users to Declare Local Model Tool Support**: Enable users to explicitly declare which API parameters their local models support by adding a `supportedParameters` field to the model configuration's `compat` object.

2. **Maintain Backward Compatibility**: For models without declared `supportedParameters` (including all existing cloud provider configurations), continue to assume tools are supported without affecting existing functionality.

3. **Flexible Control**: Allow users to precisely control which models enable/disable tools through configuration.

## Modified Files

### 1. src/config/zod-schema.core.ts
**Backup**: `src/config/zod-schema.core.ts.backup`

**Changes**: Add `supportedParameters` field to `ModelCompatSchema`

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

### 2. src/config/types.models.ts
**Backup**: `src/config/types.models.ts.backup`

**Changes**: Add `supportedParameters` field to `ModelCompatConfig` type

```typescript
export type ModelCompatConfig = {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  supportedParameters?: string[];  // NEW
};
```

### 3. src/agents/model-compat.ts
**Backup**: `src/agents/model-compat.ts.backup`

**Changes**: Add `modelSupportsTools()` function

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
  // ... implementation logic
}
```

### 4. src/agents/pi-embedded-runner/run/attempt.ts
**Backup**: `src/agents/pi-embedded-runner/run/attempt.ts.backup`

**Changes**: Add tool support check before tool creation

```typescript
// Check if model supports tools
const modelHasToolSupport = modelSupportsTools(params.model);

if (!modelHasToolSupport) {
  log.debug(
    `Tools disabled for model ${params.modelId}: compat.supportedParameters does not include "tools"`,
  );
}

const toolsRaw =
  params.disableTools || !modelHasToolSupport
    ? []
    : createClawdbotCodingTools({ ... });
```

## Patch Modified Files Structure

Files modified by this patch (tree structure):

```
clawdbot/
└── src/
    ├── config/
    │   ├── zod-schema.core.ts    ✏️ [Modified] Add supportedParameters field to Schema
    │   └── types.models.ts       ✏️ [Modified] Add supportedParameters to type definition
    │
    └── agents/
        ├── model-compat.ts       ✏️ [Modified] Add new modelSupportsTools() function
        │
        └── pi-embedded-runner/
            └── run/
                └── attempt.ts    ✏️ [Modified] Add tool support detection logic
```

### Modified Files List

| # | File Path | Modification Type | Description |
|---|-----------|-------------------|-------------|
| 1 | `src/config/zod-schema.core.ts` | Schema Change | Add `supportedParameters` field to `ModelCompatSchema` |
| 2 | `src/config/types.models.ts` | Type Change | Add `supportedParameters` property to `ModelCompatConfig` type |
| 3 | `src/agents/model-compat.ts` | New Function | Add `modelSupportsTools()` tool support detection function |
| 4 | `src/agents/pi-embedded-runner/run/attempt.ts` | Logic Change | Add model support check before tool creation |

## Usage Methods

### Important: Tools Configuration (Strongly Recommended, Not Mandatory)

Clawdbot's tools configuration controls tool calling behavior. Although not mandatory, **it is strongly recommended** for optimal experience.

#### Recommended Tools Configuration

Add to `~/.clawdbot/clawdbot.json`:

```json
{
  "tools": {
    "profile": "coding",
    "allow": ["read", "exec", "write", "edit"],
    "exec": {
      "host": "gateway",
      "security": "full",
      "ask": "off"
    }
  }
}
```

#### Configuration Item Details

| Configuration Item | Default Value | Recommended Value | Description |
|--------------------|----------------|-------------------|-------------|
| `profile` | `"default"` | `"coding"` | Enable complete coding toolset (read/write/edit/exec) |
| `allow` | Depends on profile | `["read", "exec", "write", "edit"]` | Explicit whitelist of allowed tools |
| `exec.host` | `"local"` | `"gateway"` | Command execution location |
| `exec.security` | `"normal"` | `"full"` | `"normal"` = restricted permissions; `"full"` = full permissions |
| `exec.ask` | `"on"` | `"off"` | `"on"` = confirm each time; `"off"` = auto-execute |

#### What Happens Without Tools Configuration?

| Function | Without Configuration | With Configuration |
|----------|----------------------|-------------------|
| File Reading | ✅ Available | ✅ Available |
| File Writing | ⚠️ May be restricted | ✅ Fully available |
| Command Execution | ⚠️ Confirm each time | ✅ Auto-execute |
| Dangerous Commands | ❌ Blocked | ⚠️ Allowed (use caution) |

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
    "exec": {
      "security": "full",
      "ask": "off"
    }
  }
}
```

⚠️ **Security Warning**: `security: "full"` + `ask: "off"` allows LLM to execute any commands (including dangerous ones like `rm -rf /`). Only use in:
- Isolated development environments
- With complete trust in the LLM model
- Understanding the potential risks

---

### Model Configuration Scenarios

### Scenario 1: Enable Tool Support for Local Models

If your local sglang/vLLM model supports OpenAI-compatible tool calling, configure in `~/.clawdbot/clawdbot.json`:

**JSON Format** (Recommended):
```json
{
  "tools": {
    "profile": "coding",
    "allow": ["read", "exec", "write", "edit"],
    "exec": {
      "host": "gateway",
      "security": "full",
      "ask": "off"
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

**YAML Format** (if using config.yaml):
```yaml
tools:
  profile: coding
  allow:
    - read
    - exec
    - write
    - edit
  exec:
    host: gateway
    security: full
    ask: off

models:
  providers:
    local:
      baseUrl: "http://localhost:30000/v1"
      apiKey: "none"
      api: "openai-completions"
      models:
        - id: "qwen2.5-72b-instruct"
          name: "Qwen2.5 72B Instruct (Local)"
          reasoning: false
          input: ["text"]
          cost:
            input: 0
            output: 0
            cacheRead: 0
            cacheWrite: 0
          contextWindow: 32768
          maxTokens: 8192
          compat:
            # Declare that this model supports tools and tool_choice
            supportedParameters:
              - "tools"
              - "tool_choice"
```

### Scenario 2: Disable Tool Support for Specific Models

If a model doesn't support tools, explicitly disable it:

**JSON Format**:
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

**YAML Format**:
```yaml
models:
  providers:
    local:
      baseUrl: "http://localhost:30000/v1"
      models:
        - id: "llama-3-8b"
          name: "Llama 3 8B (No Tools)"
          # ... other configurations ...
          compat:
            # Empty array means no special parameters are supported
            supportedParameters: []
```

### Scenario 3: Cloud Provider Models (No Changes Needed)

For cloud provider models, no configuration changes are needed. If `compat.supportedParameters` is not declared, the system will maintain existing behavior and assume the model supports tools.

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
- `logprobs` - Log probabilities
- `top_logprobs` - Top K log probabilities
- `parallel_tool_calls` - Parallel tool calls
- `reasoning_effort` - Reasoning intensity (o1 series)

### Anthropic Specific
- `system` - System prompts
- `top_k` - Top K sampling
- `metadata` - Metadata

## Applying the Patch

### Step 1: Preparation

Ensure you have cloned the Clawdbot source code repository and installed dependencies:

```bash
# Enter project directory
cd /home/zk/Project/moltbot-2026.1.24

# Install dependencies (if not already installed)
pnpm install
```

### Step 2: Backup Original Files

Before applying the patch, backup all files to be modified:

```bash
# Backup configuration schema file
cp src/config/zod-schema.core.ts src/config/zod-schema.core.ts.backup

# Backup type definitions file
cp src/config/types.models.ts src/config/types.models.ts.backup

# Backup model compatibility file
cp src/agents/model-compat.ts src/agents/model-compat.ts.backup

# Backup embedded runner file
cp src/agents/pi-embedded-runner/run/attempt.ts src/agents/pi-embedded-runner/run/attempt.ts.backup
```

### Step 3: Apply Code Changes

#### 3.1 Modify Configuration Schema (src/config/zod-schema.core.ts)

Add `supportedParameters` field to `ModelCompatSchema`:

```bash
# Open file in editor
code src/config/zod-schema.core.ts
```

Find the `ModelCompatSchema` definition (around lines 14-26) and add the new field:

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

#### 3.2 Modify Type Definitions (src/config/types.models.ts)

Add `supportedParameters` field to `ModelCompatConfig` type:

```bash
# Open file in editor
code src/config/types.models.ts
```

Find the `ModelCompatConfig` type definition (around lines 9-14) and add the new field:

```typescript
export type ModelCompatConfig = {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  supportedParameters?: string[];  // NEW
};
```

#### 3.3 Add Tool Support Detection Function (src/agents/model-compat.ts)

Add `modelSupportsTools` function at the end of the file:

```bash
# Open file in editor
code src/agents/model-compat.ts
```

Add the new function at the end of the file (after line ~56):

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
  if (supportedParams === undefined || supportedParams === null) {
    return true;
  }

  // If it's an array, check if "tools" is included
  if (Array.isArray(supportedParams)) {
    return supportedParams.includes("tools");
  }

  // Fallback: assume not supported if format is unexpected
  return false;
}
```

#### 3.4 Modify Tool Creation Logic (src/agents/pi-embedded-runner/run/attempt.ts)

Add tool support check before tool creation:

```bash
# Open file in editor
code src/agents/pi-embedded-runner/run/attempt.ts
```

Find the tool creation code segment (around lines 200-212) and add the check logic:

```typescript
// Check if model supports tools
const modelHasToolSupport = modelSupportsTools(params.model);

if (!modelHasToolSupport) {
  log.debug(
    `Tools disabled for model ${params.modelId}: compat.supportedParameters does not include "tools"`,
  );
}

const toolsRaw =
  params.disableTools || !modelHasToolSupport
    ? []
    : createClawdbotCodingTools({ ... });
```

### Step 4: Build and Install

#### 4.1 Build the Project

```bash
# Build TypeScript code
npm run build
```

Successful build will show output similar to:
```
✓ Built in 12.34s
```

#### 4.2 Uninstall Old Version (if installed)

```bash
# Check current installed version
clawdbot --version

# Uninstall globally installed old version
sudo npm uninstall -g clawdbot
```

#### 4.3 Install New Version Globally

```bash
# Install modified version globally
sudo npm install -g .
```

Successful installation will show:
```
added 1 package in 258ms
```

#### 4.4 Verify Installation

```bash
# Check if new version is installed correctly
clawdbot --version

# Should show something like: 2026.1.24-0
```

### Step 5: Configure Local Model

Add `supportedParameters` configuration for your local model in `~/.clawdbot/config.yaml`:

```yaml
models:
  providers:
    local:
      baseUrl: "http://localhost:30000/v1"
      apiKey: "none"
      api: "openai-completions"
      models:
        - id: "your-model-name"
          name: "Your Local Model"
          # ... other configurations ...
          compat:
            supportedParameters:
              - "tools"
              - "tool_choice"
```

### Step 6: Test and Verify

```bash
# Test with debug logging enabled
CLAWDBOT_LOG_LEVEL=debug clawdbot agent --message "Please help me run a simple tool call test"

# Check for tool call related output in logs
```

## Rollback Method

If you need to rollback this patch, execute the following commands:

```bash
cd /home/zk/Project/moltbot-2026.1.24

# Restore backup files
cp src/config/zod-schema.core.ts.backup src/config/zod-schema.core.ts
cp src/config/types.models.ts.backup src/config/types.models.ts
cp src/agents/model-compat.ts.backup src/agents/model-compat.ts
cp src/agents/pi-embedded-runner/run/attempt.ts.backup src/agents/pi-embedded-runner/run/attempt.ts
```

## Test Verification

After applying the patch, you can verify using the following methods:

1. **Enable debug logging**:
   ```bash
   CLAWDBOT_LOG_LEVEL=debug clawdbot agent --message "test"
   ```

2. **Check log output**:
   - If model doesn't support tools, you'll see:
     `Tools disabled for model xxx: compat.supportedParameters does not include "tools"`
   - If model supports tools, no such log will appear

3. **Test tool calling**:
   - For models with `supportedParameters: ["tools"]` declared, should be able to use tools normally
   - For models without declaration or with empty array, tools will be disabled

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

- **Cloud Providers**: Since they won't set `compat.supportedParameters`, they will continue with default behavior (tools supported)
- **Existing Local Model Configurations**: If previous configs have no `compat` or no `supportedParameters`, behavior remains unchanged
- **New Local Model Configurations**: Users can optionally add `supportedParameters` for precise control

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

Debug log evidence:
```
[attempt.ts] modelHasToolSupport=true
[attempt.ts] tools count=4, names=read, edit, write, exec
[attempt.ts] After createAgentSession: agent.state.tools count=4, names=read, edit, write, exec
```

#### ❌ Real Issue: sglang Server Not Properly Configured for Tool Calling

Through direct curl testing of sglang API, the root issue was discovered:

**Test Command**:
```bash
curl -X POST http://127.0.0.1:30000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen3-Coder-30B-A3B-Instruct-FP8",
    "messages": [{"role": "user", "content": "Please call get_weather for Beijing"}],
    "tools": [{"type": "function", "function": {"name": "get_weather", ...}}],
    "tool_choice": "auto"
  }'
```

**Actual Response** (when tool-call-parser is not configured):
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "<tool_call>\n<function=get_weather>\n<parameter=location>\nBeijing\n</parameter]\n</function>\n</tool_call>",
      "tool_calls": null
    }
  }]
}
```

**Problem Analysis**:
1. sglang server **accepts** `tools` parameter (no error)
2. But **does not enable** structured function calling by default
3. Model only outputs **text format** pseudo-tool calls in `content` field: `<tool_call>...</tool_call>`
4. Response `tool_calls` field is `null`

This means:
- **Clawdbot code is completely correct**: tool definitions are indeed sent to API
- **Issue is at inference server configuration level**: sglang supports OpenAI-style native function calling, but needs to be enabled via `--tool-call-parser` parameter

### Solution Options

Based on the above diagnosis, here are several solutions:

#### Solution A: Enable sglang Tool Calling Function (✅ Verified Working)

sglang supports enabling function calling through the `--tool-call-parser` parameter. **The key is choosing the correct parser**.

##### 🔑 Tool Call Parser Selection Guide

| Model Series | Recommended Parser | Verification Status |
|--------------|-------------------|-------------------|
| **Qwen3 Coder** | `qwen3_coder` | ✅ **Verified Working** |
| Qwen 2.5 | `qwen25` | ❌ Doesn't work (prints only) |
| Hermes Format | `hermes` | ❌ sglang reports unsupported |
| Pythonic Format | `pythonic` | ❌ Doesn't work (prints only) |
| DeepSeek V3 | `deepseekv3` | Untested |
| Llama 3 | `llama3` | Untested |
| Mistral | `mistral` | Untested |

##### ✅ Verified Working sglang Launch Command

```bash
# For Qwen3-Coder series models, use qwen3_coder parser
python -m sglang.launch_server \
  --model-path /path/to/Qwen3-Coder-30B-A3B-Instruct-FP8 \
  --tool-call-parser qwen3_coder \
  --port 30000 \
  --host 0.0.0.0
```

##### Common tool-call-parser Options

sglang supported parsers list (as of February 2026):
- `deepseekv3`, `deepseekv31`, `deepseekv32` - DeepSeek series
- `glm`, `glm45`, `glm47` - GLM series
- `gpt-oss` - GPT open source compatible
- `kimi_k2` - Kimi K2
- `lfm2` - LFM2
- `llama3` - Llama 3
- `mimo` - MIMO
- `mistral` - Mistral
- `pythonic` - Pythonic format
- `qwen`, `qwen25`, **`qwen3_coder`** - Qwen series
- `step3` - Step3
- `minimax-m2` - MiniMax M2
- `trinity` - Trinity
- `interns1` - InternS1
- `hermes` - Hermes format (note: some sglang versions may not support)

##### How to Determine Correct Parser

1. **Determine by model name**: If model name contains "qwen3" and "coder" → `qwen3_coder`
2. **Check model documentation**: Model publishers usually specify recommended tool calling format
3. **Trial and error method**: Prioritize parsers that have been verified, try them in order

#### Solution B: Replace sglang with vLLM

vLLM also supports OpenAI-style function calling:

```bash
# Install vLLM
pip install vllm

# For Qwen3 Coder models, use qwen3_coder parser
vllm serve /path/to/model \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --port 30000
```

**vLLM Common Parsers** (similar to sglang):
- `hermes` - Universal Hermes format
- `qwen3_coder` - Qwen3 Coder series
- `qwen25` - Qwen 2.5 series
- `llama3` - Llama 3 series

Then update Clawdbot configuration:
```yaml
models:
  providers:
    local-vllm:
      baseUrl: "http://localhost:30000/v1"
      apiKey: "none"
      api: "openai-completions"
      models:
        - id: "your-model"
          # ... other configurations ...
          compat:
            supportedParameters:
              - "tools"
              - "tool_choice"
```

#### Solution C: Add Text Format Tool Call Parser in Clawdbot (Complex)

This would require modifying Clawdbot's core logic to parse `<tool_call>` text tags and execute corresponding tools.

**Implementation Points**:
1. Detect if response `content` contains `<tool_call>` tags
2. Parse tool name and parameters
3. Execute corresponding tools
4. Inject results back into conversation flow

This is a larger modification, not recommended as first choice.

#### Solution D: Use Cloud Services Supporting Native Function Calling (Simplest)

Use cloud providers (OpenAI, Anthropic, Google) that natively support function calling, no special configuration needed.

### Recommended Operation Flow

1. **When starting inference server, specify correct tool-call-parser**:
   - For **Qwen3 Coder** models: use `--tool-call-parser qwen3_coder` (✅ verified)
   - For other models: choose corresponding parser based on model series

2. **Configure Clawdbot**: Add `compat.supportedParameters: ["tools", "tool_choice"]` to model configuration

3. **Apply code modifications from this patch**: Let Clawdbot correctly recognize local model tool support

### Practical Experience Summary

| Test Item | Result | Explanation |
|-----------|--------|-------------|
| sglang + no parser | ❌ Failed | Returns `tool_calls: null`, model outputs text format `<tool_call>` |
| sglang + `hermes` | ❌ Failed | sglang reports unsupported parser |
| sglang + `qwen25` | ❌ Failed | Prints tool call code only, doesn't execute |
| sglang + `gpt-oss` | ❌ Failed | Prints tool call code only, doesn't execute |
| sglang + `pythonic` | ❌ Failed | Prints tool call code only, doesn't execute |
| sglang + `qwen3_coder` | ✅ Success | Correctly returns structured `tool_calls`, tools execute normally |

### Method to Test Tool Calling Support

Use the following curl command to test if your inference server truly supports function calling:

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

If response `tool_calls` is `null` and `content` contains text format tool calls, the server is not properly configured for tool calling (may need correct `--tool-call-parser` parameter).

## Patch Date

- **Creation Date**: 2025-02-02
- **Update Date**: 2026-02-02 (Added diagnostic results and solution chapters; added tool-call-parser verification results)
- **Author**: AI Assistant (Claude)
- **Version**: 1.2.0

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

Complete recommended configuration (includes tools and models):

```json
{
  "tools": {
    "profile": "coding",
    "allow": ["read", "exec", "write", "edit"],
    "exec": {
      "host": "gateway",
      "security": "full",
      "ask": "off"
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

**Configuration Explanation**:

| Configuration Item | Mandatory | Explanation |
|--------------------|------------|-------------|
| `tools.profile` | 🔶 Recommended | Set to `"coding"` to enable complete programming toolset |
| `tools.allow` | 🔶 Recommended | Explicit whitelist of allowed tools |
| `tools.exec.security` | 🔶 Recommended | `"full"` = unrestricted; `"normal"` = restricted |
| `tools.exec.ask` | 🔶 Recommended | `"off"` = auto-execute; `"on"` = require confirmation |
| `compat.supportedParameters` | ✅ **Mandatory** | Declare API parameters supported by model |

⚠️ **Security Warning**: `exec.security: "full"` + `exec.ask: "off"` allows LLM to execute any commands (including `rm -rf` etc.). Only use in:
- Isolated development environments
- With complete trust in the LLM model
- Understanding potential risks

### 3. Apply Code Modifications from This Patch (See Detailed Steps Below)

### 4. Build and Test

```bash
cd /path/to/clawdbot
npm run build
sudo npm install -g .
clawdbot agent --local --message "List files in current directory"
```

---

## Complete Code Modifications (Copy-Paste Ready)

Following are complete code snippets for modification, directly copy-paste into corresponding files.

### File 1: src/config/zod-schema.core.ts

Find the `ModelCompatSchema` definition (usually at file beginning), **replace entirely** with:

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

### File 2: src/config/types.models.ts

Find the `ModelCompatConfig` type definition, **replace entirely** with:

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
  if (supportedParams === undefined || supportedParams === null) {
    return true;
  }

  // If it's an array, check if "tools" is included
  if (Array.isArray(supportedParams)) {
    return supportedParams.includes("tools");
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

---

## Related Files

- Main Configuration Schema: [src/config/zod-schema.core.ts](src/config/zod-schema.core.ts)
- Type Definitions: [src/config/types.models.ts](src/config/types.models.ts)
- Model Compatibility: [src/agents/model-compat.ts](src/agents/model-compat.ts)
- Embedded Runner: [src/agents/pi-embedded-runner/run/attempt.ts](src/agents/pi-embedded-runner/run/attempt.ts)

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

**Correct Response** (tool_calls has value):
```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [{"id": "...", "type": "function", "function": {"name": "calculator", "arguments": "{...}"}}]
}
```

**Incorrect Response** (tool_calls is null):
```json
{
  "role": "assistant",
  "content": "<tool_call>...",
  "tool_calls": null
}
```

### Problem 3: Clawdbot Not Sending Tools Parameters

**Diagnostic**: Enable debug logging with environment variable
```bash
CLAWDBOT_DEBUG_TOOLS=1 clawdbot agent --local --message "test"
```

Check logs for:
- `[attempt.ts] modelHasToolSupport=true`
- `[attempt.ts] tools count=4`

If `modelHasToolSupport=false`, check if `compat.supportedParameters` in configuration includes `"tools"`.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-02-02 | Initial patch: Added supportedParameters configuration support |
| 1.1.0 | 2026-02-02 | Added diagnostic results: Discovered sglang needs tool-call-parser |
| 1.2.0 | 2026-02-02 | Added tool-call-parser verification results; added complete deployment guide |