// pattern: Functional Core

export type SingleFlight = {
  /** Attempts to acquire the lock. Returns true if acquired, false if already held. Synchronous — no async races. */
  readonly tryAcquire: () => boolean;
  /** Releases the lock. Safe to call when not held (no-op). */
  readonly release: () => void;
  /** Returns true if the lock is currently held. */
  readonly isActive: () => boolean;
};

export function createSingleFlight(): SingleFlight {
  let active = false;

  return {
    tryAcquire: () => {
      if (active) return false;
      active = true;
      return true;
    },
    release: () => {
      active = false;
    },
    isActive: () => active,
  };
}
