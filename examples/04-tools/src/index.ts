import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

// Recursively truncate any long string, preserving object/array shape — but
// keep AI reasoning intact (text + thinking blocks), because that's what's
// most valuable to see during a live demo. Strips the long base64 signature
// on thinking blocks (API plumbing, not reasoning). Remove this helper if
// you want the full raw message dump.
function prettify(value: unknown, maxStringLen = 300): unknown {
  if (typeof value === "string") {
    return value.length > maxStringLen
      ? `${value.slice(0, maxStringLen)}… <+${value.length - maxStringLen} chars>`
      : value;
  }
  if (Array.isArray(value)) return value.map((v) => prettify(v, maxStringLen));
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.type === "text") return obj;
    if (obj.type === "thinking") {
      return obj.signature ? { ...obj, signature: "<elided>" } : obj;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = prettify(v, maxStringLen);
    return out;
  }
  return value;
}

function logJSON(label: string, value: unknown) {
  console.log(yellow(label));
  console.log(JSON.stringify(prettify(value), null, 2));
}

const postsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../articles");

const articles: Record<string, { title: string; description: string; file: string }> = {
  "initial-load-performance": {
    title: "Initial load performance for React developers: investigative deep dive",
    description:
      "Exploring Core Web Vitals, Chrome performance panel, what initial load performance is, which metrics measure it, and how cache control and different networking conditions influence it.",
    file: "40:initial-load-performance.mdx",
  },
  "client-side-rendering": {
    title: "Client-Side Rendering in Flame Graphs",
    description:
      "Intro to Performance Flame Graphs. Learn how to read and extract useful info from performance flame graphs while exploring how Client-Side rendering works in React applications.",
    file: "41:client-side-rendering-flame-graph.mdx",
  },
  "ssr-deep-dive": {
    title: "SSR Deep Dive for React Developers",
    description:
      "Explore step-by-step how Server-Side Rendering (SSR), pre-rendering, hydration, and Static Site Generation (SSG) work in React, their costs, performance impact, benefits, and trade-offs.",
    file: "42:ssr-deep-dive-for-react-developers.mdx",
  },
  "react-server-components": {
    title: "React Server Components: Do They Really Improve Performance?",
    description:
      "A data-driven comparison of CSR, SSR, and RSC under the same app and test setup, focusing on initial-load performance and the impact of client- vs server-side data fetching (including Streaming + Suspense).",
    file: "46:react-server-components-performance.mdx",
  },
  "server-actions": {
    title: "Can You Fetch Data with React Server Actions?",
    description:
      "Can React Server Actions replace fetch for client-side data fetching? Investigates the approach and its implications.",
    file: "48:server-actions-for-data-fetching.mdx",
  },
};

const articleIndex = Object.entries(articles)
  .map(([id, a], i) => `${i + 1}. [${id}] "${a.title}"\n   ${a.description}`)
  .join("\n\n");

const readArticleTool: Anthropic.Messages.Tool = {
  name: "read_article",
  description:
    "Read the full content of an article by its ID. Use this to load an article into context before reasoning about it.",
  input_schema: {
    type: "object",
    properties: {
      article_id: {
        type: "string",
        description:
          "The article ID (e.g. 'react-server-components'). Must match one of the IDs listed in the conversation.",
      },
    },
    required: ["article_id"],
  },
};

const deepAnalysisTool: Anthropic.Messages.Tool = {
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

async function handleReadArticle(input: Record<string, unknown>): Promise<string> {
  const { article_id } = input as { article_id: string };
  const article = articles[article_id];
  if (!article) {
    console.log(
      `\n🔧 ${bold("read_article called")} → article_id=${cyan(article_id)} ${yellow("(not found)")}`,
    );
    return `Article "${article_id}" not found. Available IDs: ${Object.keys(articles).join(", ")}`;
  }
  const content = readFileSync(join(postsDir, article.file), "utf-8");
  console.log(
    `\n🔧 ${bold("read_article called")} → article_id=${cyan(article_id)}`,
  );
  console.log(
    `   ${dim(`↪ returning ${content.length.toLocaleString()} chars (~${Math.round(content.length / 4).toLocaleString()} tokens)`)}\n`,
  );
  return content;
}

async function handleDeepAnalysis(input: Record<string, unknown>): Promise<string> {
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

// Run a tool-use loop and return the COMPLETE message history (including
// tool_use + tool_result blocks AND the final assistant turn). This is what
// Phase 1 needs to return so we can inspect/paste the full conversation.
async function runToolLoop(
  initialMessages: Anthropic.Messages.MessageParam[],
  tools: Anthropic.Messages.Tool[],
  handlers: Record<string, (input: Record<string, unknown>) => Promise<string>>,
): Promise<Anthropic.Messages.MessageParam[]> {
  const client = new Anthropic();
  const messages: Anthropic.Messages.MessageParam[] = [...initialMessages];
  let turn = 0;

  while (true) {
    turn++;
    console.log(cyan(bold(`\n━━━ Turn ${turn}: → request ━━━━━━━━━━━━━━━━━━━━━━━━━━`)));
    logJSON(`messages (${messages.length}) →`, messages);

    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 4096,
      tools,
      messages,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "high" },
    });

    console.log(cyan(bold(`\n━━━ Turn ${turn}: ← response ━━━━━━━━━━━━━━━━━━━━━━━━`)));
    console.log(
      dim(
        `stop_reason=${response.stop_reason}  usage: input=${response.usage.input_tokens} output=${response.usage.output_tokens}`,
      ),
    );
    logJSON(`content ←`, response.content);

    // Always push the assistant turn so the returned history is complete.
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") break;

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const b of response.content) {
      if (b.type !== "tool_use") continue;
      const handler = handlers[b.name];
      const result = handler
        ? await handler(b.input as Record<string, unknown>)
        : `No handler registered for tool "${b.name}"`;
      toolResults.push({ type: "tool_result", tool_use_id: b.id, content: result });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return messages;
}

// ─── Phase 1 ────────────────────────────────────────────────────────────────
// Hands Claude the article index (titles + descriptions only) and the
// read_article tool, and lets it decide which articles to load. Returns the
// entire conversation history so it can be inspected / copy-pasted into
// Phase 2 as a hardcoded messages literal.
async function phase1(): Promise<Anthropic.Messages.MessageParam[]> {
  console.log(magenta(bold("\n╔═══════════════════════════════════════════════╗")));
  console.log(magenta(bold("║            PHASE 1: read the article           ║")));
  console.log(magenta(bold("╚═══════════════════════════════════════════════╝\n")));

  const initial: Anthropic.Messages.MessageParam[] = [
    {
      role: "user",
      content: `I'm going to ask you detailed questions about React Server Components performance — specifically about LCP numbers, interactivity timings, and where RSC's wins come from. Below is a list of articles available in the library. Decide which one(s) are most relevant based on the descriptions, then load them with the read_article tool so their benchmarks are fresh in context before I ask my questions.\n\nAvailable articles:\n\n${articleIndex}`,
    },
  ];

  const messages = await runToolLoop(initial, [readArticleTool], {
    read_article: handleReadArticle,
  });

  return messages;
}

// ─── Phase 2 ────────────────────────────────────────────────────────────────
// Takes a hardcoded conversation history (pasted from Phase 1's log) plus a
// canned Q&A tail, and runs the deepAnalysis tool loop over it. Completely
// independent from Phase 1 — no hidden state, no helper plumbing.
const cannedQA: Anthropic.Messages.MessageParam[] = [
  {
    role: "user",
    content:
      "According to the benchmarks in the article, what are the exact LCP numbers for CSR vs SSR vs RSC on first load (no cache)?",
  },
  {
    role: "assistant",
    content:
      "From the benchmark data: CSR had an LCP of 4.1s on first load. SSR with client-side data fetching improved that to 1.61s. With RSC (Next.js App Router, lift-and-shift), LCP dropped to 1.28s. And RSC with server-side fetching and Suspense also hit 1.28s for LCP. So RSC matches or beats SSR on first-load LCP.",
  },
  {
    role: "user",
    content:
      "What about the interactivity gap? The article mentions a Toggle becoming interactive — how did RSC compare to SSR there?",
  },
  {
    role: "assistant",
    content:
      "This is where it gets interesting. With SSR and server-side data fetching, the Toggle became interactive at 4.6s (no cache) / 1.4s (cached). With RSC lift-and-shift, it was 3.8s / 900ms. And with RSC + Suspense + server fetching, it was 3.8s / 800ms. So RSC improved interactivity time by about 17-43% depending on the scenario. The key insight from the article is that RSC reduces the JavaScript bundle sent to the client, which directly speeds up hydration.",
  },
  {
    role: "user",
    content:
      "I want to reason carefully about why the interactivity delta is larger and more variable than the LCP delta — but I don't fully trust the numbers you quoted from memory, they might be stale or approximated. Before you answer, re-validate the measurements you actually need (and only the ones you need) so we're reasoning over fresh data. Then walk me through what the numbers tell us about where RSC's wins are coming from.",
  },
];

// Pre-canned version of Phase 1's output, used to seed Phase 2's context.
// Structurally mirrors what Phase 1 actually produces (user prompt →
// assistant text + tool_use blocks → user tool_result blocks → assistant
// closing text), but everything is hand-written except the article bodies,
// which are read from disk at call time.
//
// Notable differences from a real Phase 1 capture:
//   - No thinking blocks — the API requires a server-issued signature for
//     thinking blocks in message history, which we can't forge.
//   - Tool IDs are short and predictable (toolu_01/02/03) instead of the
//     auto-generated toolu_... values.
//   - Tool-use blocks omit the optional `caller` field.
function buildPrecannedPhase1History(): Anthropic.Messages.MessageParam[] {
  const chosenArticles = [
    { id: "react-server-components", toolUseId: "toolu_01" },
    { id: "ssr-deep-dive", toolUseId: "toolu_02" },
    { id: "initial-load-performance", toolUseId: "toolu_03" },
  ];

  return [
    {
      role: "user",
      content: `I'm going to ask you detailed questions about React Server Components performance — specifically about LCP numbers, interactivity timings, and where RSC's wins come from. Below is a list of articles available in the library. Decide which one(s) are most relevant based on the descriptions, then load them with the read_article tool so their benchmarks are fresh in context before I ask my questions.\n\nAvailable articles:\n\n${articleIndex}`,
    },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "The React Server Components article is the primary source — it contains the CSR vs SSR vs RSC benchmark table. I'll also pull in the SSR deep dive (for the hydration / interactivity model) and the initial-load-performance article (for the LCP methodology the RSC numbers are measured against). Loading all three now.",
        },
        ...chosenArticles.map((a) => ({
          type: "tool_use" as const,
          id: a.toolUseId,
          name: "read_article",
          input: { article_id: a.id },
        })),
      ],
    },
    {
      role: "user",
      content: chosenArticles.map((a) => ({
        type: "tool_result" as const,
        tool_use_id: a.toolUseId,
        content: readFileSync(join(postsDir, articles[a.id].file), "utf-8"),
      })),
    },
    {
      role: "assistant",
      content:
        "All three articles are loaded and fresh in context. Ready for your questions.",
    },
  ];
}

async function phase2(): Promise<void> {
  console.log(magenta(bold("\n╔═══════════════════════════════════════════════╗")));
  console.log(magenta(bold("║  PHASE 2: reason + re-validate with deepAnalysis  ║")));
  console.log(magenta(bold("╚═══════════════════════════════════════════════╝\n")));

  const phase1History = buildPrecannedPhase1History();
  const messages = [...phase1History, ...cannedQA];

  await runToolLoop(messages, [deepAnalysisTool], {
    deepAnalysis: handleDeepAnalysis,
  });
}

function parsePhaseArg(): "1" | "2" | null {
  const arg = process.argv.find((a) => a.startsWith("--phase="));
  if (!arg) return null;
  const value = arg.slice("--phase=".length);
  return value === "1" || value === "2" ? value : null;
}

function printUsage() {
  console.log(bold("\nExample 04: tool use + adaptive thinking\n"));
  console.log(
    `  ${cyan("Phase 1")}  — live: Claude sees an article index and a read_article`,
  );
  console.log(
    `            tool, decides which articles are relevant, and loads them.`,
  );
  console.log(
    `            Shows the model's reasoning + tool-selection behavior.\n`,
  );
  console.log(
    `  ${cyan("Phase 2")}  — pre-canned: the read_article round-trip is hardcoded,`,
  );
  console.log(
    `            then Claude reasons over the loaded articles and calls`,
  );
  console.log(
    `            deepAnalysis to re-validate benchmark numbers.`,
  );
  console.log(
    `            Shows thinking → tool_use → tool_result → thinking interleaving.\n`,
  );
  console.log(yellow(`  Run one of:`));
  console.log(`    ${dim("pnpm --filter 04-tools start -- --phase=1")}`);
  console.log(`    ${dim("pnpm --filter 04-tools start -- --phase=2")}\n`);
}

async function main() {
  const phase = parsePhaseArg();
  if (phase === "1") {
    await phase1();
  } else if (phase === "2") {
    await phase2();
  } else {
    printUsage();
  }
}

main().catch(console.error);
