import { describe, expect, it, vi } from "vitest";
import * as restate from "@restatedev/restate-sdk";
import {
  invocation,
  resolveSignal,
  scopedObjectClient,
  scopedServiceClient,
  scopedWorkflowClient,
  waitForSignal,
  workflowClient,
} from "../src/clients.js";
import type { RestateWorkflowDefinition } from "../src/types.js";

const service = { name: "Inventory", handlers: {} };
const workflow = {
  name: "OrderWorkflow",
  handlers: {},
  __restateWorkflow: true as const,
} satisfies RestateWorkflowDefinition;
const object = { name: "Account", handlers: {} };

describe("client helpers", () => {
  it("preserves the legacy service-style workflow client", () => {
    const client = {};
    const ctx = {
      serviceClient: vi.fn(() => client),
    } as unknown as restate.Context;

    expect(workflowClient(ctx, service)).toBe(client);
    expect(ctx.serviceClient).toHaveBeenCalledWith(service);
  });

  it("uses the keyed workflow client for Restate Workflows", () => {
    const client = {};
    const ctx = {
      workflowClient: vi.fn(() => client),
    } as unknown as restate.Context;

    expect(workflowClient(ctx, workflow, "order-123")).toBe(client);
    expect(ctx.workflowClient).toHaveBeenCalledWith(workflow, "order-123");
  });

  it("provides scoped service, workflow, and object clients", () => {
    const clients = {
      service: {},
      workflow: {},
      object: {},
    };
    const scopedClient = {
      serviceClient: vi.fn(() => clients.service),
      workflowClient: vi.fn(() => clients.workflow),
      objectClient: vi.fn(() => clients.object),
    };
    const scoped = vi.fn(() => scopedClient);
    const ctx = { scope: scoped } as unknown as restate.Context;

    expect(scopedServiceClient(ctx, "tenant-a", service)).toBe(clients.service);
    expect(scopedWorkflowClient(ctx, "tenant-a", workflow, "wf-1")).toBe(
      clients.workflow
    );
    expect(scopedObjectClient(ctx, "tenant-a", object, "account-1")).toBe(
      clients.object
    );
    expect(scoped).toHaveBeenCalledTimes(3);
  });

  it("exposes signal and invocation helpers", () => {
    const signal = { resolve: vi.fn() };
    const reference = { signal: vi.fn(() => signal) };
    const ctx = {
      signal: vi.fn(() => "signal-promise"),
      invocation: vi.fn(() => reference),
    } as unknown as restate.Context;
    const invocationId = "invocation-1" as restate.InvocationId;

    expect(waitForSignal(ctx, "approved")).toBe("signal-promise");
    expect(invocation(ctx, invocationId)).toBe(reference);
    resolveSignal(ctx, invocationId, "approved", { by: "admin" });

    expect(reference.signal).toHaveBeenCalledWith("approved");
    expect(signal.resolve).toHaveBeenCalledWith({ by: "admin" });
  });
});
