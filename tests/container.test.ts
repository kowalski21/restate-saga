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

// =============================================================================
// defineSagaFactory tests (Medusa-inspired scoped factory)
// =============================================================================

import { defineSagaFactory } from "../src/container.js";

// Root cradle - app-level singletons
interface RootCradle {
  database: { query: (sql: string) => Promise<unknown[]> };
  logger: { info: (msg: string) => void };
}

// Scoped cradle - request-specific services
interface ScopedCradle extends RootCradle {
  accountability: { userId: string; role: string };
  ordersService: {
    create: (data: { userId: string }) => Promise<{ id: string }>;
    delete: (id: string) => Promise<void>;
  };
}

function createMockRootServices(): RootCradle {
  return {
    database: { query: async () => [] },
    logger: { info: () => {} },
  };
}

describe("defineSagaFactory", () => {
  it("returns factory with createWorkflow and createStep", () => {
    const factory = defineSagaFactory<RootCradle, ScopedCradle>({
      createScope: (root, input: { _ctx?: { userId: string } }) => {
        const scope = root.createScope<ScopedCradle>();
        scope.register({
          accountability: asValue({ userId: input._ctx?.userId ?? "anonymous", role: "user" }),
          ordersService: asValue({
            create: async (data) => ({ id: `order_${data.userId}` }),
            delete: async () => {},
          }),
        });
        return scope;
      },
    });

    expect(factory.createWorkflow).toBeDefined();
    expect(factory.createStep).toBeDefined();
    expect(factory.createStepStrict).toBeDefined();
    expect(factory.createRestateWorkflow).toBeDefined();
  });

  it("createWorkflow returns a factory function", () => {
    const { createWorkflow } = defineSagaFactory<RootCradle, ScopedCradle>({
      createScope: (root, input: { _ctx?: { userId: string } }) => {
        const scope = root.createScope<ScopedCradle>();
        scope.register({
          accountability: asValue({ userId: input._ctx?.userId ?? "anonymous", role: "user" }),
          ordersService: asValue({
            create: async (data) => ({ id: `order_${data.userId}` }),
            delete: async () => {},
          }),
        });
        return scope;
      },
    });

    const checkoutWorkflow = createWorkflow(
      "Checkout",
      async (saga, input: { customerId: string }) => {
        return { orderId: `order_${input.customerId}` };
      }
    );

    expect(typeof checkoutWorkflow).toBe("function");
  });

  it("workflow factory produces workflow with correct name", () => {
    const { createWorkflow } = defineSagaFactory<RootCradle, ScopedCradle>({
      createScope: (root) => {
        const scope = root.createScope<ScopedCradle>();
        scope.register({
          accountability: asValue({ userId: "test", role: "user" }),
          ordersService: asValue({
            create: async (data) => ({ id: `order_${data.userId}` }),
            delete: async () => {},
          }),
        });
        return scope;
      },
    });

    const checkoutWorkflow = createWorkflow(
      "ScopedCheckout",
      async (saga, input: { customerId: string }) => {
        return { orderId: `order_${input.customerId}` };
      }
    );

    const rootContainer = createContainer<RootCradle>();
    rootContainer.register({
      database: asValue(createMockRootServices().database),
      logger: asValue(createMockRootServices().logger),
    });

    const workflow = checkoutWorkflow(rootContainer);

    expect(workflow.name).toBe("ScopedCheckout");
    expect(workflow.runAsStep).toBeDefined();
  });

  it("createStep returns step function", () => {
    const { createStep } = defineSagaFactory<RootCradle, ScopedCradle>({
      createScope: (root) => {
        const scope = root.createScope<ScopedCradle>();
        scope.register({
          accountability: asValue({ userId: "test", role: "user" }),
          ordersService: asValue({
            create: async (data) => ({ id: `order_${data.userId}` }),
            delete: async () => {},
          }),
        });
        return scope;
      },
    });

    const createOrder = createStep({
      name: "CreateOrder",
      run: async (saga, input: { customerId: string }) => {
        return new StepResponse(
          { orderId: `order_${input.customerId}` },
          { orderId: `order_${input.customerId}` }
        );
      },
      compensate: async (saga, data) => {
        // Would delete order
      },
    });

    expect(typeof createOrder).toBe("function");
  });

  it("steps from factory are usable with compatible workflows", () => {
    // Create factory
    const { createStep, createWorkflow } = defineSagaFactory<RootCradle, ScopedCradle>({
      createScope: (root) => {
        const scope = root.createScope<ScopedCradle>();
        scope.register({
          accountability: asValue({ userId: "test", role: "user" }),
          ordersService: asValue({
            create: async (data) => ({ id: `order_${data.userId}` }),
            delete: async () => {},
          }),
        });
        return scope;
      },
    });

    // Create step using factory's createStep
    const createOrder = createStep({
      name: "CreateOrder",
      run: async (saga, input: { customerId: string }) => {
        // saga.services is ScopedCradle - fully typed
        const order = await saga.services.ordersService.create({ userId: input.customerId });
        return new StepResponse({ orderId: order.id }, { orderId: order.id });
      },
      compensate: async (saga, data) => {
        // data can be Input | CompensationData, check for orderId
        if ("orderId" in data) {
          await saga.services.ordersService.delete(data.orderId);
        }
      },
    });

    // Create workflow using factory's createWorkflow
    const checkoutWorkflow = createWorkflow(
      "Checkout",
      async (saga, input: { customerId: string }) => {
        // Step works in workflow - types match
        const order = await createOrder(saga, { customerId: input.customerId });
        return { orderId: order.orderId };
      }
    );

    // Instantiate workflow
    const rootContainer = createContainer<RootCradle>();
    rootContainer.register({
      database: asValue(createMockRootServices().database),
      logger: asValue(createMockRootServices().logger),
    });

    const workflow = checkoutWorkflow(rootContainer);

    expect(workflow.name).toBe("Checkout");
  });

  it("createRestateWorkflow returns a factory function", () => {
    const { createRestateWorkflow } = defineSagaFactory<RootCradle, ScopedCradle>({
      createScope: (root) => {
        const scope = root.createScope<ScopedCradle>();
        scope.register({
          accountability: asValue({ userId: "test", role: "user" }),
          ordersService: asValue({
            create: async (data) => ({ id: `order_${data.userId}` }),
            delete: async () => {},
          }),
        });
        return scope;
      },
    });

    const longRunningWorkflow = createRestateWorkflow(
      "LongRunning",
      async (saga, ctx, input: { taskId: string }) => {
        return { completed: true };
      }
    );

    expect(typeof longRunningWorkflow).toBe("function");

    const rootContainer = createContainer<RootCradle>();
    rootContainer.register({
      database: asValue(createMockRootServices().database),
      logger: asValue(createMockRootServices().logger),
    });

    const workflow = longRunningWorkflow(rootContainer);
    expect(workflow.name).toBe("LongRunning");
    expect(workflow.runAsStep).toBeDefined();
  });

  it("different disposal strategies are accepted", () => {
    // Always dispose (default)
    const factory1 = defineSagaFactory<RootCradle, ScopedCradle>({
      createScope: (root) => root.createScope<ScopedCradle>(),
      disposeScope: true,
    });
    expect(factory1.createWorkflow).toBeDefined();

    // Never dispose
    const factory2 = defineSagaFactory<RootCradle, ScopedCradle>({
      createScope: (root) => root.createScope<ScopedCradle>(),
      disposeScope: false,
    });
    expect(factory2.createWorkflow).toBeDefined();

    // On success only
    const factory3 = defineSagaFactory<RootCradle, ScopedCradle>({
      createScope: (root) => root.createScope<ScopedCradle>(),
      disposeScope: "on-success",
    });
    expect(factory3.createWorkflow).toBeDefined();

    // Custom function
    const factory4 = defineSagaFactory<RootCradle, ScopedCradle>({
      createScope: (root) => root.createScope<ScopedCradle>(),
      disposeScope: async (scope, error) => {
        if (!error) await scope.dispose();
      },
    });
    expect(factory4.createWorkflow).toBeDefined();
  });
});
