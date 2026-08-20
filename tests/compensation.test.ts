import { describe, expect, it } from "vitest";
import { createTestSagaContext, runCompensations } from "../src/index.js";

describe("compensation utilities", () => {
  it("run all compensations in reverse order without mutating the source", async () => {
    const order: number[] = [];
    const stack = [
      async () => { order.push(1); },
      async () => { order.push(2); },
      async () => { order.push(3); },
    ];

    await runCompensations(stack);

    expect(order).toEqual([3, 2, 1]);
    expect(stack).toHaveLength(0);
  });

  it("attempts every compensation and aggregates failures", async () => {
    const order: number[] = [];
    const stack = [
      async () => {
        order.push(1);
        throw new Error("first");
      },
      async () => {
        order.push(2);
        throw new Error("second");
      },
    ];

    await expect(runCompensations(stack)).rejects.toBeInstanceOf(AggregateError);
    expect(order).toEqual([2, 1]);
  });

  it("provides an immediate ctx.run test context", async () => {
    const saga = createTestSagaContext();
    await saga.ctx.run("forward", async () => "ok");
    saga.compensations.push(async () => undefined);
    await saga.compensate();

    expect(saga.runs).toEqual(["forward"]);
    expect(saga.compensations).toHaveLength(0);
  });
});
