import type * as restate from "@restatedev/restate-sdk";
import type { SagaContext } from "./types.js";
import { runCompensations } from "./compensation.js";

/** A minimal durable-context substitute for fast unit tests. */
export type TestSagaContext = SagaContext & {
  /** Names passed to ctx.run(), in execution order. */
  runs: string[];
  /** Execute all registered compensations and return the context for chaining. */
  compensate: () => Promise<void>;
};

/**
 * Creates a saga context that executes `ctx.run` immediately.
 *
 * This is intended for testing step logic without starting a Restate server.
 * Integration tests should still cover journaling and retry behavior.
 */
export function createTestSagaContext(): TestSagaContext {
  const runs: string[] = [];
  const ctx = {
    run: async <T>(name: string, fn: () => Promise<T>) => {
      runs.push(name);
      return fn();
    },
  } as unknown as restate.Context;

  const saga: TestSagaContext = {
    ctx,
    compensations: [],
    runs,
    compensate: () => runCompensations(saga.compensations),
  };

  return saga;
}
