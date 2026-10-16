import cron from "node-cron";

type ScheduledTask = {
  stop(): void;
};

type CronImpl = {
  schedule(
    cronExpression: string,
    run: () => Promise<void>,
    options: {
      name: string;
      timezone: string;
      noOverlap: boolean;
    },
  ): ScheduledTask;
};

type ScheduleJobInput = {
  cronExpression: string;
  timezone: string;
  run: () => Promise<void>;
  cronImpl?: CronImpl;
};

export function scheduleJob({
  cronExpression,
  timezone,
  run,
  cronImpl = cron,
}: ScheduleJobInput): ScheduledTask {
  return cronImpl.schedule(cronExpression, run, {
    name: "job-pulse",
    timezone,
    noOverlap: true,
  });
}
