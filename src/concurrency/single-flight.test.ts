import { describe, it, expect } from "vitest";
import { createSingleFlight } from "./single-flight";

describe("createSingleFlight", () => {
  it("isActive is false initially", () => {
    const sf = createSingleFlight();
    expect(sf.isActive()).toBe(false);
  });

  it("acquires and reports active", () => {
    const sf = createSingleFlight();
    expect(sf.tryAcquire()).toBe(true);
    expect(sf.isActive()).toBe(true);
  });

  it("second acquire fails while held", () => {
    const sf = createSingleFlight();
    sf.tryAcquire();
    expect(sf.tryAcquire()).toBe(false);
    expect(sf.isActive()).toBe(true);
  });

  it("release allows re-acquire", () => {
    const sf = createSingleFlight();
    sf.tryAcquire();
    sf.release();
    expect(sf.isActive()).toBe(false);
    expect(sf.tryAcquire()).toBe(true);
    expect(sf.isActive()).toBe(true);
  });

  it("release when not held is no-op", () => {
    const sf = createSingleFlight();
    expect(() => sf.release()).not.toThrow();
    expect(sf.isActive()).toBe(false);
  });
});
