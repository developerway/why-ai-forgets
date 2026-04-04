import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export interface ChatParams {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
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
}

export type Provider = "anthropic" | "openai";

const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

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

async function chatAnthropic(params: ChatParams): Promise<ChatResponse> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: params.model,
    max_tokens: params.max_tokens,
    system: params.system,
    messages: params.messages,
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
  const messages: OpenAI.ChatCompletionMessageParam[] = [];

  if (params.system) {
    messages.push({ role: "system", content: params.system });
  }
  for (const msg of params.messages) {
    messages.push({ role: msg.role, content: msg.content });
  }

  const response = await client.chat.completions.create({
    model: params.model,
    max_completion_tokens: params.max_tokens,
    messages,
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
