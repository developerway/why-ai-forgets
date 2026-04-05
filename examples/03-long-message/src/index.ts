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

const __dirname = dirname(fileURLToPath(import.meta.url));
const article = readFileSync(join(__dirname, "../data/article.md"), "utf-8");

async function main() {
  const params: ChatParams = {
    model: getDefaultModel(provider),
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content:
          "In the next message, I'll give you an article. Summarise it for me.",
      },
      {
        role: "assistant",
        content:
          "Sure! Go ahead and share the article, and I'll summarise it for you.",
      },
      {
        role: "user",
        content: article,
      },
    ],
  };

  const breakdown = verbose
    ? await countTokenBreakdown(provider, params)
    : undefined;

  const start = performance.now();
  const response = await chat(provider, params);
  const duration = performance.now() - start;

  logResponse(response, duration, breakdown);
}

main().catch(console.error);
