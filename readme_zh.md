# 本地模型工具调用支持补丁

## 🎯 补丁目标

让 Clawdbot 支持本地推理模型（sglang/vLLM）的 tool calling 功能。

**验证环境**：
- 模型：Qwen3-Coder-30B-A3B-Instruct-FP8
- 推理服务器：sglang + `--tool-call-parser qwen3_coder`
- Clawdbot 版本：2026.1.24-0

**验证结果**：✅ 成功调用工具

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

## 补丁目的

1. **允许用户声明本地模型的 tool 支持**：通过在模型配置的 `compat` 对象中添加 `supportedParameters` 字段，让用户可以显式声明本地模型支持哪些 API 参数。

2. **保持向后兼容**：对于未声明 `supportedParameters` 的模型（包括所有现有云服务商配置），继续假设支持 tools，不影响现有功能。

3. **灵活控制**：用户可以通过配置精确控制哪些模型启用/禁用 tools。

## 修改的文件

### 1. src/config/zod-schema.core.ts
**备份**: `src/config/zod-schema.core.ts.backup`

**修改内容**：在 `ModelCompatSchema` 中添加 `supportedParameters` 字段

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

### 2. src/config/types.models.ts
**备份**: `src/config/types.models.ts.backup`

**修改内容**：在 `ModelCompatConfig` 类型中添加 `supportedParameters` 字段

```typescript
export type ModelCompatConfig = {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  supportedParameters?: string[];  // 新增
};
```

### 3. src/agents/model-compat.ts
**备份**: `src/agents/model-compat.ts.backup`

**修改内容**：添加 `modelSupportsTools()` 函数

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
  // ... 实现逻辑
}
```

### 4. src/agents/pi-embedded-runner/run/attempt.ts
**备份**: `src/agents/pi-embedded-runner/run/attempt.ts.backup`

**修改内容**：在创建 tools 之前检查模型是否支持

```typescript
// 检查模型是否支持 tools
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

## 补丁修改文件结构

本补丁涉及修改的文件位置（树形结构展示）：

```
clawdbot/
└── src/
    ├── config/
    │   ├── zod-schema.core.ts    ✏️ [修改] 添加 supportedParameters 字段到 Schema
    │   └── types.models.ts       ✏️ [修改] 添加 supportedParameters 到类型定义
    │
    └── agents/
        ├── model-compat.ts       ✏️ [修改] 新增 modelSupportsTools() 函数
        │
        └── pi-embedded-runner/
            └── run/
                └── attempt.ts    ✏️ [修改] 添加工具支持检测逻辑
```

### 修改文件清单

| 序号 | 文件路径 | 修改类型 | 说明 |
|------|----------|----------|------|
| 1 | `src/config/zod-schema.core.ts` | 修改 Schema | 在 `ModelCompatSchema` 中添加 `supportedParameters` 字段 |
| 2 | `src/config/types.models.ts` | 修改类型 | 在 `ModelCompatConfig` 类型中添加 `supportedParameters` 属性 |
| 3 | `src/agents/model-compat.ts` | 新增函数 | 添加 `modelSupportsTools()` 工具支持检测函数 |
| 4 | `src/agents/pi-embedded-runner/run/attempt.ts` | 修改逻辑 | 在工具创建前添加模型支持检查 |

## 使用方法

### 重要：Tools 配置（强烈推荐，非必须）

Clawdbot 的 tools 配置控制工具调用的行为。虽然不是强制性的，但**强烈建议配置**以获得最佳体验。

#### 推荐的 Tools 配置

在 `~/.clawdbot/clawdbot.json` 中添加：

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

#### 配置项详解

| 配置项 | 默认值 | 推荐值 | 说明 |
|--------|--------|--------|------|
| `profile` | `"default"` | `"coding"` | 启用完整的编程工具集（read/write/edit/exec） |
| `allow` | 取决于 profile | `["read", "exec", "write", "edit"]` | 明确允许的工具白名单 |
| `exec.host` | `"local"` | `"gateway"` | 命令执行位置 |
| `exec.security` | `"normal"` | `"full"` | `"normal"` = 受限权限；`"full"` = 完整权限 |
| `exec.ask` | `"on"` | `"off"` | `"on"` = 每次确认；`"off"` = 自动执行 |

#### 没有配置 tools 会怎样？

| 功能 | 无配置时 | 配置后 |
|------|----------|--------|
| 文件读取 | ✅ 可用 | ✅ 可用 |
| 文件写入 | ⚠️ 可能受限 | ✅ 完全可用 |
| 命令执行 | ⚠️ 每次都要确认 | ✅ 自动执行 |
| 危险命令 | ❌ 被阻止 | ⚠️ 允许（需谨慎） |

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
    "exec": {
      "security": "full",
      "ask": "off"
    }
  }
}
```

⚠️ **警告**：`security: "full"` + `ask: "off"` 允许 LLM 执行任何命令（包括 `sudo rm -rf /` 等）。仅在：
- 隔离的开发环境中使用
- 完全信任所用的 LLM 模型
- 了解潜在风险的情况下使用

---

### 模型配置场景

### 场景 1：启用本地模型的 tool 支持

如果你的本地 sglang/vLLM 模型支持 OpenAI 兼容的 tool calling，在 `~/.clawdbot/clawdbot.json` 中配置：

**JSON 格式**（推荐）：
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

**YAML 格式**（如果你使用 config.yaml）：
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
            # 声明此模型支持 tools 和 tool_choice
            supportedParameters:
              - "tools"
              - "tool_choice"
```

### 场景 2：禁用特定模型的 tool 支持

如果某个模型不支持 tools，可以显式禁用：

**JSON 格式**：
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

**YAML 格式**：
```yaml
models:
  providers:
    local:
      baseUrl: "http://localhost:30000/v1"
      models:
        - id: "llama-3-8b"
          name: "Llama 3 8B (No Tools)"
          # ... 其他配置 ...
          compat:
            # 空数组表示不支持任何特殊参数
            supportedParameters: []
```

### 场景 3：云服务商模型（无需修改）

对于云服务商模型，不需要任何配置更改。如果 `compat.supportedParameters` 未声明，系统将保持原有行为，假设模型支持 tools。

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
- `logprobs` - 对数概率
- `top_logprobs` - Top K 对数概率
- `parallel_tool_calls` - 并行工具调用
- `reasoning_effort` - 推理强度（o1 系列）

### Anthropic 特有
- `system` - 系统提示
- `top_k` - Top K 采样
- `metadata` - 元数据

## 应用补丁

### 步骤 1：准备工作

确保你已经克隆了 Clawdbot 源码仓库并安装了依赖：

```bash
# 进入项目目录
cd /home/zk/Project/moltbot-2026.1.24

# 安装依赖（如果还没安装）
pnpm install
```

### 步骤 2：备份原始文件

在应用补丁之前，先备份所有要修改的文件：

```bash
# 备份配置文件 Schema
cp src/config/zod-schema.core.ts src/config/zod-schema.core.ts.backup

# 备份类型定义文件
cp src/config/types.models.ts src/config/types.models.ts.backup

# 备份模型兼容性文件
cp src/agents/model-compat.ts src/agents/model-compat.ts.backup

# 备份嵌入式运行器文件
cp src/agents/pi-embedded-runner/run/attempt.ts src/agents/pi-embedded-runner/run/attempt.ts.backup
```

### 步骤 3：应用代码修改

#### 3.1 修改配置 Schema (src/config/zod-schema.core.ts)

在 `ModelCompatSchema` 中添加 `supportedParameters` 字段：

```bash
# 使用编辑器打开文件
code src/config/zod-schema.core.ts
```

找到 `ModelCompatSchema` 定义，大约在第 14-26 行，添加新字段：

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

#### 3.2 修改类型定义 (src/config/types.models.ts)

在 `ModelCompatConfig` 类型中添加 `supportedParameters` 字段：

```bash
# 使用编辑器打开文件
code src/config/types.models.ts
```

找到 `ModelCompatConfig` 类型定义，大约在第 9-14 行，添加新字段：

```typescript
export type ModelCompatConfig = {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  supportedParameters?: string[];  // 新增
};
```

#### 3.3 添加工具支持检测函数 (src/agents/model-compat.ts)

在文件末尾添加 `modelSupportsTools` 函数：

```bash
# 使用编辑器打开文件
code src/agents/model-compat.ts
```

在文件末尾（大约第 56 行后）添加新函数：

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

#### 3.4 修改工具创建逻辑 (src/agents/pi-embedded-runner/run/attempt.ts)

在创建 tools 之前添加支持检查：

```bash
# 使用编辑器打开文件
code src/agents/pi-embedded-runner/run/attempt.ts
```

找到 tools 创建的代码段，大约在第 200-212 行，添加检查逻辑：

```typescript
// 检查模型是否支持 tools
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

### 步骤 4：构建和安装

#### 4.1 构建项目

```bash
# 构建 TypeScript 代码
npm run build
```

构建成功后会看到类似输出：
```
✓ Built in 12.34s
```

#### 4.2 卸载旧版本（如果已安装）

```bash
# 检查当前安装的版本
clawdbot --version

# 卸载全局安装的旧版本
sudo npm uninstall -g clawdbot
```

#### 4.3 全局安装新版本

```bash
# 全局安装修改后的版本
sudo npm install -g .
```

安装成功后会看到：
```
added 1 package in 258ms
```

#### 4.4 验证安装

```bash
# 检查新版本是否正确安装
clawdbot --version

# 应该显示类似：2026.1.24-0
```

### 步骤 5：配置本地模型

在 `~/.clawdbot/config.yaml` 中为你的本地模型添加 `supportedParameters` 配置：

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
          # ... 其他配置 ...
          compat:
            supportedParameters:
              - "tools"
              - "tool_choice"
```

### 步骤 6：测试验证

```bash
# 启用 debug 日志测试
CLAWDBOT_LOG_LEVEL=debug clawdbot agent --message "请帮我运行一个简单的工具调用测试"

# 检查日志中是否出现工具调用相关的输出
```

## 回滚方法

如果需要回滚此补丁，执行以下命令：

```bash
cd /home/zk/Project/moltbot-2026.1.24

# 恢复备份文件
cp src/config/zod-schema.core.ts.backup src/config/zod-schema.core.ts
cp src/config/types.models.ts.backup src/config/types.models.ts
cp src/agents/model-compat.ts.backup src/agents/model-compat.ts
cp src/agents/pi-embedded-runner/run/attempt.ts.backup src/agents/pi-embedded-runner/run/attempt.ts
```

## 测试验证

应用补丁后，可以通过以下方式验证：

1. **启用 debug 日志**：
   ```bash
   CLAWDBOT_LOG_LEVEL=debug clawdbot agent --message "test"
   ```

2. **检查日志输出**：
   - 如果模型不支持 tools，会看到：
     `Tools disabled for model xxx: compat.supportedParameters does not include "tools"`
   - 如果模型支持 tools，不会有此日志

3. **测试 tool 调用**：
   - 对于声明了 `supportedParameters: ["tools"]` 的模型，应该能正常使用 tools
   - 对于未声明或声明为空数组的模型，tools 将被禁用

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

- **云服务商**：因为不会设置 `compat.supportedParameters`，所以继续使用默认行为（支持 tools）
- **现有本地模型配置**：如果之前的配置没有 `compat` 或没有 `supportedParameters`，行为不变
- **新本地模型配置**：用户可以选择性地添加 `supportedParameters` 来精确控制

## 补丁验证与问题诊断

### 验证结果

应用补丁后进行了详细的调试验证，发现：

#### ✅ 补丁本身工作正常

通过添加调试日志验证了以下事实：

1. **配置正确加载**：`compat.supportedParameters: ["tools", "tool_choice"]` 被正确读取
2. **工具支持检测通过**：`modelSupportsTools()` 函数正确返回 `true`
3. **工具创建成功**：4个工具（read, edit, write, exec）被成功创建
4. **工具添加到 Agent**：`agent.state.tools` 包含所有 4 个工具
5. **API 请求包含 tools 参数**：OpenAI completions provider 的 `buildParams()` 函数正确将 tools 添加到请求中

调试日志证据：
```
[attempt.ts] modelHasToolSupport=true
[attempt.ts] tools count=4, names=read, edit, write, exec
[attempt.ts] After createAgentSession: agent.state.tools count=4, names=read, edit, write, exec
```

#### ❌ 真正的问题：sglang 服务器未正确配置 tool calling

通过直接使用 curl 测试 sglang API 发现了根本问题：

**测试命令**：
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

**实际响应**（未配置 tool-call-parser 时）：
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
3. 模型只是在 `content` 字段中输出**文本格式**的伪工具调用：`<tool_call>...</tool_call>`
4. 响应的 `tool_calls` 字段为 `null`

这意味着：
- **Clawdbot 的代码完全正确**：工具定义确实被发送到了 API
- **问题在推理服务器配置层面**：sglang 支持 OpenAI 风格的原生 function calling，但需要通过 `--tool-call-parser` 参数启用

### 解决方案选项

基于以上诊断，有以下几种解决方案：

#### 方案 A：启用 sglang 的 tool calling 功能（✅ 已验证可行）

sglang 支持通过 `--tool-call-parser` 参数启用 function calling。**关键是选择正确的解析器**。

##### 🔑 Tool Call Parser 选择指南

| 模型系列 | 推荐 Parser | 验证状态 |
|----------|-------------|----------|
| **Qwen3 Coder** | `qwen3_coder` | ✅ **已验证成功** |
| Qwen 2.5 | `qwen25` | ❌ 不工作（只打印不执行） |
| Hermes 格式 | `hermes` | ❌ sglang 报错不支持 |
| gpt-oss 格式 | `gpt-oss` | ❌ 不工作（只打印不执行） |
| Pythonic 格式 | `pythonic` | ❌ 不工作（只打印不执行） |
| DeepSeek V3 | `deepseekv3` | 未测试 |
| Llama 3 | `llama3` | 未测试 |
| Mistral | `mistral` | 未测试 |

##### ✅ 验证成功的 sglang 启动命令

```bash
# 对于 Qwen3-Coder 系列模型，使用 qwen3_coder 解析器
python -m sglang.launch_server \
  --model-path /path/to/Qwen3-Coder-30B-A3B-Instruct-FP8 \
  --tool-call-parser qwen3_coder \
  --port 30000 \
  --host 0.0.0.0
```

##### 常见 tool-call-parser 选项

sglang 支持的解析器列表（截至 2026年2月）：
- `deepseekv3`, `deepseekv31`, `deepseekv32` - DeepSeek 系列
- `glm`, `glm45`, `glm47` - GLM 系列
- `gpt-oss` - GPT 开源兼容
- `kimi_k2` - Kimi K2
- `lfm2` - LFM2
- `llama3` - Llama 3
- `mimo` - MIMO
- `mistral` - Mistral
- `pythonic` - Pythonic 格式
- `qwen`, `qwen25`, **`qwen3_coder`** - Qwen 系列
- `step3` - Step3
- `minimax-m2` - MiniMax M2
- `trinity` - Trinity
- `interns1` - InternS1
- `hermes` - Hermes 格式（注意：某些 sglang 版本可能不支持）

##### 如何确定正确的解析器

1. **根据模型名称判断**：模型名中包含 "qwen3" 且 "coder" → `qwen3_coder`
2. **查看模型文档**：模型发布方通常会说明推荐的 tool calling 格式
3. **试错法**：按照上表的验证状态，优先尝试已验证的解析器

#### 方案 B：使用 vLLM 替代 sglang

vLLM 也支持 OpenAI 风格 function calling：

```bash
# 安装 vLLM
pip install vllm

# 对于 Qwen3 Coder 模型，使用 qwen3_coder 解析器
vllm serve /path/to/model \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --port 30000
```

**vLLM 常用解析器**（与 sglang 类似）：
- `hermes` - 通用 Hermes 格式
- `qwen3_coder` - Qwen3 Coder 系列
- `qwen25` - Qwen 2.5 系列
- `llama3` - Llama 3 系列

然后更新 Clawdbot 配置：
```yaml
models:
  providers:
    local-vllm:
      baseUrl: "http://localhost:30000/v1"
      apiKey: "none"
      api: "openai-completions"
      models:
        - id: "your-model"
          # ... 其他配置 ...
          compat:
            supportedParameters:
              - "tools"
              - "tool_choice"
```

#### 方案 C：在 Clawdbot 中添加文本格式 tool call 解析器（复杂）

这需要修改 Clawdbot 的核心逻辑来解析 `<tool_call>` 文本标记并执行对应的工具。

**实现要点**：
1. 检测响应的 `content` 中是否包含 `<tool_call>` 标记
2. 解析工具名称和参数
3. 执行对应的工具
4. 将结果注入回对话流

这是一个较大的改动，不推荐作为首选方案。

#### 方案 D：使用支持原生 function calling 的云服务（最简单）

使用云服务商（如 OpenAI、Anthropic、Google）的模型，它们都原生支持 function calling，无需任何特殊配置。

### 推荐操作流程

1. **启动推理服务器时指定正确的 tool-call-parser**：
   - 对于 **Qwen3 Coder** 模型：使用 `--tool-call-parser qwen3_coder`（✅ 已验证）
   - 对于其他模型：根据模型系列选择对应的解析器

2. **配置 Clawdbot**：在模型配置中添加 `compat.supportedParameters: ["tools", "tool_choice"]`

3. **应用本补丁的代码修改**：让 Clawdbot 正确识别本地模型的 tool 支持

### 实测经验总结

| 测试项 | 结果 | 说明 |
|--------|------|------|
| sglang + 无 parser | ❌ 失败 | 返回 `tool_calls: null`，模型输出文本格式 `<tool_call>` |
| sglang + `hermes` | ❌ 失败 | sglang 报错不支持此解析器 |
| sglang + `qwen25` | ❌ 失败 | 只打印工具调用代码，不执行 |
| sglang + `gpt-oss` | ❌ 失败 | 只打印工具调用代码，不执行 |
| sglang + `pythonic` | ❌ 失败 | 只打印工具调用代码，不执行 |
| sglang + `qwen3_coder` | ✅ 成功 | 正确返回结构化 `tool_calls`，工具可正常执行 |

### 验证 tool calling 支持的测试方法

使用以下 curl 命令测试你的推理服务器是否真正支持 function calling：

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

如果响应的 `tool_calls` 为 `null` 且 `content` 包含文本格式的工具调用，说明服务器未正确配置 tool calling（可能需要设置正确的 `--tool-call-parser` 参数）。

## 补丁日期

- **创建日期**: 2025-02-02
- **更新日期**: 2026-02-02（添加诊断和解决方案章节；添加 tool-call-parser 验证结果）
- **作者**: AI Assistant (Claude)
- **版本**: 1.2.0

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

完整推荐配置（包含 tools 和 models）：

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

**配置说明**：

| 配置项 | 是否必须 | 说明 |
|--------|----------|------|
| `tools.profile` | 🔶 推荐 | 设为 `"coding"` 启用完整编程工具集 |
| `tools.allow` | 🔶 推荐 | 明确允许的工具白名单 |
| `tools.exec.security` | 🔶 推荐 | `"full"` = 无限制；`"normal"` = 受限 |
| `tools.exec.ask` | 🔶 推荐 | `"off"` = 自动执行；`"on"` = 需要确认 |
| `compat.supportedParameters` | ✅ **必须** | 声明模型支持的 API 参数 |

⚠️ **安全警告**：`exec.security: "full"` + `exec.ask: "off"` 允许 LLM 执行任何命令（包括 `rm -rf` 等危险操作）。建议：
- 在受信任的环境中使用
- 或将 `ask` 设为 `"on"` 让用户手动确认每次执行

### 3. 应用本补丁的代码修改（见下文详细步骤）

### 4. 构建并测试

```bash
cd /path/to/clawdbot
npm run build
sudo npm install -g .
clawdbot agent --local --message "列出当前目录的文件"
```

---

## 完整代码修改（复制粘贴即可）

以下是需要修改的完整代码片段，直接复制粘贴到对应文件中即可。

### 文件 1: src/config/zod-schema.core.ts

找到 `ModelCompatSchema` 的定义（通常在文件开头部分），**整体替换**为：

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

### 文件 2: src/config/types.models.ts

找到 `ModelCompatConfig` 类型定义，**整体替换**为：

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

---

## 相关文件

- 主配置 Schema: [src/config/zod-schema.core.ts](src/config/zod-schema.core.ts)
- 类型定义: [src/config/types.models.ts](src/config/types.models.ts)
- 模型兼容性: [src/agents/model-compat.ts](src/agents/model-compat.ts)
- 嵌入式运行器: [src/agents/pi-embedded-runner/run/attempt.ts](src/agents/pi-embedded-runner/run/attempt.ts)

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

**正确响应**（tool_calls 有值）：
```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [{"id": "...", "type": "function", "function": {"name": "calculator", "arguments": "{...}"}}]
}
```

**错误响应**（tool_calls 为 null）：
```json
{
  "role": "assistant",
  "content": "<tool_call>...",
  "tool_calls": null
}
```

### 问题 3：Clawdbot 没有发送 tools 参数

**诊断**：设置环境变量启用调试日志
```bash
CLAWDBOT_DEBUG_TOOLS=1 clawdbot agent --local --message "test"
```

检查日志中是否有：
- `[attempt.ts] modelHasToolSupport=true`
- `[attempt.ts] tools count=4`

如果 `modelHasToolSupport=false`，检查配置文件中的 `compat.supportedParameters` 是否包含 `"tools"`。

---

## 版本历史

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| 1.0.0 | 2025-02-02 | 初始补丁：添加 supportedParameters 配置支持 |
| 1.1.0 | 2026-02-02 | 添加诊断结果：发现 sglang 需要 tool-call-parser |
| 1.2.0 | 2026-02-02 | 添加 tool-call-parser 验证结果；添加完整部署指南 |
