export interface LlmCompleteInput {
  context: string;
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  phase?: string;
}

export interface LlmCompleteResult {
  content: string;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface LlmProviderPort {
  complete(input: LlmCompleteInput): Promise<LlmCompleteResult>;
}
