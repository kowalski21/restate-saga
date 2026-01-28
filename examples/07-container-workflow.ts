/**
 * Container-Aware Workflow
 *
 * Demonstrates dependency injection with Awilix containers:
 * - Container passed at workflow creation
 * - Services available via saga.services
 * - Both run and compensate have access to services
 * - Type-safe service resolution
 */

import * as restate from "@restatedev/restate-sdk";
import { createContainer, asValue } from "awilix";
import {
  createContainerWorkflow,
  createContainerStep,
  StepResponse,
  InferContainerServiceType,
  InferContainerWorkflow,
} from "../src/index.js";

// =============================================================================
// Service Interfaces (mock services for example)
// =============================================================================

interface Order {
  id: string;
  customerId: string;
  items: Array<{ productId: string; quantity: number }>;
  status: string;
}

interface Payment {
  id: string;
  orderId: string;
  amount: number;
  status: string;
}

interface OrdersService {
  createOne(data: Omit<Order, "id">): Promise<Order>;
  updateOne(id: string, data: Partial<Order>): Promise<Order>;
  deleteOne(id: string): Promise<void>;
}

interface PaymentsService {
  createOne(data: Omit<Payment, "id">): Promise<Payment>;
  updateOne(id: string, data: Partial<Payment>): Promise<Payment>;
}

// =============================================================================
// Services Type (TCradle)
// =============================================================================

interface AppServices {
  ordersService: OrdersService;
  paymentsService: PaymentsService;
}

// =============================================================================
// Mock Service Implementations
// =============================================================================

const mockOrdersService: OrdersService = {
  async createOne(data) {
    const order: Order = { id: `order_${Date.now()}`, ...data };
    console.log(`[OrdersService] Created order ${order.id}`);
    return order;
  },
  async updateOne(id, data) {
    console.log(`[OrdersService] Updated order ${id}:`, data);
    return { id, customerId: "", items: [], status: "", ...data };
  },
  async deleteOne(id) {
    console.log(`[OrdersService] Deleted order ${id}`);
  },
};

const mockPaymentsService: PaymentsService = {
  async createOne(data) {
    const payment: Payment = { id: `pay_${Date.now()}`, ...data };
    console.log(`[PaymentsService] Created payment ${payment.id}`);
    return payment;
  },
  async updateOne(id, data) {
    console.log(`[PaymentsService] Updated payment ${id}:`, data);
    return { id, orderId: "", amount: 0, status: "", ...data };
  },
};

// =============================================================================
// Container Setup
// =============================================================================

const container = createContainer<AppServices>();
container.register({
  ordersService: asValue(mockOrdersService),
  paymentsService: asValue(mockPaymentsService),
});

// =============================================================================
// Container-Aware Steps
// =============================================================================

// Step 1: Create order using saga.services
const createOrder = createContainerStep<AppServices>()({
  name: "CreateOrder",
  run: async (saga, input: { customerId: string; items: Array<{ productId: string; quantity: number }> }) => {
    // saga.services is typed as AppServices
    const order = await saga.services.ordersService.createOne({
      customerId: input.customerId,
      items: input.items,
      status: "pending",
    });

    return new StepResponse({ orderId: order.id }, { orderId: order.id });
  },
  compensate: async (saga, data) => {
    // saga.services is also available in compensation
    if ("orderId" in data) {
      await saga.services.ordersService.deleteOne(data.orderId);
    }
  },
});

// Step 2: Process payment using saga.services
const processPayment = createContainerStep<AppServices>()({
  name: "ProcessPayment",
  run: async (saga, input: { orderId: string; amount: number }) => {
    // Simulate payment failure for testing
    if (input.amount > 10000) {
      return StepResponse.permanentFailure("Amount exceeds limit", {
        paymentId: "",
      });
    }

    const payment = await saga.services.paymentsService.createOne({
      orderId: input.orderId,
      amount: input.amount,
      status: "completed",
    });

    return new StepResponse({ paymentId: payment.id }, { paymentId: payment.id });
  },
  compensate: async (saga, data) => {
    if ("paymentId" in data && data.paymentId) {
      await saga.services.paymentsService.updateOne(data.paymentId, {
        status: "refunded",
      });
    }
  },
});

// Step 3: Confirm order
const confirmOrder = createContainerStep<AppServices>()({
  name: "ConfirmOrder",
  run: async (saga, input: { orderId: string }) => {
    await saga.services.ordersService.updateOne(input.orderId, {
      status: "confirmed",
    });

    return new StepResponse({ confirmed: true }, { orderId: input.orderId });
  },
  compensate: async (saga, data) => {
    if ("orderId" in data) {
      await saga.services.ordersService.updateOne(data.orderId, {
        status: "cancelled",
      });
    }
  },
});

// =============================================================================
// Container Workflow
// =============================================================================

export const orderWorkflow = createContainerWorkflow(
  container,
  "OrderWorkflow",
  async (
    saga,
    input: {
      customerId: string;
      items: Array<{ productId: string; quantity: number }>;
      amount: number;
    }
  ) => {
    // Step 1: Create order
    const order = await createOrder(saga, {
      customerId: input.customerId,
      items: input.items,
    });

    // Step 2: Process payment
    // If this fails, createOrder is compensated (order deleted)
    const payment = await processPayment(saga, {
      orderId: order.orderId,
      amount: input.amount,
    });

    // Step 3: Confirm order
    // If this fails, both payment and order are compensated
    await confirmOrder(saga, { orderId: order.orderId });

    return {
      orderId: order.orderId,
      paymentId: payment.paymentId,
    };
  }
);

// =============================================================================
// Type Inference Examples
// =============================================================================

// Extract individual types
export type OrderWorkflowService = InferContainerServiceType<typeof orderWorkflow>;

// Extract all types at once
export type OrderWorkflowInfo = InferContainerWorkflow<typeof orderWorkflow>;
// OrderWorkflowInfo.Name = "OrderWorkflow"
// OrderWorkflowInfo.Input = { customerId: string; items: ...; amount: number }
// OrderWorkflowInfo.Output = { orderId: string; paymentId: string }
// OrderWorkflowInfo.Cradle = AppServices

// =============================================================================
// Start the Service
// =============================================================================

restate.endpoint().bind(orderWorkflow).listen(9080);

console.log("Container workflow listening on port 9080");
console.log("Try: curl -X POST http://localhost:8080/OrderWorkflow/run \\");
console.log('  -H "Content-Type: application/json" \\');
console.log('  -d \'{"customerId": "cust_123", "items": [{"productId": "prod_1", "quantity": 2}], "amount": 99.99}\'');
