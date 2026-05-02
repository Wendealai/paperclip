import fs from "node:fs";
import { Router, type Request } from "express";
import { z } from "zod";
import { paperclipConfigSchema, type LlmConfig } from "@paperclipai/shared";
import { readConfigFile } from "../config-file.js";
import { resolvePaperclipConfigPath } from "../paths.js";
import { badRequest, forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";

const updateLlmConfigSchema = z.object({
  provider: z.enum(["claude", "openai"]).nullable(),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional().or(z.literal("")),
  clearApiKey: z.boolean().optional(),
});

type SafeLlmConfig = {
  provider: LlmConfig["provider"] | null;
  apiKeyConfigured: boolean;
  apiKeyPreview: string | null;
  baseUrl: string | null;
  updatedAt: string | null;
};

function assertInstanceAdmin(req: Request) {
  if (req.actor.type !== "board") throw forbidden("Board access required");
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
  throw forbidden("Instance admin required");
}

function previewSecret(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 8) return "***";
  return `...${trimmed.slice(-4)}`;
}

function toSafeLlmConfig(config: ReturnType<typeof readConfigFile>): SafeLlmConfig {
  const llm = config?.llm;
  return {
    provider: llm?.provider ?? null,
    apiKeyConfigured: Boolean(llm?.apiKey?.trim()),
    apiKeyPreview: previewSecret(llm?.apiKey),
    baseUrl: llm?.baseUrl ?? null,
    updatedAt: config?.$meta.updatedAt ?? null,
  };
}

function readRawConfig() {
  const configPath = resolvePaperclipConfigPath();
  if (!fs.existsSync(configPath)) throw badRequest("Instance config file not found");
  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown;
  const parsed = paperclipConfigSchema.parse(raw);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw badRequest("Instance config file must contain a JSON object");
  }
  return {
    configPath,
    raw: raw as Record<string, unknown>,
    parsed,
  };
}

export function instanceConfigRoutes() {
  const router = Router();

  router.get("/instance/llm", (req, res) => {
    assertInstanceAdmin(req);
    res.json(toSafeLlmConfig(readConfigFile()));
  });

  router.patch("/instance/llm", validate(updateLlmConfigSchema), (req, res) => {
    assertInstanceAdmin(req);
    const input = req.body as z.infer<typeof updateLlmConfigSchema>;
    const { configPath, raw, parsed } = readRawConfig();

    const next: Record<string, unknown> = {
      ...raw,
      $meta: {
        ...parsed.$meta,
        updatedAt: new Date().toISOString(),
        source: "configure",
      },
    };

    if (input.provider === null) {
      delete next.llm;
    } else {
      const previous = parsed.llm;
      const apiKey = input.clearApiKey ? undefined : input.apiKey?.trim() || previous?.apiKey;
      const baseUrl = input.baseUrl?.trim() || undefined;
      next.llm = {
        provider: input.provider,
        ...(apiKey ? { apiKey } : {}),
        ...(input.provider === "openai" && baseUrl ? { baseUrl } : {}),
      };
    }

    const validated = paperclipConfigSchema.parse(next);
    fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
    res.json(toSafeLlmConfig(validated));
  });

  return router;
}
