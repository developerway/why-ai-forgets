import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chat,
  getDefaultModel,
  logResponse,
  countTokenBreakdown,
  provider,
  verbose,
  type ChatParams,
} from "shared";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const postsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../articles");

const ssrFiles = [
  "40:initial-load-performance.mdx",
  "41:client-side-rendering-flame-graph.mdx",
  "42:ssr-deep-dive-for-react-developers.mdx",
  "46:react-server-components-performance.mdx",
  "48:server-actions-for-data-fetching.mdx",
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

// All questions are specifically about React Server Components.
// Only 1 of the 5 articles (react-server-components-performance) is truly relevant.
// The other 4 articles are dead weight — stealing tokens and slowing everything down.
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
      "Did the article find any downsides or surprising results with React Server Components?",
    label: "Question 3: RSC downsides",
  },
];

async function main() {
  const model = getDefaultModel(provider);

  const messages = conversation.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const params: ChatParams = {
    model,
    max_tokens: 2048,
    messages,
  };

  // Token breakdown
  if (verbose) {
    console.log(bold("━━━ Counting tokens... ━━━━━━━━━━━━━━━━━━━━━\n"));
    const bStart = performance.now();
    const breakdown = await countTokenBreakdown(provider, params);
    const bDuration = performance.now() - bStart;
    console.log(`  ${dim(`Token counting took ${bDuration.toFixed(0)}ms`)}\n`);

    // Send request
    console.log(bold("━━━ Sending request... ━━━━━━━━━━━━━━━━━━━━━━\n"));
    const start = performance.now();
    const response = await chat(provider, params);
    const duration = performance.now() - start;

    logResponse(response, duration, breakdown);
  } else {
    console.log(bold("━━━ Sending request... ━━━━━━━━━━━━━━━━━━━━━━\n"));
    const start = performance.now();
    const response = await chat(provider, params);
    const duration = performance.now() - start;

    logResponse(response, duration);
  }
}

main().catch(console.error);
