import { api } from "./client";

export type InstanceLlmProvider = "openai" | "claude";

export interface InstanceLlmConfig {
  provider: InstanceLlmProvider | null;
  apiKeyConfigured: boolean;
  apiKeyPreview: string | null;
  baseUrl: string | null;
  updatedAt: string | null;
}

export interface UpdateInstanceLlmConfig {
  provider: InstanceLlmProvider | null;
  apiKey?: string;
  baseUrl?: string;
  clearApiKey?: boolean;
}

export const instanceApi = {
  getLlm: () => api.get<InstanceLlmConfig>("/instance/llm"),
  updateLlm: (data: UpdateInstanceLlmConfig) =>
    api.patch<InstanceLlmConfig>("/instance/llm", data),
};
