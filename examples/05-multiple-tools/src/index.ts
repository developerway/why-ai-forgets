import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chatWithTools,
  getDefaultModel,
  logResponse,
  provider,
  type ToolDefinition,
} from "shared";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const postsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../articles");

const articles: Record<string, { title: string; description: string; file: string }> = {
  "initial-load-performance": {
    title: "Initial load performance for React developers: investigative deep dive",
    description: "Exploring Core Web Vitals, Chrome performance panel, what initial load performance is, which metrics measure it, and how cache control and different networking conditions influence it.",
    file: "40:initial-load-performance.mdx",
  },
  "client-side-rendering": {
    title: "Client-Side Rendering in Flame Graphs",
    description: "Intro to Performance Flame Graphs. Learn how to read and extract useful info from performance flame graphs while exploring how Client-Side rendering works in React applications.",
    file: "41:client-side-rendering-flame-graph.mdx",
  },
  "ssr-deep-dive": {
    title: "SSR Deep Dive for React Developers",
    description: "Explore step-by-step how Server-Side Rendering (SSR), pre-rendering, hydration, and Static Site Generation (SSG) work in React, their costs, performance impact, benefits, and trade-offs.",
    file: "42:ssr-deep-dive-for-react-developers.mdx",
  },
  "react-server-components": {
    title: "React Server Components: Do They Really Improve Performance?",
    description: "A data-driven comparison of CSR, SSR, and RSC under the same app and test setup, focusing on initial-load performance and the impact of client- vs server-side data fetching (including Streaming + Suspense).",
    file: "46:react-server-components-performance.mdx",
  },
  "server-actions": {
    title: "Can You Fetch Data with React Server Actions?",
    description: "Can React Server Actions replace fetch for client-side data fetching? Investigates the approach and its implications.",
    file: "48:server-actions-for-data-fetching.mdx",
  },
};

const articleIndex = Object.entries(articles)
  .map(
    ([id, a], i) =>
      `${i + 1}. [${id}] "${a.title}"\n   ${a.description}`,
  )
  .join("\n\n");

const tools: ToolDefinition[] = [
  {
    name: "read_article",
    description:
      "Read the full content of an article by its ID. Use this to get detailed information from a specific article.",
    input_schema: {
      type: "object",
      properties: {
        article_id: {
          type: "string",
          description:
            "The article ID (e.g. 'ssr-deep-dive', 'react-server-components')",
        },
      },
      required: ["article_id"],
    },
  },
];

async function main() {
  const model = getDefaultModel(provider);
  let totalContextChars = 0;
  let toolCallCount = 0;

  console.log(bold("\n━━━ Example 05: Multiple Tools Loop ━━━━━━━\n"));
  console.log(
    `  ${cyan("Strategy")}: Same index + read_article tool as example 04`,
  );
  console.log(
    `  ${cyan("Difference")}: Prompt asks for thorough research — model reads multiple articles`,
  );
  console.log(
    `  ${cyan("Watch")}: Context grows with each article read\n`,
  );

  const toolHandler = async (
    _name: string,
    input: Record<string, unknown>,
  ): Promise<string> => {
    toolCallCount++;
    const { article_id } = input as { article_id: string };
    const article = articles[article_id];

    if (!article) {
      console.log(
        `  ${bold(`[${toolCallCount}]`)} ❌ read_article("${article_id}") — not found\n`,
      );
      return `Article "${article_id}" not found. Available IDs: ${Object.keys(articles).join(", ")}`;
    }

    const readStart = performance.now();
    const content = readFileSync(join(postsDir, article.file), "utf-8");
    const readDuration = performance.now() - readStart;

    totalContextChars += content.length;

    console.log(
      `  ${bold(`[${toolCallCount}]`)} 📖 ${bold("read_article")}("${article_id}")`,
    );
    console.log(
      `     → "${article.title}"`,
    );
    console.log(
      `     → ${content.length.toLocaleString()} chars ${dim(`(${readDuration.toFixed(0)}ms)`)}`,
    );
    console.log(
      `     ${yellow(`+${content.length.toLocaleString()} chars`)} → total from tools: ~${totalContextChars.toLocaleString()} chars (~${Math.round(totalContextChars / 4).toLocaleString()} tokens)\n`,
    );

    return content;
  };

  console.log(bold("━━━ Sending request... ━━━━━━━━━━━━━━━━━━━━━━\n"));

  const start = performance.now();
  const response = await chatWithTools(
    provider,
    {
      model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `I have the following articles available about React rendering and SSR. You can read any of them using the read_article tool.\n\n${articleIndex}\n\nResearch this thoroughly: I want to understand the full picture of React Server Components. How do they compare to CSR and SSR in terms of performance? What are the trade-offs? How does data fetching work differently? Read ALL the relevant articles — I want you to cross-reference the findings and give me a comprehensive analysis with specific data.`,
        },
      ],
      tools,
    },
    toolHandler,
  );
  const duration = performance.now() - start;

  console.log(
    `\n  📊 ${bold("Total context from tools")}: ~${totalContextChars.toLocaleString()} chars (~${Math.round(totalContextChars / 4).toLocaleString()} tokens)`,
  );
  console.log(`  📊 ${bold("Articles read")}: ${toolCallCount}\n`);

  logResponse(response, duration);
}

main().catch(console.error);
