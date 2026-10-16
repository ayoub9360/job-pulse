import cron from "node-cron";
import { z } from "zod";

const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  }, "Expected an HTTP(S) URL without credentials");
const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Invalid timezone");

const remoteModeSchema = z.enum(["full", "partial", "onsite", "unknown"]);

const freeWorkConfigSchema = z.object({
  baseUrl: httpUrlSchema,
});

const pyloteConfigSchema = z.object({
  baseUrl: httpUrlSchema,
});

const providerIdSchema = z.enum(["free-work", "pylote", "collective"]);

const watcherConfigSchema = z.object({
  name: z.string().trim().min(1),
  provider: z.union([
    providerIdSchema,
    z
      .array(providerIdSchema)
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length, "Duplicate providers"),
  ]),
  enabled: z.boolean().default(true),
  mentionHere: z.boolean().optional(),
  queries: z.array(z.string().trim().min(1)).min(1),
  requiredKeywordGroups: z
    .array(z.array(z.string().trim().min(1)).min(1))
    .default([]),
  requiredKeywordScope: z.enum(["offer", "title-skills"]).default("offer"),
  requiredTitleKeywords: z.array(z.string().trim().min(1)).default([]),
  excludedTitleKeywords: z.array(z.string().trim().min(1)).optional(),
  contracts: z.array(z.string().trim().min(1)).default([]),
  minDailyRate: z.number().int().positive().nullable().default(null),
  remote: z.array(remoteModeSchema).default([]),
  locations: z.array(z.string().trim().min(1)).default([]),
  excludedKeywords: z
    .array(
      z.union([
        z.string().trim().min(1),
        z.object({
          keyword: z.string().trim().min(1),
          match: z.enum(["substring", "whole-word"]),
        }),
      ]),
    )
    .default([]),
  maxPages: z.number().int().min(1).max(10).default(1),
  webhookEnv: z.string().trim().min(1),
});

const watchersConfigSchema = z
  .array(watcherConfigSchema)
  .min(1)
  .superRefine((watchers, context) => {
    const seenWatcherNames = new Set<string>();

    for (const [index, watcher] of watchers.entries()) {
      if (seenWatcherNames.has(watcher.name)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Watcher names must be unique",
          path: [index, "name"],
        });
      }

      seenWatcherNames.add(watcher.name);
    }
  });

export const appConfigSchema = z
  .object({
    providers: z.object({
      freeWork: freeWorkConfigSchema.optional(),
      pylote: pyloteConfigSchema.optional(),
      collective: z
        .object({
          baseUrl: httpUrlSchema,
          userAgent: z.string().min(1).default("job-pulse/0.1"),
        })
        .optional(),
    }),
    watchers: watchersConfigSchema,
    schedule: z.object({
      cron: z
        .string()
        .trim()
        .min(1)
        .refine(cron.validate, "Invalid cron expression"),
      timezone: timezoneSchema.default("Europe/Paris"),
    }),
    runtime: z.object({
      userAgent: z.string().trim().min(1),
      requestTimeoutMs: z.number().int().positive().default(10_000),
      retryCount: z.number().int().min(0).max(5).default(1),
      maxNotificationsPerRun: z.number().int().positive().default(20),
    }),
  })
  .superRefine((config, context) => {
    if (
      config.watchers.some(
        (watcher) =>
          watcher.enabled && [watcher.provider].flat().includes("collective"),
      ) &&
      !config.providers.collective
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "providers.collective is required when a watcher uses collective",
        path: ["providers", "collective"],
      });
    }
    if (
      config.watchers.some(
        (w) => w.enabled && [w.provider].flat().includes("free-work"),
      ) &&
      !config.providers.freeWork
    ) {
      context.addIssue({
        code: "custom",
        message: "providers.freeWork is required for active free-work watchers",
        path: ["providers", "freeWork"],
      });
    }
    const usesPylote = config.watchers.some(
      (watcher) =>
        watcher.enabled && [watcher.provider].flat().includes("pylote"),
    );

    if (usesPylote && !config.providers.pylote) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "providers.pylote is required when a watcher uses pylote",
        path: ["providers", "pylote"],
      });
    }
  });

export type AppConfig = z.infer<typeof appConfigSchema>;
