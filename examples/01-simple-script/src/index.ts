import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages.js";
import { logResponse, countTokenBreakdown } from "shared";

const verbose = process.argv.includes("--breakdown");

async function main() {
  const client = new Anthropic();

  const params: MessageCreateParamsNonStreaming = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      { role: "user" as const, content: "Hi, how are you?" },
      {
        role: "assistant" as const,
        content:
          "I'm happy that you're here, the most amazing person in the world!",
      },
      { role: "user" as const, content: "Oh, thank you, you're the best too!" },
    ],
  };

  const breakdown = verbose
    ? await countTokenBreakdown(client, params)
    : undefined;

  const start = performance.now();
  const response = await client.messages.create(params);
  const duration = performance.now() - start;

  logResponse(response, duration, breakdown);
}

main().catch(console.error);
