import "dotenv/config";
import { loadConfig } from "./config/load-config.js";

loadConfig()
  .then(() => {
    console.log(
      "Configuration valid (no network requests or notifications sent).",
    );
  })
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Invalid configuration",
    );
    process.exitCode = 1;
  });
