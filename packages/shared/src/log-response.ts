import type Anthropic from "@anthropic-ai/sdk";

type Message = Anthropic.Message;
type MessageCreateParams = Anthropic.MessageCreateParamsNonStreaming;

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;
const blue = (s: string) => `\x1b[34m${s}\x1b[0m`;

function estimateTokenCost(
  input: number,
  output: number,
  model: string,
): { inputCost: number; outputCost: number } {
  // Pricing per million tokens (https://docs.anthropic.com/en/docs/about-claude/models)
  const pricing: Record<string, { input: number; output: number }> = {
    "claude-opus-4-6-20250612": { input: 5, output: 25 },
    "claude-opus-4-5-20250414": { input: 5, output: 25 },
    "claude-opus-4-1-20250414": { input: 15, output: 75 },
    "claude-opus-4-20250514": { input: 15, output: 75 },
    "claude-sonnet-4-6-20250514": { input: 3, output: 15 },
    "claude-sonnet-4-5-20250514": { input: 3, output: 15 },
    "claude-sonnet-4-20250514": { input: 3, output: 15 },
    "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  };

  const p = pricing[model] ?? { input: 3, output: 15 };
  return {
    inputCost: (input / 1_000_000) * p.input,
    outputCost: (output / 1_000_000) * p.output,
  };
}

function firstNWords(s: string, n: number): string {
  const words = s.split(/\s+/).slice(0, n);
  const result = words.join(" ");
  if (s.split(/\s+/).length > n) return result + "...";
  return result;
}

function textContent(
  content: string | Anthropic.MessageParam["content"],
): string {
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

interface TokenBreakdownEntry {
  label: string;
  preview: string;
  tokens: number;
}

export async function countTokenBreakdown(
  client: Anthropic,
  params: MessageCreateParams,
): Promise<TokenBreakdownEntry[]> {
  const breakdown: TokenBreakdownEntry[] = [];
  const { model, messages, system, tools } = params;

  // Baseline: minimal request to isolate overhead
  const dummyMsg = { role: "user" as const, content: "." };
  const baseline = await client.messages.countTokens({
    model,
    messages: [dummyMsg],
  });
  let running = baseline.input_tokens;

  // System prompt
  if (system) {
    const systemText = typeof system === "string" ? system : JSON.stringify(system);
    const withSystem = await client.messages.countTokens({
      model,
      messages: [dummyMsg],
      system,
    });
    const delta = withSystem.input_tokens - running;
    breakdown.push({
      label: "System prompt",
      preview: firstNWords(systemText, 10),
      tokens: delta,
    });
    running = withSystem.input_tokens;
  }

  // Tools
  if (tools && tools.length > 0) {
    const withTools = await client.messages.countTokens({
      model,
      messages: [dummyMsg],
      system,
      tools,
    });
    const delta = withTools.input_tokens - running;
    const toolNames = tools.map((t) => "name" in t ? t.name : "tool").join(", ");
    breakdown.push({
      label: `Tools (${tools.length})`,
      preview: toolNames,
      tokens: delta,
    });
    running = withTools.input_tokens;
  }

  // First message
  const firstMsg = messages[0];
  const withFirst = await client.messages.countTokens({
    model,
    messages: [firstMsg],
    system,
    tools,
  });
  breakdown.push({
    label: `User message`,
    preview: firstNWords(textContent(firstMsg.content), 10),
    tokens: withFirst.input_tokens - running,
  });
  running = withFirst.input_tokens;

  // Remaining messages
  for (let i = 1; i < messages.length; i++) {
    const slice = messages.slice(0, i + 1);
    const result = await client.messages.countTokens({
      model,
      messages: slice,
      system,
      tools,
    });
    const delta = result.input_tokens - running;
    const msg = messages[i];
    const roleLabel = msg.role === "assistant" ? "AI response" : "User message";
    breakdown.push({
      label: roleLabel,
      preview: firstNWords(textContent(msg.content), 10),
      tokens: delta,
    });
    running = result.input_tokens;
  }

  return breakdown;
}

export function logResponse(
  response: Message,
  durationMs: number,
  breakdown?: TokenBreakdownEntry[],
) {
  const { usage, model, stop_reason } = response;
  const totalTokens = usage.input_tokens + usage.output_tokens;
  const { inputCost, outputCost } = estimateTokenCost(
    usage.input_tokens,
    usage.output_tokens,
    model,
  );
  const totalCost = inputCost + outputCost;

  // Response text
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  console.log();
  console.log(bold("━━━ Response ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(text);
  console.log();

  // Performance
  console.log(bold("━━━ Performance ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(`  ${cyan("Model")}            ${model}`);
  console.log(`  ${cyan("Stop reason")}      ${stop_reason}`);
  console.log(`  ${cyan("Duration")}         ${durationMs.toFixed(0)}ms`);
  const tokPerSec =
    durationMs > 0
      ? (usage.output_tokens / (durationMs / 1000)).toFixed(1)
      : "N/A";
  console.log(`  ${cyan("Output speed")}     ${tokPerSec} tok/s`);
  console.log();

  // Token breakdown
  if (breakdown) {
    // Add the AI output as the final entry in the conversation trace
    const outputPreview = firstNWords(text, 10);
    const allEntries = [
      ...breakdown,
      {
        label: "=> AI response (output)",
        preview: outputPreview,
        tokens: usage.output_tokens,
      },
    ];

    console.log(bold("━━━ Token Breakdown ━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log();
    for (const entry of allEntries) {
      const pct =
        totalTokens > 0
          ? ((entry.tokens / totalTokens) * 100).toFixed(1)
          : "0.0";
      console.log(
        `  ${bold(entry.label)} ${dim(`(${entry.tokens} tokens, ${pct}%)`)}`,
      );
      console.log(`  ${dim(entry.preview)}`);
      console.log();
    }
    console.log(dim("  ─────────────────────────────────────────"));
    console.log(`  ${yellow("Input tokens")}     ${usage.input_tokens}`);
    console.log(`  ${green("Output tokens")}    ${usage.output_tokens}`);
    console.log(`  ${bold("Total tokens")}     ${totalTokens}`);
  } else {
    console.log(bold("━━━ Tokens ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(`  ${yellow("Input")}            ${usage.input_tokens.toLocaleString()}`);
    console.log(`  ${green("Output")}           ${usage.output_tokens.toLocaleString()}`);
    console.log(`  ${bold("Total")}            ${totalTokens.toLocaleString()}`);
  }

  if (usage.cache_creation_input_tokens || usage.cache_read_input_tokens) {
    console.log();
    console.log(bold("━━━ Cache ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(
      `  ${magenta("Cache write")}      ${(usage.cache_creation_input_tokens ?? 0).toLocaleString()}`,
    );
    console.log(
      `  ${magenta("Cache read")}       ${(usage.cache_read_input_tokens ?? 0).toLocaleString()}`,
    );
  }

  // Cost
  console.log();
  console.log(bold("━━━ Estimated Cost ━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(`  ${yellow("Input")}            $${inputCost.toFixed(6)}`);
  console.log(`  ${green("Output")}           $${outputCost.toFixed(6)}`);
  console.log(`  ${bold("Total")}            $${totalCost.toFixed(6)}`);
  console.log(dim("  (approximate, based on public pricing)"));
  console.log();
}
