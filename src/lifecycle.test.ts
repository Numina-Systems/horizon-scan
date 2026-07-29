import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Logger } from "pino";
import type { Server } from "node:http";
import { registerShutdownHandlers } from "./lifecycle";
import type { ShutdownDeps } from "./lifecycle";

// Shared mock logger with warn spy
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger & { warn: ReturnType<typeof vi.fn> };

function createMockHttpServer(callbackFn?: () => void) {
  return {
    close: vi.fn((cb?: (err?: Error) => void) => {
      callbackFn?.();
      cb?.();
    }),
  } as unknown as Server;
}

function createMockDrain() {
  return vi.fn(async () => {});
}

describe("registerShutdownHandlers", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should register SIGTERM and SIGINT handlers on process", () => {
    const onSpy = vi.spyOn(process, "on");
    registerShutdownHandlers({
      schedulers: [],
      closeDb: vi.fn(),
      logger: mockLogger,
      httpServer: createMockHttpServer(),
      drain: createMockDrain(),
    });

    expect(onSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
  });

  it("should call all scheduler stop() methods on SIGTERM", async () => {
    const stop1 = vi.fn();
    const stop2 = vi.fn();
    const closeDb = vi.fn();

    const shutdown = registerShutdownHandlers({
      schedulers: [{ stop: stop1 }, { stop: stop2 }],
      closeDb,
      logger: mockLogger,
      httpServer: createMockHttpServer(),
      drain: createMockDrain(),
    });

    try {
      await shutdown("SIGTERM");
    } catch {
      // process.exit throws
    }

    expect(stop1).toHaveBeenCalledTimes(1);
    expect(stop2).toHaveBeenCalledTimes(1);
    expect(closeDb).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("should call all scheduler stop() methods on SIGINT", async () => {
    const stop1 = vi.fn();
    const stop2 = vi.fn();
    const closeDb = vi.fn();

    const shutdown = registerShutdownHandlers({
      schedulers: [{ stop: stop1 }, { stop: stop2 }],
      closeDb,
      logger: mockLogger,
      httpServer: createMockHttpServer(),
      drain: createMockDrain(),
    });

    try {
      await shutdown("SIGINT");
    } catch {
      // process.exit throws
    }

    expect(stop1).toHaveBeenCalledTimes(1);
    expect(stop2).toHaveBeenCalledTimes(1);
    expect(closeDb).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("should call closeDb after stopping all schedulers", async () => {
    const callOrder: Array<string> = [];

    const shutdown = registerShutdownHandlers({
      schedulers: [
        {
          stop: vi.fn(() => {
            callOrder.push("scheduler.stop");
          }),
        },
      ],
      closeDb: vi.fn(() => {
        callOrder.push("closeDb");
      }),
      logger: mockLogger,
      httpServer: createMockHttpServer(),
      drain: createMockDrain(),
    });

    try {
      await shutdown("SIGTERM");
    } catch {
      // process.exit throws
    }

    expect(callOrder).toEqual(["scheduler.stop", "closeDb"]);
  });

  it("should prevent double shutdown (re-entrant guard) (AC.D.5)", async () => {
    const schedulerStop = vi.fn();
    const closeDb = vi.fn();

    const shutdown = registerShutdownHandlers({
      schedulers: [{ stop: schedulerStop }],
      closeDb,
      logger: mockLogger,
      httpServer: createMockHttpServer(),
      drain: createMockDrain(),
    });

    // First call should execute
    try {
      await shutdown("SIGTERM");
    } catch {
      // process.exit throws
    }
    expect(closeDb).toHaveBeenCalledTimes(1);

    // Second call should be a no-op
    closeDb.mockClear();
    schedulerStop.mockClear();

    // Second call returns immediately (re-entrant guard fires before any work)
    await shutdown("SIGTERM");
    expect(schedulerStop).not.toHaveBeenCalled();
    expect(closeDb).not.toHaveBeenCalled();
  });

  it("should continue shutting down if scheduler stop() throws", async () => {
    const throwingStop = vi.fn(() => {
      throw new Error("Scheduler stop failed");
    });
    const workingStop = vi.fn();
    const closeDb = vi.fn();

    const shutdown = registerShutdownHandlers({
      schedulers: [{ stop: throwingStop }, { stop: workingStop }],
      closeDb,
      logger: mockLogger,
      httpServer: createMockHttpServer(),
      drain: createMockDrain(),
    });

    try {
      await shutdown("SIGTERM");
    } catch {
      // process.exit throws
    }

    expect(throwingStop).toHaveBeenCalled();
    expect(workingStop).toHaveBeenCalled();
    expect(closeDb).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("should continue shutting down if closeDb throws", async () => {
    const throwingCloseDb = vi.fn(() => {
      throw new Error("Database close failed");
    });

    const shutdown = registerShutdownHandlers({
      schedulers: [{ stop: vi.fn() }],
      closeDb: throwingCloseDb,
      logger: mockLogger,
      httpServer: createMockHttpServer(),
      drain: createMockDrain(),
    });

    try {
      await shutdown("SIGTERM");
    } catch {
      // process.exit throws
    }

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("should log shutdown phases", async () => {
    const loggedMessages: Array<{ level: string; message: string }> = [];
    const testLogger = {
      info: vi.fn((objOrMsg?: any, msg?: string) => {
        const message = msg ?? (typeof objOrMsg === "string" ? objOrMsg : "");
        loggedMessages.push({ level: "info", message });
      }),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    const shutdown = registerShutdownHandlers({
      schedulers: [{ stop: vi.fn() }],
      closeDb: vi.fn(),
      logger: testLogger,
      httpServer: createMockHttpServer(),
      drain: createMockDrain(),
    });

    try {
      await shutdown("SIGTERM");
    } catch {
      // process.exit throws
    }

    expect(
      loggedMessages.some((m) => m.message === "shutdown signal received"),
    ).toBe(true);
    expect(
      loggedMessages.some((m) => m.message === "schedulers stopped"),
    ).toBe(true);
    expect(
      loggedMessages.some((m) => m.message === "database connection closed"),
    ).toBe(true);
    expect(
      loggedMessages.some((m) => m.message === "shutdown complete"),
    ).toBe(true);
  });

  it("should handle scheduler errors gracefully by logging them", async () => {
    const errorMessages: Array<string> = [];
    const testLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn((_obj?: any, msg?: string) => {
        if (typeof msg === "string") errorMessages.push(msg);
      }),
    } as unknown as Logger;

    const shutdown = registerShutdownHandlers({
      schedulers: [
        {
          stop: vi.fn(() => {
            throw new Error("Scheduler error message");
          }),
        },
      ],
      closeDb: vi.fn(),
      logger: testLogger,
      httpServer: createMockHttpServer(),
      drain: createMockDrain(),
    });

    try {
      await shutdown("SIGTERM");
    } catch {
      // process.exit throws
    }

    expect(errorMessages.some((e) => e === "error stopping scheduler")).toBe(
      true,
    );
  });

  it("should exit with code 0 on successful shutdown", async () => {
    const shutdown = registerShutdownHandlers({
      schedulers: [{ stop: vi.fn() }],
      closeDb: vi.fn(),
      logger: mockLogger,
      httpServer: createMockHttpServer(),
      drain: createMockDrain(),
    });

    try {
      await shutdown("SIGTERM");
    } catch {
      // process.exit throws
    }

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  // --- AC.D.1 through AC.D.6 ---

  it("should stop all schedulers before draining active jobs (AC.D.1)", async () => {
    const callOrder: Array<string> = [];
    const schedulerStop = vi.fn(() => {
      callOrder.push("scheduler.stop");
    });
    const drain = vi.fn(async () => {
      callOrder.push("drain.complete");
    });
    const closeDb = vi.fn(() => {
      callOrder.push("closeDb");
    });

    const shutdown = registerShutdownHandlers({
      schedulers: [{ stop: schedulerStop }],
      closeDb,
      logger: mockLogger,
      httpServer: createMockHttpServer(),
      drain,
      drainTimeoutMs: 5000,
    });

    try {
      await shutdown("SIGTERM");
    } catch {
      // process.exit throws
    }

    expect(callOrder).toEqual(["scheduler.stop", "drain.complete", "closeDb"]);
    expect(schedulerStop).toHaveBeenCalledBefore(drain);
  });

  it("should await active jobs before closing DB (AC.D.2)", async () => {
    let drainResolved = false;
    const drain = vi.fn(async () => {
      await new Promise<void>((r) => setTimeout(r, 50));
      drainResolved = true;
    });
    let dbClosedBeforeDrain = false;
    const closeDb = vi.fn(() => {
      if (!drainResolved) dbClosedBeforeDrain = true;
    });

    const shutdown = registerShutdownHandlers({
      schedulers: [{ stop: vi.fn() }],
      closeDb,
      logger: mockLogger,
      httpServer: createMockHttpServer(),
      drain,
      drainTimeoutMs: 5000,
    });

    try {
      await shutdown("SIGTERM");
    } catch {
      // process.exit throws
    }

    expect(drainResolved).toBe(true);
    expect(dbClosedBeforeDrain).toBe(false);
    expect(closeDb).toHaveBeenCalled();
  });

  it("should close HTTP server before database (AC.D.3)", async () => {
    const callOrder: Array<string> = [];

    const mockHttpServer = {
      close: vi.fn((cb?: (err?: Error) => void) => {
        callOrder.push("httpServer.close");
        cb?.();
      }),
    } as unknown as Server;

    const closeDb = vi.fn(() => {
      callOrder.push("closeDb");
    });

    const shutdown = registerShutdownHandlers({
      schedulers: [{ stop: vi.fn() }],
      closeDb,
      logger: mockLogger,
      httpServer: mockHttpServer,
      drain: createMockDrain(),
    });

    try {
      await shutdown("SIGTERM");
    } catch {
      // process.exit throws
    }

    expect(mockHttpServer.close).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["httpServer.close", "closeDb"]);
  });

  it("should exit nonzero when drain times out (AC.D.4)", async () => {
    const drain = vi.fn(async () => {
      await new Promise<void>(() => {
        /* never resolves */
      });
    });
    const closeDb = vi.fn();
    const warnSpy = mockLogger.warn as ReturnType<typeof vi.fn>;
    warnSpy.mockClear();

    const shutdown = registerShutdownHandlers({
      schedulers: [{ stop: vi.fn() }],
      closeDb,
      logger: mockLogger,
      httpServer: createMockHttpServer(),
      drain,
      drainTimeoutMs: 50,
    });

    try {
      await shutdown("SIGTERM");
    } catch {
      // process.exit throws
    }

    expect(closeDb).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);

    // Assert logger.warn was called with timeout context
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ drainTimeoutMs: 50 }),
      expect.stringContaining("drain"),
    );
  });

  it("should execute full shutdown sequence in order: scheduler.stop → httpServer.close → drain → closeDb (AC.D.6)", async () => {
    const callOrder: Array<string> = [];

    const schedulerStop = vi.fn(() => {
      callOrder.push("scheduler.stop");
    });

    const mockHttpServer = {
      close: vi.fn((cb?: (err?: Error) => void) => {
        callOrder.push("httpServer.close");
        cb?.();
      }),
    } as unknown as Server;

    const drain = vi.fn(async () => {
      callOrder.push("drain");
    });
    const closeDb = vi.fn(() => {
      callOrder.push("closeDb");
    });

    const shutdown = registerShutdownHandlers({
      schedulers: [{ stop: schedulerStop }],
      closeDb,
      logger: mockLogger,
      httpServer: mockHttpServer,
      drain,
      drainTimeoutMs: 5000,
    });

    try {
      await shutdown("SIGTERM");
    } catch {
      // process.exit throws
    }

    expect(callOrder).toEqual([
      "scheduler.stop",
      "httpServer.close",
      "drain",
      "closeDb",
    ]);
  });
});
