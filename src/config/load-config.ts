import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { logger } from "../shared/logger.js";
import { type AppConfig, appConfigSchema } from "./config.schema.js";

const DEFAULT_CONFIG_PATH = "config/config.yaml";

export async function loadConfig(
  configPath = process.env.CONFIG_PATH ?? DEFAULT_CONFIG_PATH,
): Promise<AppConfig> {
  let rawConfig: string;
  try {
    rawConfig = await readFile(configPath, "utf8");
  } catch {
    throw new Error(
      "Cannot read configuration. Copy config/config.example.yaml to config/config.yaml or set CONFIG_PATH.",
    );
  }
  const parsedConfig = YAML.parse(rawConfig);
  const result = appConfigSchema.safeParse(parsedConfig);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid config ${configPath}: ${issues}`);
  }

  logger.info(
    {
      configPath,
      enabledWatcherCount: result.data.watchers.filter(
        (watcher) => watcher.enabled,
      ).length,
      queryCount: result.data.watchers.reduce(
        (total, watcher) => total + watcher.queries.length,
        0,
      ),
      watcherCount: result.data.watchers.length,
    },
    "config loaded",
  );

  return result.data;
}
