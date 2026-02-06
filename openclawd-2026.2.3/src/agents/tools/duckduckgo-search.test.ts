/**
 * DuckDuckGo Web Search Integration Test
 *
 * Tests the DuckDuckGo search functionality using curl implementation.
 * This is a live test that requires network access.
 *
 * Run with: CLAWDBOT_LIVE_TEST=1 pnpm vitest run test/duckduckgo-search.test.ts
 */

import { execFileSync } from "node:child_process";
import { describe, expect, it, beforeAll } from "vitest";

const DUCKDUCKGO_HTML_ENDPOINT = "https://html.duckduckgo.com/html/";

// Skip tests if not in live test mode
const isLiveTest = process.env.CLAWDBOT_LIVE_TEST === "1" || process.env.LIVE === "1";

type DuckDuckGoSearchResult = {
  title: string;
  url: string;
  description: string;
  siteName?: string;
};

/**
 * Parse DuckDuckGo HTML search results.
 * Copied from src/agents/tools/web-search.ts for standalone testing.
 */
function parseDuckDuckGoHtml(html: string): DuckDuckGoSearchResult[] {
  const results: DuckDuckGoSearchResult[] = [];

  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/gi;

  const links: { url: string; title: string }[] = [];
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    let url = match[1] ?? "";
    const title = (match[2] ?? "").trim();

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
      siteName: (() => {
        try {
          return new URL(link.url).hostname;
        } catch {
          return undefined;
        }
      })(),
    });
  }

  return results;
}

/**
 * Run DuckDuckGo search using curl.
 * Returns { results, blocked } where blocked=true if CAPTCHA was triggered.
 */
function runDuckDuckGoSearch(
  query: string,
  timeoutSeconds = 30
): { results: DuckDuckGoSearchResult[]; blocked: boolean } {
  const curlArgs = [
    "-s",
    "--max-time",
    String(timeoutSeconds),
    "-X",
    "POST",
    "-H",
    "Content-Type: application/x-www-form-urlencoded",
    "-H",
    "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "-H",
    "Accept: text/html",
    "-d",
    `q=${encodeURIComponent(query)}`,
    DUCKDUCKGO_HTML_ENDPOINT,
  ];

  const html = execFileSync("curl", curlArgs, {
    encoding: "utf-8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: timeoutSeconds * 1000,
  });

  // Check if DuckDuckGo returned a CAPTCHA challenge
  const blocked =
    html.includes("bots use DuckDuckGo") ||
    html.includes("anomaly-modal") ||
    html.includes("challenge-form");

  return { results: parseDuckDuckGoHtml(html), blocked };
}

describe.skipIf(!isLiveTest)("DuckDuckGo Search (Live)", () => {
  beforeAll(() => {
    console.log("🔍 Running DuckDuckGo live search tests...");
    console.log(`   Proxy: ${process.env.https_proxy || process.env.http_proxy || "none"}`);
  });

  it("should search for '现在北京时间' and return results", () => {
    const query = "现在北京时间";
    console.log(`\n📝 Searching: "${query}"`);

    const { results, blocked } = runDuckDuckGoSearch(query);

    if (blocked) {
      console.log("⚠️ DuckDuckGo CAPTCHA triggered (blocked) - skipping validation");
      // Skip test when CAPTCHA is triggered (common with proxy IPs)
      return;
    }

    console.log(`✅ Found ${results.length} results`);
    results.slice(0, 5).forEach((r: DuckDuckGoSearchResult, i: number) => {
      console.log(`   ${i + 1}. ${r.title}`);
      console.log(`      URL: ${r.url}`);
      console.log(`      ${r.description.slice(0, 100)}...`);
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("title");
    expect(results[0]).toHaveProperty("url");
    expect(results[0]?.url).toMatch(/^https?:\/\//);
  });

  it("should search for English query 'Beijing current time'", () => {
    const query = "Beijing current time";
    console.log(`\n📝 Searching: "${query}"`);

    const { results, blocked } = runDuckDuckGoSearch(query);

    if (blocked) {
      console.log("⚠️ DuckDuckGo CAPTCHA triggered (blocked) - skipping validation");
      return;
    }

    console.log(`✅ Found ${results.length} results`);
    results.slice(0, 3).forEach((r: DuckDuckGoSearchResult, i: number) => {
      console.log(`   ${i + 1}. ${r.title} - ${r.siteName}`);
    });

    expect(results.length).toBeGreaterThan(0);
  });

  it("should handle special characters in query", () => {
    const query = "C++ programming tutorial 2024";
    console.log(`\n📝 Searching: "${query}"`);

    const { results, blocked } = runDuckDuckGoSearch(query);

    if (blocked) {
      console.log("⚠️ DuckDuckGo CAPTCHA triggered (blocked) - skipping validation");
      return;
    }

    console.log(`✅ Found ${results.length} results`);

    expect(results.length).toBeGreaterThan(0);
  });

  it("should extract site names from URLs", () => {
    const query = "GitHub";
    console.log(`\n📝 Searching: "${query}"`);

    const { results, blocked } = runDuckDuckGoSearch(query);

    if (blocked) {
      console.log("⚠️ DuckDuckGo CAPTCHA triggered (blocked) - skipping validation");
      return;
    }

    // First ensure we got results
    expect(results.length).toBeGreaterThan(0);

    const withSiteName = results.filter((r: DuckDuckGoSearchResult) => r.siteName);
    console.log(`✅ ${withSiteName.length}/${results.length} results have siteName`);

    // siteName should be extracted from URL hostname
    if (withSiteName.length > 0) {
      // At least one should contain common domain patterns
      const hasValidSiteName = withSiteName.some(
        (r: DuckDuckGoSearchResult) =>
          r.siteName && (r.siteName.includes(".com") || r.siteName.includes(".org") || r.siteName.includes(".io"))
      );
      expect(hasValidSiteName).toBe(true);
    }
  });
});

describe("DuckDuckGo HTML Parser (Unit)", () => {
  it("should parse result links correctly", () => {
    const html = `
      <a rel="nofollow" class="result__a" href="https://example.com/page">Example Title</a>
      <a class="result__snippet" href="#">This is the description snippet</a>
    `;

    const results = parseDuckDuckGoHtml(html);

    expect(results.length).toBe(1);
    expect(results[0]?.title).toBe("Example Title");
    expect(results[0]?.url).toBe("https://example.com/page");
    expect(results[0]?.description).toBe("This is the description snippet");
    expect(results[0]?.siteName).toBe("example.com");
  });

  it("should decode uddg redirect URLs", () => {
    const encodedUrl = encodeURIComponent("https://real-site.com/path?q=test");
    const html = `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=${encodedUrl}&rut=abc">Real Site</a>
      <a class="result__snippet">Description</a>
    `;

    const results = parseDuckDuckGoHtml(html);

    expect(results.length).toBe(1);
    expect(results[0]?.url).toBe("https://real-site.com/path?q=test");
  });

  it("should handle multiple results", () => {
    const html = `
      <a class="result__a" href="https://site1.com">Site 1</a>
      <a class="result__snippet">Desc 1</a>
      <a class="result__a" href="https://site2.com">Site 2</a>
      <a class="result__snippet">Desc 2</a>
      <a class="result__a" href="https://site3.com">Site 3</a>
      <a class="result__snippet">Desc 3</a>
    `;

    const results = parseDuckDuckGoHtml(html);

    expect(results.length).toBe(3);
    expect(results.map((r) => r.title)).toEqual(["Site 1", "Site 2", "Site 3"]);
  });

  it("should skip invalid URLs", () => {
    const html = `
      <a class="result__a" href="javascript:void(0)">Invalid</a>
      <a class="result__a" href="https://valid.com">Valid</a>
      <a class="result__snippet">Desc</a>
    `;

    const results = parseDuckDuckGoHtml(html);

    expect(results.length).toBe(1);
    expect(results[0]?.url).toBe("https://valid.com");
  });
});
