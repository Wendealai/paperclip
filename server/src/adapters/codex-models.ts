import type { AdapterModel } from "./types.js";
import { models as codexFallbackModels } from "@paperclipai/adapter-codex-local";
import { readConfigFile } from "../config-file.js";

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const OPENAI_MODELS_TIMEOUT_MS = 5000;
const OPENAI_MODELS_CACHE_TTL_MS = 60_000;

let cached: { cacheKey: string; expiresAt: number; models: AdapterModel[] } | null = null;

function fingerprint(apiKey: string): string {
  return `${apiKey.length}:${apiKey.slice(-6)}`;
}

function dedupeModels(models: AdapterModel[]): AdapterModel[] {
  const seen = new Set<string>();
  const deduped: AdapterModel[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push({ id, label: model.label.trim() || id });
  }
  return deduped;
}

function mergedWithFallback(models: AdapterModel[]): AdapterModel[] {
  return dedupeModels([
    ...models,
    ...codexFallbackModels,
  ]).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" }));
}

function normalizeOpenAiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.replace(/\/+$/, "") : OPENAI_DEFAULT_BASE_URL;
}

function resolveOpenAiConfig(): { apiKey: string; baseUrl: string } | null {
  const envKey = process.env.OPENAI_API_KEY?.trim();
  const envBaseUrl = process.env.OPENAI_BASE_URL?.trim();
  if (envKey) return { apiKey: envKey, baseUrl: normalizeOpenAiBaseUrl(envBaseUrl) };

  const config = readConfigFile();
  if (config?.llm?.provider !== "openai") return null;
  const configKey = config.llm.apiKey?.trim();
  return configKey && configKey.length > 0
    ? { apiKey: configKey, baseUrl: normalizeOpenAiBaseUrl(config.llm.baseUrl) }
    : null;
}

async function fetchOpenAiModels(input: { apiKey: string; baseUrl: string }): Promise<AdapterModel[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_MODELS_TIMEOUT_MS);
  try {
    const response = await fetch(`${input.baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) return [];

    const payload = (await response.json()) as { data?: unknown };
    const data = Array.isArray(payload.data) ? payload.data : [];
    const models: AdapterModel[] = [];
    for (const item of data) {
      if (typeof item !== "object" || item === null) continue;
      const id = (item as { id?: unknown }).id;
      if (typeof id !== "string" || id.trim().length === 0) continue;
      models.push({ id, label: id });
    }
    return dedupeModels(models);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function listCodexModels(): Promise<AdapterModel[]> {
  const openai = resolveOpenAiConfig();
  const fallback = dedupeModels(codexFallbackModels);
  if (!openai) return fallback;

  const now = Date.now();
  const cacheKey = `${openai.baseUrl}:${fingerprint(openai.apiKey)}`;
  if (cached && cached.cacheKey === cacheKey && cached.expiresAt > now) {
    return cached.models;
  }

  const fetched = await fetchOpenAiModels(openai);
  if (fetched.length > 0) {
    const merged = mergedWithFallback(fetched);
    cached = {
      cacheKey,
      expiresAt: now + OPENAI_MODELS_CACHE_TTL_MS,
      models: merged,
    };
    return merged;
  }

  if (cached && cached.cacheKey === cacheKey && cached.models.length > 0) {
    return cached.models;
  }

  return fallback;
}

export function resetCodexModelsCacheForTests() {
  cached = null;
}
