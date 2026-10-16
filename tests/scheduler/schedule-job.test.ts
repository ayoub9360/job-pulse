import { describe, expect, it } from "vitest";
import { scheduleJob } from "../../src/scheduler/schedule-job.js";

describe("scheduleJob", () => {
  it("schedules a non-overlapping cron task", () => {
    const calls: unknown[] = [];
    const task = { stop: () => undefined };

    const scheduledTask = scheduleJob({
      cronExpression: "* * * * *",
      timezone: "Europe/Paris",
      run: async () => undefined,
      cronImpl: {
        schedule: (...args) => {
          calls.push(args);
          return task;
        },
      },
    });

    expect(scheduledTask).toBe(task);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject([
      "* * * * *",
      expect.any(Function),
      {
        name: "job-pulse",
        timezone: "Europe/Paris",
        noOverlap: true,
      },
    ]);
  });
});
