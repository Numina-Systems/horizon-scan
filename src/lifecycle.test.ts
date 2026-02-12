import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import pino from "pino";
import { registerShutdownHandlers } from "./lifecycle";
import type { ShutdownDeps } from "./lifecycle";

describe("registerShutdownHandlers", () => {
  let mockLogger: pino.Logger;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = pino({ level: "silent" });
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should register SIGTERM and SIGINT handlers on process", () => {
    const scheduler1Stop = vi.fn() as any;
    const closeDb = vi.fn() as any;

    const deps: ShutdownDeps = {
      schedulers: [{ stop: scheduler1Stop }],
      closeDb,
      logger: mockLogger,
    };

    const onSpy = vi.spyOn(process, "on");
    registerShutdownHandlers(deps);

    expect(onSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
  });

  it("should call all scheduler stop() methods on SIGTERM", () => {
    const scheduler1Stop = vi.fn() as any;
    const scheduler2Stop = vi.fn() as any;
    const scheduler3Stop = vi.fn() as any;
    const closeDb = vi.fn() as any;

    const deps: ShutdownDeps = {
      schedulers: [
        { stop: scheduler1Stop },
        { stop: scheduler2Stop },
        { stop: scheduler3Stop },
      ],
      closeDb,
      logger: mockLogger,
    };

    const onSpy = vi.spyOn(process, "on");
    registerShutdownHandlers(deps);

    const sigTermHandler = onSpy.mock.calls.find(
      (call) => call[0] === "SIGTERM",
    )?.[1] as () => void;
    expect(sigTermHandler).toBeDefined();

    try {
      sigTermHandler();
    } catch {
      // process.exit throws
    }

    expect(scheduler1Stop).toHaveBeenCalled();
    expect(scheduler2Stop).toHaveBeenCalled();
    expect(scheduler3Stop).toHaveBeenCalled();
    expect(closeDb).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("should call all scheduler stop() methods on SIGINT", () => {
    const scheduler1Stop = vi.fn() as any;
    const scheduler2Stop = vi.fn() as any;
    const scheduler3Stop = vi.fn() as any;
    const closeDb = vi.fn() as any;

    const deps: ShutdownDeps = {
      schedulers: [
        { stop: scheduler1Stop },
        { stop: scheduler2Stop },
        { stop: scheduler3Stop },
      ],
      closeDb,
      logger: mockLogger,
    };

    const onSpy = vi.spyOn(process, "on");
    registerShutdownHandlers(deps);

    const sigIntHandler = onSpy.mock.calls.find(
      (call) => call[0] === "SIGINT",
    )?.[1] as () => void;
    expect(sigIntHandler).toBeDefined();

    try {
      sigIntHandler();
    } catch {
      // process.exit throws
    }

    expect(scheduler1Stop).toHaveBeenCalled();
    expect(scheduler2Stop).toHaveBeenCalled();
    expect(scheduler3Stop).toHaveBeenCalled();
    expect(closeDb).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("should call closeDb after stopping all schedulers", () => {
    const callOrder: string[] = [];

    const schedulerStop = vi.fn(() => {
      callOrder.push("scheduler.stop");
    }) as any;

    const closeDb = vi.fn(() => {
      callOrder.push("closeDb");
    }) as any;

    const deps: ShutdownDeps = {
      schedulers: [{ stop: schedulerStop }],
      closeDb,
      logger: mockLogger,
    };

    const onSpy = vi.spyOn(process, "on");
    registerShutdownHandlers(deps);

    const sigTermHandler = onSpy.mock.calls.find(
      (call) => call[0] === "SIGTERM",
    )?.[1] as () => void;

    try {
      sigTermHandler();
    } catch {
      // process.exit throws
    }

    expect(callOrder).toEqual(["scheduler.stop", "closeDb"]);
  });

  it("should prevent double shutdown (re-entrant guard)", () => {
    const scheduler1Stop = vi.fn() as any;
    const closeDb = vi.fn() as any;

    const deps: ShutdownDeps = {
      schedulers: [{ stop: scheduler1Stop }],
      closeDb,
      logger: mockLogger,
    };

    const onSpy = vi.spyOn(process, "on");
    registerShutdownHandlers(deps);

    const sigTermHandler = onSpy.mock.calls.find(
      (call) => call[0] === "SIGTERM",
    )?.[1] as () => void;

    // First call should execute
    try {
      sigTermHandler();
    } catch {
      // process.exit throws
    }

    expect(closeDb).toHaveBeenCalledTimes(1);

    // Second call should be ignored
    closeDb.mockClear();
    scheduler1Stop.mockClear();

    try {
      sigTermHandler();
    } catch {
      // process.exit throws (from first call)
    }

    expect(scheduler1Stop).not.toHaveBeenCalled();
    expect(closeDb).not.toHaveBeenCalled();
  });

  it("should continue shutting down if scheduler stop() throws", () => {
    const throwingSchedulerStop = vi.fn(() => {
      throw new Error("Scheduler stop failed");
    }) as any;

    const workingSchedulerStop = vi.fn() as any;
    const closeDb = vi.fn() as any;

    const deps: ShutdownDeps = {
      schedulers: [
        { stop: throwingSchedulerStop },
        { stop: workingSchedulerStop },
      ],
      closeDb,
      logger: mockLogger,
    };

    const onSpy = vi.spyOn(process, "on");
    registerShutdownHandlers(deps);

    const sigTermHandler = onSpy.mock.calls.find(
      (call) => call[0] === "SIGTERM",
    )?.[1] as () => void;

    try {
      sigTermHandler();
    } catch {
      // process.exit throws
    }

    expect(throwingSchedulerStop).toHaveBeenCalled();
    expect(workingSchedulerStop).toHaveBeenCalled();
    expect(closeDb).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("should continue shutting down if closeDb throws", () => {
    const schedulerStop = vi.fn() as any;

    const throwingCloseDb = vi.fn(() => {
      throw new Error("Database close failed");
    }) as any;

    const deps: ShutdownDeps = {
      schedulers: [{ stop: schedulerStop }],
      closeDb: throwingCloseDb,
      logger: mockLogger,
    };

    const onSpy = vi.spyOn(process, "on");
    registerShutdownHandlers(deps);

    const sigTermHandler = onSpy.mock.calls.find(
      (call) => call[0] === "SIGTERM",
    )?.[1] as () => void;

    try {
      sigTermHandler();
    } catch {
      // process.exit throws
    }

    expect(schedulerStop).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("should log shutdown phases", () => {
    const loggedMessages: Array<{ level: string; message: string }> = [];
    const testLogger = pino(
      {
        level: "info",
        formatters: {
          level(label: string) {
            return { level: label };
          },
        },
      },
      {
        write: (msg: string) => {
          const parsed = JSON.parse(msg);
          loggedMessages.push({
            level: parsed.level,
            message: parsed.msg,
          });
        },
      } as any,
    );

    const schedulerStop = vi.fn() as any;
    const closeDb = vi.fn() as any;

    const deps: ShutdownDeps = {
      schedulers: [{ stop: schedulerStop }],
      closeDb,
      logger: testLogger,
    };

    const onSpy = vi.spyOn(process, "on");
    registerShutdownHandlers(deps);

    const sigTermHandler = onSpy.mock.calls.find(
      (call) => call[0] === "SIGTERM",
    )?.[1] as () => void;

    try {
      sigTermHandler();
    } catch {
      // process.exit throws
    }

    expect(loggedMessages.some((m) => m.message === "shutdown signal received")).toBe(
      true,
    );
    expect(loggedMessages.some((m) => m.message === "database connection closed")).toBe(
      true,
    );
    expect(loggedMessages.some((m) => m.message === "shutdown complete")).toBe(
      true,
    );
  });

  it("should handle scheduler errors gracefully by logging them", () => {
    const loggedErrors: Array<{ level: string; message: string }> = [];
    const testLogger = pino(
      {
        level: "error",
        formatters: {
          level(label: string) {
            return { level: label };
          },
        },
      },
      {
        write: (msg: string) => {
          const parsed = JSON.parse(msg);
          if (parsed.level === "error") {
            loggedErrors.push({
              level: parsed.level,
              message: parsed.msg,
            });
          }
        },
      } as any,
    );

    const throwingSchedulerStop = vi.fn(() => {
      throw new Error("Scheduler error message");
    }) as any;

    const closeDb = vi.fn() as any;

    const deps: ShutdownDeps = {
      schedulers: [{ stop: throwingSchedulerStop }],
      closeDb,
      logger: testLogger,
    };

    const onSpy = vi.spyOn(process, "on");
    registerShutdownHandlers(deps);

    const sigTermHandler = onSpy.mock.calls.find(
      (call) => call[0] === "SIGTERM",
    )?.[1] as () => void;

    try {
      sigTermHandler();
    } catch {
      // process.exit throws
    }

    expect(loggedErrors.some((e) => e.message === "error stopping scheduler")).toBe(
      true,
    );
  });

  it("should exit with code 0 on successful shutdown", () => {
    const schedulerStop = vi.fn() as any;
    const closeDb = vi.fn() as any;

    const deps: ShutdownDeps = {
      schedulers: [{ stop: schedulerStop }],
      closeDb,
      logger: mockLogger,
    };

    const onSpy = vi.spyOn(process, "on");
    registerShutdownHandlers(deps);

    const sigTermHandler = onSpy.mock.calls.find(
      (call) => call[0] === "SIGTERM",
    )?.[1] as () => void;

    try {
      sigTermHandler();
    } catch {
      // process.exit throws
    }

    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
