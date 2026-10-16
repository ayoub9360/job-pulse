import pino, { type Logger } from "pino";

export type LogContext = Record<string, unknown>;

export type AppLogger = {
  debug(context: LogContext, message: string): void;
  info(context: LogContext, message: string): void;
  warn(context: LogContext, message: string): void;
  error(context: LogContext, message: string): void;
};

export const logger = pino({
  redact: {
    paths: [
      "authorization",
      "headers.authorization",
      "webhookUrl",
      "apiKey",
      "token",
      "password",
    ],
    censor: "[REDACTED]",
  },
  level:
    process.env.LOG_LEVEL ??
    (process.env.NODE_ENV === "test" ? "silent" : "info"),
}) as Logger & AppLogger;
