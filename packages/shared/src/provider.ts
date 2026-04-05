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
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

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

async function chatWithToolsAnthropic(
  params: ChatWithToolsParams,
  handler: ToolHandler,
): Promise<ChatResponse> {
  const client = new Anthropic();
  const { system, messages: initialMsgs } = extractSystemAndMessages(
    params.messages,
  );

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

  while (true) {
    const response = await client.messages.create({
      model: params.model,
      max_tokens: params.max_tokens,
      system,
      tools,
      messages,
    });

    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;
    lastResponse = response;

    const textBlocks = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text);
    if (textBlocks.length > 0) finalText += textBlocks.join("\n");

    if (response.stop_reason !== "tool_use") break;

    const toolUses = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const result = await handler(
        tu.name,
        tu.input as Record<string, unknown>,
      );
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: result,
      });
      toolCallsMade++;
    }

    messages.push({ role: "user", content: toolResults });
  }

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
