import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chat,
  chatWithTools,
  getDefaultModel,
  logResponse,
  provider,
  type ChatResponse,
  type ToolDefinition,
} from "shared";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

const postsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../articles",
);

const articles: Record<
  string,
  { title: string; description: string; file: string }
> = {
  "initial-load-performance": {
    title:
      "Initial load performance for React developers: investigative deep dive",
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
  .map(
    ([id, a], i) =>
      `${i + 1}. [${id}] "${a.title}"\n   ${a.description}`,
  )
  .join("\n\n");

// The sub-agent's tool: read_article
const subAgentTools: ToolDefinition[] = [
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

// The main conversation's tool: research_topic
const mainTools: ToolDefinition[] = [
  {
    name: "research_topic",
    description:
      "Delegate a research question to a sub-agent that has access to a library of articles. The sub-agent will read relevant articles, cross-reference findings, and return a comprehensive analysis. Only the final answer is returned — the research context is not carried into the main conversation.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The research question to investigate",
        },
      },
      required: ["question"],
    },
  },
];

async function main() {
  const model = getDefaultModel(provider);
  let subAgentTokens = { input: 0, output: 0 };
  let subAgentToolCalls = 0;
  let subAgentContextChars = 0;

  console.log(bold("\n━━━ Example 06: Agentic (Sub-Agent) ━━━━━━━━━\n"));
  console.log(
    `  ${cyan("Strategy")}: Main conversation delegates to a sub-agent`,
  );
  console.log(
    `  ${cyan("Sub-agent")}: Has its own context + read_article tool`,
  );
  console.log(
    `  ${cyan("Key difference")}: Sub-agent's context is discarded after it returns`,
  );
  console.log(
    `  ${cyan("Main context")}: Only sees the final synthesized answer\n`,
  );

  // The main tool handler: spins up a sub-agent
  const mainToolHandler = async (
    _name: string,
    input: Record<string, unknown>,
  ): Promise<string> => {
    const { question } = input as { question: string };

    console.log(`  🤖 ${bold("Sub-agent started")}: "${question}"\n`);
    console.log(
      `  ${magenta("┌─── Sub-agent context (isolated) ───────────")}\n`,
    );

    const subAgentStart = performance.now();

    // Sub-agent's read_article handler
    const readArticleHandler = async (
      _n: string,
      inp: Record<string, unknown>,
    ): Promise<string> => {
      subAgentToolCalls++;
      const { article_id } = inp as { article_id: string };
      const article = articles[article_id];

      if (!article) {
        console.log(
          `  ${magenta("│")} ❌ read_article("${article_id}") — not found\n`,
        );
        return `Article "${article_id}" not found. Available IDs: ${Object.keys(articles).join(", ")}`;
      }

      const content = readFileSync(join(postsDir, article.file), "utf-8");
      subAgentContextChars += content.length;

      console.log(
        `  ${magenta("│")} 📖 ${bold("read_article")}("${article_id}")`,
      );
      console.log(
        `  ${magenta("│")}    → ${content.length.toLocaleString()} chars`,
      );
      console.log(
        `  ${magenta("│")}    ${yellow(`total sub-agent context: ~${subAgentContextChars.toLocaleString()} chars`)}\n`,
      );

      return content;
    };

    // Run the sub-agent with its own chatWithTools loop
    const subAgentResponse = await chatWithTools(
      provider,
      {
        model,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: `You are a research assistant. You have access to the following articles:\n\n${articleIndex}\n\nResearch this thoroughly: ${question}\n\nRead ALL the relevant articles, cross-reference the findings, and provide a comprehensive analysis with specific data.`,
          },
        ],
        tools: subAgentTools,
      },
      readArticleHandler,
    );

    const subAgentDuration = performance.now() - subAgentStart;
    subAgentTokens.input += subAgentResponse.input_tokens;
    subAgentTokens.output += subAgentResponse.output_tokens;

    console.log(
      `  ${magenta("│")} ${dim(`Sub-agent: ${subAgentResponse.input_tokens.toLocaleString()} input + ${subAgentResponse.output_tokens.toLocaleString()} output tokens`)}`,
    );
    console.log(
      `  ${magenta("│")} ${dim(`Sub-agent duration: ${(subAgentDuration / 1000).toFixed(1)}s`)}`,
    );
    console.log(
      `  ${magenta("└─── Sub-agent context discarded ────────────")}\n`,
    );
    console.log(
      `  ✅ ${bold("Sub-agent returned")} ${subAgentResponse.text.length.toLocaleString()} chars to main context\n`,
    );

    // Only the final text goes back to the main conversation
    return subAgentResponse.text;
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
          content:
            "I want to understand the full picture of React Server Components. How do they compare to CSR and SSR in terms of performance? What are the trade-offs? How does data fetching work differently? Give me a comprehensive, balanced analysis with specific data.",
        },
      ],
      tools: mainTools,
    },
    mainToolHandler,
  );
  const duration = performance.now() - start;

  console.log(bold("━━━ Context Summary ━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
  console.log(
    `  ${cyan("Main conversation")}:  ${response.input_tokens.toLocaleString()} input tokens`,
  );
  console.log(
    `  ${magenta("Sub-agent (discarded)")}: ${subAgentTokens.input.toLocaleString()} input + ${subAgentTokens.output.toLocaleString()} output tokens`,
  );
  console.log(
    `  ${magenta("Sub-agent articles read")}: ${subAgentToolCalls}`,
  );
  console.log(
    `  ${magenta("Sub-agent context loaded")}: ~${subAgentContextChars.toLocaleString()} chars (~${Math.round(subAgentContextChars / 4).toLocaleString()} tokens)`,
  );
  console.log(
    `  ${yellow("Total tokens (all calls)")}: ${(response.input_tokens + response.output_tokens + subAgentTokens.input + subAgentTokens.output).toLocaleString()}\n`,
  );

  logResponse(response, duration);
}

main().catch(console.error);
