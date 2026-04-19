import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chatWithTools,
  logResponse,
  type ChatWithToolsParams,
  type ToolDefinition,
} from "shared";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const postsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../articles");

const ssrFiles = [
  // "40:initial-load-performance.mdx",
  // "41:client-side-rendering-flame-graph.mdx",
  // "42:ssr-deep-dive-for-react-developers.mdx",
  "46:react-server-components-performance.mdx",
  // "48:server-actions-for-data-fetching.mdx",
];

const allArticles = ssrFiles
  .map((f) => readFileSync(join(postsDir, f), "utf-8"))
  .join("\n\n---\n\n");

console.log(bold("\n📚 Loading articles into context\n"));
for (const f of ssrFiles) {
  const content = readFileSync(join(postsDir, f), "utf-8");
  const title = f.replace(/^\d+:/, "").replace(/\.mdx$/, "").replace(/-/g, " ");
  console.log(`  ${cyan("•")} ${title} ${dim(`(${content.length} chars)`)}`);
}
console.log(
  `\n  ${yellow("Total")}: ${allArticles.length.toLocaleString()} chars (~${Math.round(allArticles.length / 4).toLocaleString()} tokens)\n`,
);

const conversation: Array<{
  role: "user" | "assistant";
  content: string;
  label: string;
}> = [
  {
    role: "user",
    content: `I have a series of articles about SSR and rendering in React. Read them carefully — I'll be asking you questions about React Server Components specifically.\n\n${allArticles}`,
    label: "User sends all 5 articles",
  },
  {
    role: "assistant",
    content:
      "I've read all the articles. Ready for your questions about React Server Components!",
    label: "Assistant acknowledges",
  },
  {
    role: "user",
    content:
      "According to the benchmarks in the articles, what are the exact LCP numbers for CSR vs SSR vs RSC on first load (no cache)?",
    label: "Question 1: exact LCP numbers",
  },
  {
    role: "assistant",
    content:
      "From the benchmark data: CSR had an LCP of 4.1s on first load. SSR with client-side data fetching improved that to 1.61s. With RSC (Next.js App Router, lift-and-shift), LCP dropped to 1.28s. And RSC with server-side fetching and Suspense also hit 1.28s for LCP. So RSC matches or beats SSR on first-load LCP.",
    label: "Answer 1 (canned from article data)",
  },
  {
    role: "user",
    content:
      "What about the interactivity gap? The article mentions a Toggle becoming interactive — how did RSC compare to SSR there?",
    label: "Question 2: interactivity gap",
  },
  {
    role: "assistant",
    content:
      "This is where it gets interesting. With SSR and server-side data fetching, the Toggle became interactive at 4.6s (no cache) / 1.4s (cached). With RSC lift-and-shift, it was 3.8s / 900ms. And with RSC + Suspense + server fetching, it was 3.8s / 800ms. So RSC improved interactivity time by about 17-43% depending on the scenario. The key insight from the article is that RSC reduces the JavaScript bundle sent to the client, which directly speeds up hydration.",
    label: "Answer 2 (canned from article data)",
  },
  {
    role: "user",
    content:
      "I want to reason carefully about why the interactivity delta is larger and more variable than the LCP delta — but I don't fully trust the numbers you quoted from memory, they might be stale or approximated. Before you answer, re-validate the measurements you actually need (and only the ones you need) so we're reasoning over fresh data. Then walk me through what the numbers tell us about where RSC's wins are coming from.",
    label: "Question 3: reasoning that benefits from re-validating numbers",
  },
];

const deepAnalysisTool: ToolDefinition = {
  name: "deepAnalysis",
  description:
    "Re-measure and re-validate a benchmark data point referenced in the articles. Returns the re-validated value along with confidence metadata. Use this whenever a quantitative claim from the articles needs verification before reasoning about it.",
  input_schema: {
    type: "object",
    properties: {
      metric: {
        type: "string",
        enum: ["LCP", "toggle_interactive"],
        description: "Which metric to re-measure.",
      },
      rendering_approach: {
        type: "string",
        enum: ["CSR", "SSR", "RSC_lift_and_shift", "RSC_suspense"],
      },
      cache_state: {
        type: "string",
        enum: ["no_cache", "cached"],
      },
    },
    required: ["metric", "rendering_approach", "cache_state"],
  },
};

// Fake handler — returns values close to what the model already saw, with a
// tiny perturbation to show that the tool actually got called and mattered.
async function handleDeepAnalysis(
  _name: string,
  input: Record<string, unknown>,
): Promise<string> {
  const { metric, rendering_approach, cache_state } = input as {
    metric: string;
    rendering_approach: string;
    cache_state: string;
  };
  console.log(
    `\n🔧 ${bold("deepAnalysis called")} → metric=${cyan(metric)}, approach=${cyan(rendering_approach)}, cache=${cyan(cache_state)}`,
  );
  const table: Record<string, Record<string, Record<string, number>>> = {
    LCP: {
      CSR: { no_cache: 4.12, cached: 1.05 },
      SSR: { no_cache: 1.63, cached: 0.41 },
      RSC_lift_and_shift: { no_cache: 1.29, cached: 0.38 },
      RSC_suspense: { no_cache: 1.28, cached: 0.36 },
    },
    toggle_interactive: {
      CSR: { no_cache: 5.2, cached: 2.1 },
      SSR: { no_cache: 4.58, cached: 1.41 },
      RSC_lift_and_shift: { no_cache: 3.79, cached: 0.91 },
      RSC_suspense: { no_cache: 3.81, cached: 0.82 },
    },
  };
  const value = table[metric]?.[rendering_approach]?.[cache_state];
  const result = {
    metric,
    rendering_approach,
    cache_state,
    revalidated_seconds: value ?? null,
    sample_size: 50,
    p95_deviation_seconds: 0.07,
    confidence: value != null ? "high" : "unavailable",
  };
  console.log(`   ${dim(`↪ returning: ${JSON.stringify(result)}`)}\n`);
  return JSON.stringify(result);
}

async function main() {
  const messages = conversation.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const params: ChatWithToolsParams = {
    model: "claude-opus-4-7",
    max_tokens: 4096,
    messages,
    tools: [deepAnalysisTool],
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: "high" },
  };

  console.log(bold("━━━ Sending request... ━━━━━━━━━━━━━━━━━━━━━━\n"));
  const start = performance.now();
  const response = await chatWithTools("anthropic", params, handleDeepAnalysis);
  const duration = performance.now() - start;

  logResponse(response, duration);
}

main().catch(console.error);
