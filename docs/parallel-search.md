# Optional web research with Parallel Search MCP

Use [Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp)
to search the web and extract page excerpts without a Parallel account or API
key. Anonymous searches use Fast mode and have service rate limits.

This is a terminal workflow using MCPorter, the MCP command-line client included
as a [skill in the linked Clawdbot fork](https://github.com/jokelord/local-model-tool-calling/blob/3d95195ed298c2f3671cf40da5393332f2cc19c3/skills/mcporter/SKILL.md).
It is useful for checking current inference-server documentation before asking
your local model to explain or apply it. It does not register a new Clawdbot
`web_search` provider: keep your existing DuckDuckGo, Brave, or Perplexity settings.

## Set up MCPorter

Use Node.js 24 or newer and npm. Install the version used in this guide:

```bash
npm install --global mcporter@0.15.0
mcporter --version
```

Save the following as a **new** `parallel-search.json` file in your working
directory. Keep it separate from `~/.clawdbot/clawdbot.json` and any existing
MCPorter configuration:

```json
{
  "imports": [],
  "mcpServers": {
    "parallel-search": {
      "baseUrl": "https://search.parallel.ai/mcp",
      "headers": {
        "User-Agent": "openclaw-local-model-tool-calling-patch/parallel-search-guide"
      }
    }
  }
}
```

The explicit config path and empty import list keep this workflow independent
of other MCP server definitions. The endpoint uses Streamable HTTP; MCPorter
handles the protocol. There is no API key or OAuth setup for this configuration.

## Search, inspect, then fetch

Discover the current tool schemas first:

```bash
mcporter --config ./parallel-search.json list parallel-search --schema
```

Search for the parser documentation relevant to this patch:

```bash
mcporter --config ./parallel-search.json call parallel-search.web_search \
  --args '{"objective":"Find official SGLang documentation for the Qwen3 Coder tool-call parser.","search_queries":["SGLang Qwen3 Coder tool parser"]}' \
  --output json --timeout 60000
```

Inspect the returned URLs and excerpts. Fetch a relevant page for more context;
this example uses SGLang's function-calling documentation:

```bash
mcporter --config ./parallel-search.json call parallel-search.web_fetch \
  --args '{"urls":["https://docs.sglang.io/docs/advanced_features/tool_parser"],"objective":"Find Qwen3 Coder parser setup instructions.","search_queries":["SGLang Qwen3 Coder tool parser"]}' \
  --output json --timeout 60000
```

Pass the relevant excerpts and source URLs to your local-model conversation, for
example: “Using these sources, explain which parser matches my Qwen3 Coder model
and which launch flags I should check.” Treat fetched text as reference material;
review any proposed commands before running them. These terminal commands do not
require a running inference server. Automatic tool dispatch by a local model is
outside this walkthrough.

## Troubleshooting and removal

- If `mcporter` is missing, check the npm global binary directory is on `PATH`.
  Run `node --version` to confirm Node.js 24 or newer.
- If discovery fails, check connectivity to `https://search.parallel.ai/mcp`.
  Run the commands in the directory containing `parallel-search.json`, or pass
  its absolute path with `--config`.
- If your network requires an HTTP proxy, set `HTTP_PROXY` or `HTTPS_PROXY` in
  the shell running MCPorter and set `NODE_USE_ENV_PROXY=1` so Node.js uses it.
- A successful connection is not a successful search. Inspect tool output for
  errors, including rate limits; if limited, wait for the indicated retry time.
- To stop using this workflow, remove the new `parallel-search.json` file.
  Existing Clawdbot search settings are unchanged. If MCPorter was installed only
  for this guide, it can be removed with `npm uninstall --global mcporter`.

See the [MCPorter configuration guide](https://github.com/openclaw/mcporter/blob/main/docs/config.md)
for config precedence and the [Parallel Search MCP guide](https://docs.parallel.ai/integrations/mcp/search-mcp)
for current tool parameters and service limits.
