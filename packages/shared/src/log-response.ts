import { encoding_for_model, type TiktokenModel } from "tiktoken";
import type { ChatParams, ChatResponse, Provider } from "./provider.js";
import { countTokensAnthropic } from "./provider.js";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

function estimateTokenCost(
  input: number,
  output: number,
  model: string,
): { inputCost: number; outputCost: number } {
  // Pricing per million tokens
  const pricing: Record<string, { input: number; output: number }> = {
    // Anthropic
    "claude-opus-4-6-20250612": { input: 5, output: 25 },
    "claude-opus-4-5-20250414": { input: 5, output: 25 },
    "claude-opus-4-1-20250414": { input: 15, output: 75 },
    "claude-opus-4-20250514": { input: 15, output: 75 },
    "claude-sonnet-4-6-20250514": { input: 3, output: 15 },
    "claude-sonnet-4-5-20250514": { input: 3, output: 15 },
    "claude-sonnet-4-20250514": { input: 3, output: 15 },
    "claude-haiku-4-5-20251001": { input: 1, output: 5 },
    // OpenAI
    "gpt-5.4": { input: 3, output: 15 },
    "gpt-5.4-mini": { input: 0.4, output: 1.6 },
    "gpt-5.4-nano": { input: 0.1, output: 0.4 },
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
  };

  const p = pricing[model] ?? { input: 3, output: 15 };
  return {
    inputCost: (input / 1_000_000) * p.input,
    outputCost: (output / 1_000_000) * p.output,
  };
}

function roleToLabel(role: string): string {
  if (role === "system") return "System prompt";
  if (role === "assistant") return "AI response";
  return "User message";
}

function firstNWords(s: string, n: number): string {
  const words = s.split(/\s+/).slice(0, n);
  const result = words.join(" ");
  if (s.split(/\s+/).length > n) return result + "...";
  return result;
}

interface TokenBreakdownEntry {
  label: string;
  preview: string;
  tokens: number;
}

export async function countTokenBreakdown(
  provider: Provider,
  params: ChatParams,
): Promise<TokenBreakdownEntry[]> {
  if (provider === "openai") {
    return countTokenBreakdownOpenAI(params);
  }
  return countTokenBreakdownAnthropic(params);
}

function countTokenBreakdownOpenAI(params: ChatParams): TokenBreakdownEntry[] {
  const breakdown: TokenBreakdownEntry[] = [];

  // tiktoken: try the exact model, fall back to gpt-4o
  let tiktokenModel: TiktokenModel;
  try {
    tiktokenModel = params.model as TiktokenModel;
    encoding_for_model(tiktokenModel);
  } catch {
    tiktokenModel = "gpt-4o" as TiktokenModel;
  }
  const enc = encoding_for_model(tiktokenModel);

  // OpenAI chat format adds ~4 tokens per message (role, delimiters)
  const perMessageOverhead = 4;

  for (const msg of params.messages) {
    const tokens = enc.encode(msg.content).length + perMessageOverhead;
    const roleLabel = roleToLabel(msg.role);
    breakdown.push({
      label: roleLabel,
      preview: firstNWords(msg.content, 10),
      tokens,
    });
  }

  enc.free();
  return breakdown;
}

async function countTokenBreakdownAnthropic(
  params: ChatParams,
): Promise<TokenBreakdownEntry[]> {
  const breakdown: TokenBreakdownEntry[] = [];
  const { model, messages } = params;

  // Split system messages from conversation messages
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n") || undefined;
  const chatMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // Baseline: minimal request to isolate overhead
  const baselineTokens = await countTokensAnthropic(model, {
    messages: [{ role: "user", content: "." }],
  });
  let running = baselineTokens;

  // System prompt
  if (systemText) {
    const withSystem = await countTokensAnthropic(model, {
      system: systemText,
      messages: [{ role: "user", content: "." }],
    });
    const delta = withSystem - running;
    breakdown.push({
      label: "System prompt",
      preview: firstNWords(systemText, 10),
      tokens: delta,
    });
    running = withSystem;
  }

  // First chat message
  const firstMsg = chatMessages[0];
  const withFirst = await countTokensAnthropic(model, {
    system: systemText,
    messages: [firstMsg],
  });
  breakdown.push({
    label: roleToLabel(firstMsg.role),
    preview: firstNWords(firstMsg.content, 10),
    tokens: withFirst - running,
  });
  running = withFirst;

  // Remaining messages
  for (let i = 1; i < chatMessages.length; i++) {
    const slice = chatMessages.slice(0, i + 1);
    const result = await countTokensAnthropic(model, {
      system: systemText,
      messages: slice,
    });
    const delta = result - running;
    const msg = chatMessages[i];
    breakdown.push({
      label: roleToLabel(msg.role),
      preview: firstNWords(msg.content, 10),
      tokens: delta,
    });
    running = result;
  }

  return breakdown;
}

export function logResponse(
  response: ChatResponse,
  durationMs: number,
  breakdown?: TokenBreakdownEntry[],
) {
  const totalTokens = response.input_tokens + response.output_tokens;
  const { inputCost, outputCost } = estimateTokenCost(
    response.input_tokens,
    response.output_tokens,
    response.model,
  );
  const totalCost = inputCost + outputCost;

  console.log();
  console.log(bold("━━━ Response ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(response.text);
  console.log();

  // Performance
  console.log(bold("━━━ Performance ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(`  ${cyan("Provider")}         ${response.provider}`);
  console.log(`  ${cyan("Model")}            ${response.model}`);
  console.log(`  ${cyan("Stop reason")}      ${response.stop_reason}`);
  if (response.tool_calls_made != null) {
    console.log(`  ${cyan("Tool calls")}       ${response.tool_calls_made}`);
  }
  console.log(`  ${cyan("Duration")}         ${durationMs.toFixed(0)}ms`);
  const tokPerSec =
    durationMs > 0
      ? (response.output_tokens / (durationMs / 1000)).toFixed(1)
      : "N/A";
  console.log(`  ${cyan("Output speed")}     ${tokPerSec} tok/s`);
  console.log();

  // Token breakdown
  if (breakdown && breakdown.length > 0) {
    const outputPreview = firstNWords(response.text, 10);
    const allEntries = [
      ...breakdown,
      {
        label: "=> AI response (output)",
        preview: outputPreview,
        tokens: response.output_tokens,
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
    console.log(`  ${yellow("Input tokens")}     ${response.input_tokens}`);
    console.log(`  ${green("Output tokens")}    ${response.output_tokens}`);
    console.log(`  ${bold("Total tokens")}     ${totalTokens}`);
  } else {
    console.log(bold("━━━ Tokens ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(`  ${yellow("Input")}            ${response.input_tokens.toLocaleString()}`);
    console.log(`  ${green("Output")}           ${response.output_tokens.toLocaleString()}`);
    console.log(`  ${bold("Total")}            ${totalTokens.toLocaleString()}`);
  }

  if (response.cache_creation_input_tokens || response.cache_read_input_tokens) {
    console.log();
    console.log(bold("━━━ Cache ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(
      `  ${magenta("Cache write")}      ${(response.cache_creation_input_tokens ?? 0).toLocaleString()}`,
    );
    console.log(
      `  ${magenta("Cache read")}       ${(response.cache_read_input_tokens ?? 0).toLocaleString()}`,
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
