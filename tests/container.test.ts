/**
 * Unit tests for container dependency injection module.
 *
 * These tests verify factory function structure without Restate runtime.
 */
import { describe, it, expect } from "vitest";
import { createContainer, asValue } from "awilix";
import {
  defineContainerWorkflow,
  defineContainerRestateWorkflow,
  StepResponse,
} from "../src/container.js";

// Test services interface
interface TestServices {
  ordersService: {
    create: (data: { userId: string }) => Promise<{ id: string }>;
    delete: (id: string) => Promise<void>;
  };
  paymentsService: {
    charge: (amount: number) => Promise<{ id: string }>;
    refund: (id: string) => Promise<void>;
  };
}

// Create mock services
function createMockServices(): TestServices {
  return {
    ordersService: {
      create: async (data) => ({ id: `order_${data.userId}` }),
      delete: async () => {},
    },
    paymentsService: {
      charge: async (amount) => ({ id: `payment_${amount}` }),
      refund: async () => {},
    },
  };
}

describe("defineContainerWorkflow", () => {
  it("returns a factory function", () => {
    const factory = defineContainerWorkflow<TestServices>()(
      "TestWorkflow",
      async (saga, input: { userId: string }) => {
        return { orderId: `order_${input.userId}` };
      }
    );

    expect(typeof factory).toBe("function");
  });

  it("factory returns workflow with correct name", () => {
    const factory = defineContainerWorkflow<TestServices>()(
      "OrderWorkflow",
      async (saga, input: { userId: string }) => {
        return { orderId: `order_${input.userId}` };
      }
    );

    const container = createContainer<TestServices>();
    const services = createMockServices();
    container.register({
      ordersService: asValue(services.ordersService),
      paymentsService: asValue(services.paymentsService),
    });

    const workflow = factory(container);

    expect(workflow.name).toBe("OrderWorkflow");
  });

  it("factory returns workflow with runAsStep method", () => {
    const factory = defineContainerWorkflow<TestServices>()(
      "TestWorkflow",
      async (saga, input: { userId: string }) => {
        return { orderId: `order_${input.userId}` };
      }
    );

    const container = createContainer<TestServices>();
    const services = createMockServices();
    container.register({
      ordersService: asValue(services.ordersService),
      paymentsService: asValue(services.paymentsService),
    });

    const workflow = factory(container);

    expect(workflow.runAsStep).toBeDefined();
    expect(typeof workflow.runAsStep).toBe("function");
  });

  it("factory returns workflow with service property", () => {
    const factory = defineContainerWorkflow<TestServices>()(
      "TestWorkflow",
      async (saga, input: { userId: string }) => {
        return { orderId: `order_${input.userId}` };
      }
    );

    const container = createContainer<TestServices>();
    const services = createMockServices();
    container.register({
      ordersService: asValue(services.ordersService),
      paymentsService: asValue(services.paymentsService),
    });

    const workflow = factory(container);

    // Restate SDK exposes service property, not handlers directly
    expect(workflow.service).toBeDefined();
  });

  it("different containers produce independent workflows", () => {
    const factory = defineContainerWorkflow<TestServices>()(
      "IndependentWorkflow",
      async (saga, input: { userId: string }) => {
        return { orderId: `order_${input.userId}` };
      }
    );

    const container1 = createContainer<TestServices>();
    const services1 = createMockServices();
    container1.register({
      ordersService: asValue(services1.ordersService),
      paymentsService: asValue(services1.paymentsService),
    });

    const container2 = createContainer<TestServices>();
    const services2 = createMockServices();
    container2.register({
      ordersService: asValue(services2.ordersService),
      paymentsService: asValue(services2.paymentsService),
    });

    const workflow1 = factory(container1);
    const workflow2 = factory(container2);

    // Both workflows exist independently
    expect(workflow1).toBeDefined();
    expect(workflow2).toBeDefined();
    expect(workflow1).not.toBe(workflow2);
    expect(workflow1.name).toBe(workflow2.name);
  });
});

describe("defineContainerRestateWorkflow", () => {
  it("returns a factory function", () => {
    const factory = defineContainerRestateWorkflow<TestServices>()(
      "TestRestateWorkflow",
      async (saga, ctx, input: { userId: string }) => {
        return { orderId: `order_${input.userId}` };
      }
    );

    expect(typeof factory).toBe("function");
  });

  it("factory returns workflow with correct name", () => {
    const factory = defineContainerRestateWorkflow<TestServices>()(
      "RestateOrderWorkflow",
      async (saga, ctx, input: { userId: string }) => {
        return { orderId: `order_${input.userId}` };
      }
    );

    const container = createContainer<TestServices>();
    const services = createMockServices();
    container.register({
      ordersService: asValue(services.ordersService),
      paymentsService: asValue(services.paymentsService),
    });

    const workflow = factory(container);

    expect(workflow.name).toBe("RestateOrderWorkflow");
  });

  it("factory returns workflow with runAsStep method", () => {
    const factory = defineContainerRestateWorkflow<TestServices>()(
      "TestRestateWorkflow",
      async (saga, ctx, input: { userId: string }) => {
        return { orderId: `order_${input.userId}` };
      }
    );

    const container = createContainer<TestServices>();
    const services = createMockServices();
    container.register({
      ordersService: asValue(services.ordersService),
      paymentsService: asValue(services.paymentsService),
    });

    const workflow = factory(container);

    expect(workflow.runAsStep).toBeDefined();
    expect(typeof workflow.runAsStep).toBe("function");
  });

  it("factory returns workflow with workflow property", () => {
    const factory = defineContainerRestateWorkflow<TestServices>()(
      "TestRestateWorkflow",
      async (saga, ctx, input: { userId: string }) => {
        return { orderId: `order_${input.userId}` };
      }
    );

    const container = createContainer<TestServices>();
    const services = createMockServices();
    container.register({
      ordersService: asValue(services.ordersService),
      paymentsService: asValue(services.paymentsService),
    });

    const workflow = factory(container);

    // Restate SDK Workflow type exposes workflow property (not service)
    expect(workflow.workflow).toBeDefined();
  });

  it("supports additional handlers", () => {
    const factory = defineContainerRestateWorkflow<TestServices>()(
      "WorkflowWithHandlers",
      async (saga, ctx, input: { userId: string }) => {
        return { orderId: `order_${input.userId}` };
      },
      {
        getStatus: async (ctx) => "pending",
      }
    );

    const container = createContainer<TestServices>();
    const services = createMockServices();
    container.register({
      ordersService: asValue(services.ordersService),
      paymentsService: asValue(services.paymentsService),
    });

    const workflow = factory(container);

    // Restate SDK Workflow type exposes workflow property (not service)
    expect(workflow.workflow).toBeDefined();
    expect(workflow.name).toBe("WorkflowWithHandlers");
  });
});
