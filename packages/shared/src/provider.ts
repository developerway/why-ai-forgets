import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export type MessageRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: MessageRole;
  content: string;
}

export interface ChatParams {
  model: string;
  max_tokens: number;
  messages: ChatMessage[];
  // Anthropic-only. Omit to run without extended thinking.
  thinking?: Anthropic.Messages.ThinkingConfigParam;
  // Anthropic-only. Omit to let the server pick its default effort.
  output_config?: Anthropic.Messages.OutputConfig;
}

export interface ChatResponse {
  text: string;
  model: string;
  provider: "anthropic" | "openai";
  stop_reason: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  tool_calls_made?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ToolHandler = (
  name: string,
  input: Record<string, unknown>,
) => Promise<string>;

export interface ChatWithToolsParams extends ChatParams {
  tools: ToolDefinition[];
}

export type Provider = "anthropic" | "openai";

const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";

export function getDefaultModel(provider: Provider): string {
  return provider === "openai" ? DEFAULT_OPENAI_MODEL : DEFAULT_ANTHROPIC_MODEL;
}

export async function chat(
  provider: Provider,
  params: ChatParams,
): Promise<ChatResponse> {
  if (provider === "openai") {
    return chatOpenAI(params);
  }
  return chatAnthropic(params);
}

function extractSystemAndMessages(messages: ChatMessage[]): {
  system: string | undefined;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");

  const rest = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  return { system: system || undefined, messages: rest };
}

async function chatAnthropic(params: ChatParams): Promise<ChatResponse> {
  const client = new Anthropic();
  const { system, messages } = extractSystemAndMessages(params.messages);

  const response = await client.messages.create({
    model: params.model,
    max_tokens: params.max_tokens,
    system,
    messages,
    ...(params.thinking ? { thinking: params.thinking } : {}),
    ...(params.output_config ? { output_config: params.output_config } : {}),
  });

  const thinking = response.content
    .filter((b): b is Anthropic.ThinkingBlock => b.type === "thinking")
    .map((b) => b.thinking)
    .filter((t) => t.length > 0)
    .join("\n");

  const answer = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  const text = thinking
    ? `${bold("💭 Thinking (summarized):")}\n${dim(thinking)}\n\n${bold("━━━ Answer ━━━")}\n${answer}`
    : answer;

  return {
    text,
    model: response.model,
    provider: "anthropic",
    stop_reason: response.stop_reason ?? "unknown",
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
  };
}

async function chatOpenAI(params: ChatParams): Promise<ChatResponse> {
  const client = new OpenAI();

  const response = await client.chat.completions.create({
    model: params.model,
    max_completion_tokens: params.max_tokens,
    messages: params.messages,
  });

  const choice = response.choices[0];
  return {
    text: choice?.message?.content ?? "",
    model: response.model,
    provider: "openai",
    stop_reason: choice?.finish_reason ?? "unknown",
    input_tokens: response.usage?.prompt_tokens ?? 0,
    output_tokens: response.usage?.completion_tokens ?? 0,
  };
}

export async function chatWithTools(
  provider: Provider,
  params: ChatWithToolsParams,
  handler: ToolHandler,
): Promise<ChatResponse> {
  if (provider === "openai") {
    return chatWithToolsOpenAI(params, handler);
  }
  return chatWithToolsAnthropic(params, handler);
}

// Recursively truncate any string longer than `max` chars, preserving object/array structure.
// Used for debug logging so the full message shape is visible without dumping huge article bodies.
function truncateStrings(value: unknown, max = 100): unknown {
  if (typeof value === "string") {
    return value.length > max
      ? `${value.slice(0, max)}…(+${value.length - max} chars)`
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => truncateStrings(v, max));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = truncateStrings(v, max);
    }
    return out;
  }
  return value;
}

function truncateForLog(s: string, max = 100): string {
  return s.length > max ? `${s.slice(0, max)}…(+${s.length - max} chars)` : s;
}

async function chatWithToolsAnthropic(
  params: ChatWithToolsParams,
  handler: ToolHandler,
): Promise<ChatResponse> {
  console.log("\n========== chatWithToolsAnthropic: START ==========");
  console.log(`[setup] model=${params.model}, max_tokens=${params.max_tokens}`);
  console.log(`[setup] initial messages: ${params.messages.length}`);
  console.log(
    `[setup] tools available (${params.tools.length}): ${params.tools
      .map((t) => t.name)
      .join(", ")}`,
  );
  console.log("[setup] FULL tool definitions sent to Claude (long strings truncated):");
  console.dir(truncateStrings(params.tools), { depth: null });

  const client = new Anthropic();
  const { system, messages: initialMsgs } = extractSystemAndMessages(
    params.messages,
  );

  console.log(
    `[setup] system prompt: ${system ? `${system.length} chars` : "(none)"}`,
  );
  if (system) {
    console.log("[setup] FULL system prompt (truncated):");
    console.log(truncateForLog(system));
  }
  console.log(`[setup] non-system messages passed to API: ${initialMsgs.length}`);

  const tools = params.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Messages.Tool.InputSchema,
  }));

  const messages: Anthropic.Messages.MessageParam[] = [...initialMsgs];
  let totalInput = 0;
  let totalOutput = 0;
  let toolCallsMade = 0;
  let finalText = "";
  let lastResponse!: Anthropic.Messages.Message;
  let turn = 0;

  while (true) {
    turn++;
    console.log(`\n---------- Turn ${turn} ----------`);
    console.log(
      `[turn ${turn}] → sending ${messages.length} messages to Claude`,
    );
    console.log(`[turn ${turn}] FULL messages array being sent (long strings truncated):`);
    console.dir(truncateStrings(messages), { depth: null });

    const response = await client.messages.create({
      model: params.model,
      max_tokens: params.max_tokens,
      system,
      tools,
      messages,
      ...(params.thinking ? { thinking: params.thinking } : {}),
      ...(params.output_config ? { output_config: params.output_config } : {}),
    });

    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;
    lastResponse = response;

    console.log(
      `[turn ${turn}] ← response: stop_reason=${response.stop_reason}, ` +
        `input_tokens=${response.usage.input_tokens}, ` +
        `output_tokens=${response.usage.output_tokens}`,
    );
    console.log(
      `[turn ${turn}] content blocks: ${response.content
        .map((b) => b.type)
        .join(", ")}`,
    );
    console.log(`[turn ${turn}] FULL response from Claude (long strings truncated):`);
    console.dir(truncateStrings(response), { depth: null });

    // Thinking blocks appear BEFORE tool_use in the same response. With
    // adaptive thinking + tools, Claude also produces a fresh thinking block
    // on the turn AFTER a tool_result, reasoning about what came back.
    const thinkingBlocks = response.content
      .filter((b): b is Anthropic.Messages.ThinkingBlock => b.type === "thinking")
      .map((b) => b.thinking)
      .filter((t) => t.length > 0);
    if (thinkingBlocks.length > 0) {
      const joined = thinkingBlocks.join("\n");
      console.log(`[turn ${turn}] 💭 thinking (summarized):`);
      console.log(`\x1b[2m${joined}\x1b[0m`);
      finalText += `\x1b[1m💭 Turn ${turn} thinking:\x1b[0m\n\x1b[2m${joined}\x1b[0m\n\n`;
    }

    const textBlocks = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text);
    if (textBlocks.length > 0) {
      const joined = textBlocks.join("\n");
      finalText += joined;
      console.log(`[turn ${turn}] FULL text from model (truncated):`);
      console.log(truncateForLog(joined));
    }

    if (response.stop_reason !== "tool_use") {
      console.log(
        `[turn ${turn}] no more tool_use — exiting loop (stop_reason=${response.stop_reason})`,
      );
      break;
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );
    console.log(
      `[turn ${turn}] model requested ${toolUses.length} tool call(s): ${toolUses
        .map((tu) => tu.name)
        .join(", ")}`,
    );

    // Preserve the assistant's full response (text + tool_use blocks) in history
    // so Claude can reference its own reasoning + tool_use_ids on the next turn.
    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      console.log(
        `[turn ${turn}]   → executing tool "${tu.name}" (id=${tu.id})`,
      );
      console.log(`[turn ${turn}]     FULL input from model (long strings truncated):`);
      console.dir(truncateStrings(tu.input), { depth: null });
      const result = await handler(
        tu.name,
        tu.input as Record<string, unknown>,
      );
      console.log(
        `[turn ${turn}]   ← tool "${tu.name}" returned ${result.length} chars. Result (truncated):`,
      );
      console.log(truncateForLog(result));
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: result,
      });
      toolCallsMade++;
    }

    // Tool results are sent back as a user message — this is how Claude sees them.
    messages.push({ role: "user", content: toolResults });
    console.log(
      `[turn ${turn}] appended ${toolResults.length} tool_result(s) as user message; looping back to model`,
    );
  }

  console.log(`\n========== chatWithToolsAnthropic: DONE ==========`);
  console.log(
    `[summary] turns=${turn}, tool_calls=${toolCallsMade}, ` +
      `total_input_tokens=${totalInput}, total_output_tokens=${totalOutput}`,
  );
  console.log(`[summary] final text length: ${finalText.length} chars\n`);

  return {
    text: finalText,
    model: lastResponse.model,
    provider: "anthropic",
    stop_reason: lastResponse.stop_reason ?? "unknown",
    input_tokens: totalInput,
    output_tokens: totalOutput,
    tool_calls_made: toolCallsMade,
  };
}

async function chatWithToolsOpenAI(
  params: ChatWithToolsParams,
  handler: ToolHandler,
): Promise<ChatResponse> {
  const client = new OpenAI();

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = params.tools.map(
    (t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }),
  );

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
    params.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

  let totalInput = 0;
  let totalOutput = 0;
  let toolCallsMade = 0;
  let finalText = "";
  let lastResponse!: OpenAI.Chat.Completions.ChatCompletion;

  while (true) {
    const response = await client.chat.completions.create({
      model: params.model,
      max_completion_tokens: params.max_tokens,
      tools,
      messages,
    });

    totalInput += response.usage?.prompt_tokens ?? 0;
    totalOutput += response.usage?.completion_tokens ?? 0;
    lastResponse = response;

    const choice = response.choices[0];
    if (choice.message.content) finalText += choice.message.content;

    // No tool calls — we're done
    if (
      choice.finish_reason !== "tool_calls" ||
      !choice.message.tool_calls?.length
    )
      break;

    messages.push(choice.message);

    for (const tc of choice.message.tool_calls) {
      if (tc.type !== "function") continue;
      const args = JSON.parse(tc.function.arguments);
      const result = await handler(tc.function.name, args);
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
      toolCallsMade++;
    }
  }

  return {
    text: finalText,
    model: lastResponse.model,
    provider: "openai",
    stop_reason: lastResponse.choices[0]?.finish_reason ?? "unknown",
    input_tokens: totalInput,
    output_tokens: totalOutput,
    tool_calls_made: toolCallsMade,
  };
}

export async function countTokensAnthropic(
  model: string,
  params: {
    system?: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  },
): Promise<number> {
  const client = new Anthropic();
  const result = await client.messages.countTokens({
    model,
    messages: params.messages,
    system: params.system,
  });
  return result.input_tokens;
}
