/**
 * Directus Factory Pattern
 *
 * Demonstrates the factory pattern for per-request containers:
 * - defineContainerWorkflow creates a factory function
 * - Factory is called with request-specific container
 * - Each request gets its own services with accountability/schema
 * - Nested workflows share parent's saga context
 *
 * This pattern is ideal for Directus where each request has different
 * accountability (user permissions) and schema context.
 */

import * as restate from "@restatedev/restate-sdk";
import { createContainer, asValue, AwilixContainer } from "awilix";
import {
  defineContainerWorkflow,
  defineContainerRestateWorkflow,
  createContainerStep,
  StepResponse,
  InferContainerServiceType,
} from "../src/index.js";

// =============================================================================
// Directus-like Types (simplified for example)
// =============================================================================

interface Accountability {
  user: string | null;
  role: string | null;
  admin: boolean;
}

interface Schema {
  collections: Record<string, unknown>;
}

interface ItemsServiceOptions {
  schema: Schema;
  accountability: Accountability | null;
}

// Mock ItemsService (like Directus)
class ItemsService<T extends Record<string, unknown>> {
  constructor(
    private collection: string,
    private options: ItemsServiceOptions
  ) {}

  async createOne(data: Partial<T>): Promise<T & { id: string }> {
    const id = `${this.collection}_${Date.now()}`;
    console.log(`[${this.collection}] Created by user ${this.options.accountability?.user || "public"}:`, id);
    return { id, ...data } as T & { id: string };
  }

  async updateOne(id: string, data: Partial<T>): Promise<T & { id: string }> {
    console.log(`[${this.collection}] Updated by user ${this.options.accountability?.user || "public"}:`, id);
    return { id, ...data } as T & { id: string };
  }

  async deleteOne(id: string): Promise<void> {
    console.log(`[${this.collection}] Deleted by user ${this.options.accountability?.user || "public"}:`, id);
  }
}

// =============================================================================
// Services Type
// =============================================================================

interface DirectusServices {
  ordersService: ItemsService<{ customer: string; items: unknown[]; status: string }>;
  paymentsService: ItemsService<{ order: string; amount: number; status: string }>;
  shipmentsService: ItemsService<{ order: string; address: string; status: string }>;
}

// =============================================================================
// Container Factory (creates per-request container)
// =============================================================================

function createRequestContainer(
  accountability: Accountability | null,
  schema: Schema
): AwilixContainer<DirectusServices> {
  const container = createContainer<DirectusServices>();

  container.register({
    ordersService: asValue(new ItemsService("orders", { schema, accountability })),
    paymentsService: asValue(new ItemsService("payments", { schema, accountability })),
    shipmentsService: asValue(new ItemsService("shipments", { schema, accountability })),
  });

  return container;
}

// =============================================================================
// Container-Aware Steps (defined once, reused across requests)
// =============================================================================

const createOrder = createContainerStep<DirectusServices>()({
  name: "CreateOrder",
  run: async (saga, input: { customerId: string; items: unknown[] }) => {
    const order = await saga.services.ordersService.createOne({
      customer: input.customerId,
      items: input.items,
      status: "pending",
    });
    return new StepResponse({ orderId: order.id }, { orderId: order.id });
  },
  compensate: async (saga, data) => {
    if ("orderId" in data) {
      await saga.services.ordersService.deleteOne(data.orderId);
    }
  },
});

const processPayment = createContainerStep<DirectusServices>()({
  name: "ProcessPayment",
  run: async (saga, input: { orderId: string; amount: number }) => {
    const payment = await saga.services.paymentsService.createOne({
      order: input.orderId,
      amount: input.amount,
      status: "completed",
    });
    return new StepResponse({ paymentId: payment.id }, { paymentId: payment.id });
  },
  compensate: async (saga, data) => {
    if ("paymentId" in data) {
      await saga.services.paymentsService.updateOne(data.paymentId, { status: "refunded" });
    }
  },
});

const createShipment = createContainerStep<DirectusServices>()({
  name: "CreateShipment",
  run: async (saga, input: { orderId: string; address: string }) => {
    // Simulate failure for testing
    if (input.address === "FAIL") {
      return StepResponse.permanentFailure("Invalid address", { shipmentId: "" });
    }

    const shipment = await saga.services.shipmentsService.createOne({
      order: input.orderId,
      address: input.address,
      status: "pending",
    });
    return new StepResponse({ shipmentId: shipment.id }, { shipmentId: shipment.id });
  },
  compensate: async (saga, data) => {
    if ("shipmentId" in data && data.shipmentId) {
      await saga.services.shipmentsService.updateOne(data.shipmentId, { status: "cancelled" });
    }
  },
});

// =============================================================================
// Workflow Factories (defined once, instantiated per-request)
// =============================================================================

// Payment workflow factory
const createPaymentWorkflow = defineContainerWorkflow<DirectusServices>()(
  "PaymentWorkflow",
  async (saga, input: { orderId: string; amount: number }) => {
    const payment = await processPayment(saga, input);
    return { paymentId: payment.paymentId };
  }
);

// Order workflow factory (nests payment workflow)
const createOrderWorkflow = defineContainerWorkflow<DirectusServices>()(
  "OrderWorkflow",
  async (
    saga,
    input: {
      customerId: string;
      items: unknown[];
      amount: number;
      address: string;
      // Reference to payment workflow (passed in closure)
      _paymentWorkflow?: ReturnType<typeof createPaymentWorkflow>;
    }
  ) => {
    // Step 1: Create order
    const order = await createOrder(saga, {
      customerId: input.customerId,
      items: input.items,
    });

    // Step 2: Process payment via nested workflow
    // Uses parent's saga context - inherits services and compensation stack
    const paymentWorkflow = input._paymentWorkflow!;
    const payment = await paymentWorkflow.runAsStep(saga, {
      orderId: order.orderId,
      amount: input.amount,
    });

    // Step 3: Create shipment
    // If this fails, both payment and order are compensated
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

// Long-running workflow with signals (Restate Workflow)
// Note: For workflows with additional handlers, use createContainerRestateWorkflow directly
const createApprovalWorkflow = defineContainerRestateWorkflow<DirectusServices>()(
  "ApprovalWorkflow",
  async (saga, ctx, input: { orderId: string; amount: number }) => {
    // Create order
    const order = await createOrder(saga, {
      customerId: "pending_approval",
      items: [],
    });

    // Wait for approval signal
    console.log(`Waiting for approval of order ${order.orderId}...`);
    const approved = await ctx.promise<boolean>("approval");

    if (!approved) {
      throw new restate.TerminalError("Order rejected");
    }

    // Process payment after approval
    const payment = await processPayment(saga, {
      orderId: order.orderId,
      amount: input.amount,
    });

    return { orderId: order.orderId, paymentId: payment.paymentId };
  }
  // Additional handlers (signals/queries) can be added via createContainerRestateWorkflow
);

// =============================================================================
// Simulated Directus Endpoint
// =============================================================================

// In a real Directus extension, this would be:
// export default defineEndpoint((router, context) => { ... })

async function simulateDirectusEndpoint() {
  // Simulate request context
  const accountability: Accountability = {
    user: "user_123",
    role: "admin",
    admin: true,
  };

  const schema: Schema = {
    collections: { orders: {}, payments: {}, shipments: {} },
  };

  // Create per-request container
  const container = createRequestContainer(accountability, schema);

  // Instantiate workflows with this container
  const paymentWorkflow = createPaymentWorkflow(container);
  const orderWorkflow = createOrderWorkflow(container);
  const approvalWorkflow = createApprovalWorkflow(container);

  // Register all workflows
  const endpoint = restate.endpoint()
    .bind(paymentWorkflow)
    .bind(orderWorkflow)
    .bind(approvalWorkflow);

  endpoint.listen(9080);

  console.log("Directus factory example listening on port 9080");
  console.log("");
  console.log("Available workflows:");
  console.log("  - OrderWorkflow (saga with nested payment)");
  console.log("  - PaymentWorkflow (standalone payment saga)");
  console.log("  - ApprovalWorkflow (long-running with signals)");
  console.log("");
  console.log("Try:");
  console.log("  # Basic order (will fail at shipment - compensates all)");
  console.log('  curl -X POST http://localhost:8080/OrderWorkflow/run \\');
  console.log('    -H "Content-Type: application/json" \\');
  console.log('    -d \'{"customerId": "cust_1", "items": [], "amount": 100, "address": "FAIL"}\'');
  console.log("");
  console.log("  # Successful order");
  console.log('  curl -X POST http://localhost:8080/OrderWorkflow/run \\');
  console.log('    -H "Content-Type: application/json" \\');
  console.log('    -d \'{"customerId": "cust_1", "items": [], "amount": 100, "address": "123 Main St"}\'');
}

// Export types for external clients
export type OrderWorkflow = InferContainerServiceType<ReturnType<typeof createOrderWorkflow>>;
export type PaymentWorkflow = InferContainerServiceType<ReturnType<typeof createPaymentWorkflow>>;
export type ApprovalWorkflow = InferContainerServiceType<ReturnType<typeof createApprovalWorkflow>>;

// Run the simulation
simulateDirectusEndpoint();
