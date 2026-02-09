/**
 * Scoped Saga Factory (Medusa-inspired)
 *
 * Demonstrates the defineSagaFactory pattern:
 * - Define scope creation logic once
 * - Factory provides createWorkflow and createStep
 * - Steps are typed to ScopedCradle but usable across compatible factories
 * - Nested workflows share parent's scope
 * - Automatic scope disposal with configurable strategies
 *
 * This pattern is ideal for applications like Directus where each request
 * has different context (accountability, schema) that needs to be scoped.
 */

import * as restate from "@restatedev/restate-sdk";
import { createContainer, asValue, asFunction, AwilixContainer } from "awilix";
import {
  defineSagaFactory,
  createContainerStep,
  StepResponse,
} from "../src/index.js";

// =============================================================================
// Types
// =============================================================================

// Directus-like types
interface Accountability {
  user: string | null;
  role: string | null;
  admin: boolean;
}

interface Schema {
  collections: Record<string, unknown>;
}

// Mock ItemsService
class ItemsService<T extends Record<string, unknown>> {
  constructor(
    private collection: string,
    private accountability: Accountability | null
  ) {}

  async createOne(data: Partial<T>): Promise<T & { id: string }> {
    const id = `${this.collection}_${Date.now()}`;
    console.log(`[${this.collection}] Created by user ${this.accountability?.user || "public"}:`, id);
    return { id, ...data } as T & { id: string };
  }

  async deleteOne(id: string): Promise<void> {
    console.log(`[${this.collection}] Deleted by user ${this.accountability?.user || "public"}:`, id);
  }
}

// =============================================================================
// Cradle Types
// =============================================================================

// Root cradle - app-level singletons (database, logger, config)
interface RootCradle {
  database: { query: (sql: string) => Promise<unknown[]> };
  logger: { info: (msg: string) => void; error: (msg: string) => void };
}

// Scoped cradle - request-specific services
interface AppCradle extends RootCradle {
  accountability: Accountability | null;
  schema: Schema;
  ordersService: ItemsService<{ customer: string; items: unknown[]; status: string }>;
  paymentsService: ItemsService<{ order: string; amount: number; status: string }>;
  shipmentsService: ItemsService<{ order: string; address: string; status: string }>;
}

// Context passed in workflow input
interface RequestContext {
  accountability: Accountability | null;
  schema: Schema;
}

// =============================================================================
// Define Saga Factory (once per application)
// =============================================================================

const { createWorkflow, createStep, createRestateWorkflow } = defineSagaFactory<
  RootCradle,
  AppCradle
>({
  /**
   * Called per-workflow invocation to create a scoped container.
   * Receives root container and workflow input.
   */
  createScope: (rootContainer, input: { _ctx?: RequestContext }) => {
    const scope = rootContainer.createScope<AppCradle>();

    // Extract context from input (defaults for missing context)
    const ctx = input._ctx ?? {
      accountability: null,
      schema: { collections: {} },
    };

    // Register request-specific values
    scope.register({
      accountability: asValue(ctx.accountability),
      schema: asValue(ctx.schema),
    });

    // Register services that depend on request context
    scope.register({
      ordersService: asFunction(
        ({ accountability }: AppCradle) =>
          new ItemsService<{ customer: string; items: unknown[]; status: string }>("orders", accountability)
      ).scoped(),
      paymentsService: asFunction(
        ({ accountability }: AppCradle) =>
          new ItemsService<{ order: string; amount: number; status: string }>("payments", accountability)
      ).scoped(),
      shipmentsService: asFunction(
        ({ accountability }: AppCradle) =>
          new ItemsService<{ order: string; address: string; status: string }>("shipments", accountability)
      ).scoped(),
    });

    return scope;
  },

  // Dispose scope after workflow completes (default: true)
  disposeScope: true,
});

// =============================================================================
// Steps (created via factory - types inferred)
// =============================================================================

const createOrder = createStep({
  name: "CreateOrder",
  run: async (saga, input: { customerId: string; items: unknown[] }) => {
    // saga.services is AppCradle - fully typed!
    const order = await saga.services.ordersService.createOne({
      customer: input.customerId,
      items: input.items,
      status: "pending",
    });
    saga.services.logger.info(`Order created: ${order.id}`);
    return new StepResponse({ orderId: order.id }, { orderId: order.id });
  },
  compensate: async (saga, data) => {
    if ("orderId" in data) {
      saga.services.logger.info(`Compensating order: ${data.orderId}`);
      await saga.services.ordersService.deleteOne(data.orderId);
    }
  },
});

const processPayment = createStep({
  name: "ProcessPayment",
  run: async (saga, input: { orderId: string; amount: number }) => {
    const payment = await saga.services.paymentsService.createOne({
      order: input.orderId,
      amount: input.amount,
      status: "charged",
    });
    saga.services.logger.info(`Payment processed: ${payment.id}`);
    return new StepResponse({ paymentId: payment.id }, { paymentId: payment.id });
  },
  compensate: async (saga, data) => {
    if ("paymentId" in data) {
      saga.services.logger.info(`Refunding payment: ${data.paymentId}`);
      await saga.services.paymentsService.deleteOne(data.paymentId);
    }
  },
});

const createShipment = createStep({
  name: "CreateShipment",
  run: async (saga, input: { orderId: string; address: string }) => {
    const shipment = await saga.services.shipmentsService.createOne({
      order: input.orderId,
      address: input.address,
      status: "pending",
    });
    saga.services.logger.info(`Shipment created: ${shipment.id}`);
    return new StepResponse({ shipmentId: shipment.id }, { shipmentId: shipment.id });
  },
  compensate: async (saga, data) => {
    if ("shipmentId" in data) {
      saga.services.logger.info(`Cancelling shipment: ${data.shipmentId}`);
      await saga.services.shipmentsService.deleteOne(data.shipmentId);
    }
  },
});

// =============================================================================
// Steps can also be created outside factory (for cross-factory reuse)
// =============================================================================

// This step works with any container that has an ordersService
const validateOrder = createContainerStep<Pick<AppCradle, "ordersService" | "logger">>()({
  name: "ValidateOrder",
  run: async (saga, input: { orderId: string }) => {
    saga.services.logger.info(`Validating order: ${input.orderId}`);
    // Validation logic here...
    return new StepResponse({ valid: true }, null);
  },
  // No compensation needed for validation
});

// =============================================================================
// Workflows (created via factory - clean, no type annotations)
// =============================================================================

// Input type for checkout workflow
interface CheckoutInput {
  customerId: string;
  items: unknown[];
  amount: number;
  address: string;
  _ctx?: RequestContext; // Context passed from request
}

const checkoutWorkflow = createWorkflow(
  "ScopedCheckout",
  async (saga, input: CheckoutInput) => {
    // All steps have access to scoped services

    // Step 1: Create order
    const order = await createOrder(saga, {
      customerId: input.customerId,
      items: input.items,
    });

    // Step 2: Validate (using external step - types compatible)
    await validateOrder(saga, { orderId: order.orderId });

    // Step 3: Process payment
    const payment = await processPayment(saga, {
      orderId: order.orderId,
      amount: input.amount,
    });

    // Step 4: Create shipment
    // If this fails, payment and order are compensated
    const shipment = await createShipment(saga, {
      orderId: order.orderId,
      address: input.address,
    });

    return {
      orderId: order.orderId,
      paymentId: payment.paymentId,
      shipmentId: shipment.shipmentId,
    };
  }
);

// =============================================================================
// Nested Workflow (shares parent's scope)
// =============================================================================

// Note: For nested workflows, define the handler separately so it can be reused
const paymentHandler = async (
  saga: Parameters<Parameters<typeof createWorkflow>[1]>[0],
  input: { orderId: string; amount: number }
) => {
  // Uses same scoped services as parent
  const payment = await processPayment(saga, input);
  return payment;
};

// Standalone workflow (creates its own scope when called directly)
const paymentWorkflow = createWorkflow("ScopedPayment", paymentHandler);

const orderWithNestedPayment = createWorkflow(
  "OrderWithNestedPayment",
  async (saga, input: CheckoutInput) => {
    const order = await createOrder(saga, {
      customerId: input.customerId,
      items: input.items,
    });

    // Option 1: Call handler directly (shares scope, no separate workflow)
    const payment = await paymentHandler(saga, {
      orderId: order.orderId,
      amount: input.amount,
    });

    return { orderId: order.orderId, paymentId: payment.paymentId };
  }
);

// =============================================================================
// Long-running Restate Workflow (with workflowId)
// =============================================================================

const approvalWorkflow = createRestateWorkflow(
  "ScopedApproval",
  async (saga, ctx, input: { orderId: string; _ctx?: RequestContext }) => {
    saga.services.logger.info(`Approval workflow started for order: ${input.orderId}`);

    // Wait for approval signal (Restate durable promise)
    const approved = await ctx.promise<boolean>("approval");

    if (!approved) {
      throw new restate.TerminalError("Order rejected");
    }

    return { approved: true, orderId: input.orderId };
  },
  {
    // Additional handlers (signals/queries)
    approve: async (ctx: restate.WorkflowSharedContext, input: { approved: boolean }) => {
      ctx.promise<boolean>("approval").resolve(input.approved);
    },
  }
);

// =============================================================================
// Setup & Usage
// =============================================================================

async function main() {
  // 1. Create root container (app-level singletons)
  const rootContainer = createContainer<RootCradle>();
  rootContainer.register({
    database: asValue({ query: async () => [] }),
    logger: asValue({
      info: (msg: string) => console.log(`[INFO] ${msg}`),
      error: (msg: string) => console.error(`[ERROR] ${msg}`),
    }),
  });

  // 2. Instantiate workflows with root container
  const checkout = checkoutWorkflow(rootContainer);
  const approval = approvalWorkflow(rootContainer);
  const nestedOrder = orderWithNestedPayment(rootContainer);

  // 3. Register with Restate
  const server = restate.endpoint().bind(checkout).bind(approval).bind(nestedOrder);

  console.log("Registered workflows:", [checkout.name, approval.name, nestedOrder.name]);

  // 4. Start server
  const port = 9080;
  await server.listen(port);
  console.log(`Restate endpoint listening on port ${port}`);
}

// Run if executed directly
main().catch(console.error);

// =============================================================================
// Example: Directus Extension Usage
// =============================================================================

/*
// extensions/checkout/index.ts
import { checkoutWorkflow } from "../../workflows/checkout";
import { rootContainer } from "../../services/container";

export default defineEndpoint((router, { services }) => {
  // Instantiate workflow once at startup
  const workflow = checkoutWorkflow(rootContainer);

  router.post("/checkout", async (req, res) => {
    // Pass request context in input
    const result = await restateClient
      .serviceClient(workflow)
      .run({
        customerId: req.body.customerId,
        items: req.body.items,
        amount: req.body.amount,
        address: req.body.address,
        _ctx: {
          accountability: req.accountability,
          schema: req.schema,
        },
      });

    res.json(result);
  });
});
*/
