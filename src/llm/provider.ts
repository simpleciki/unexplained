export type ProviderStatus = "online" | "unauthorized" | "offline";

export type ProviderErrorKind = "timeout" | "http" | "unauthorized" | "offline";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;

  constructor(kind: ProviderErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.status = status;
  }
}

export interface ChatRequest {
  model: string;
  system?: string;
  user: string;
  temperature?: number;
}

export interface ChatResult {
  text: string;
  model: string;
  latencyMs: number;
}

export interface ChatProvider {
  id: string;
  status(): Promise<ProviderStatus>;
  listModels(): Promise<string[]>;
  chat(req: ChatRequest): Promise<ChatResult>;
}
