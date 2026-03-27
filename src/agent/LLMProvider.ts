export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type TokenCallback = (token: string) => void;

export interface LlmGenerateOptions {
  signal?: AbortSignal;
}

export interface ILLMProvider {
  generate(messages: ChatMessage[], options?: LlmGenerateOptions): Promise<string>;
  generateStream?(
    messages: ChatMessage[],
    onToken: TokenCallback,
    options?: LlmGenerateOptions
  ): Promise<string>;
}
