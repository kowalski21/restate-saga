/**
 * Composed Workflows with runAsStep
 *
 * Demonstrates:
 * - Workflows that can run standalone OR embedded
 * - runAsStep for shared compensation context
 * - Multi-level workflow composition
 */

import * as restate from "@restatedev/restate-sdk";
import {
  createSagaWorkflow,
  createSagaStep,
  StepResponse,
} from "../src/index.js";

// ============================================================
// Payment Workflow (can run standalone or as part of order)
// ============================================================

const authorizePayment = createSagaStep<
  { amount: number; cardToken: string },
  { authId: string },
  { authId: string }
>({
  name: "AuthorizePayment",
  run: async ({ input }) => {
    const authId = `auth_${Date.now()}`;
    console.log(`Authorized $${input.amount} on card`);
    return new StepResponse({ authId }, { authId });
  },
  compensate: async (data) => {
    if ("authId" in data) {
      console.log(`Voided authorization ${data.authId}`);
    }
  },
});

const capturePayment = createSagaStep<
  { authId: string; amount: number },
  { captureId: string },
  { captureId: string; amount: number }
>({
  name: "CapturePayment",
  run: async ({ input }) => {
    const captureId = `cap_${Date.now()}`;
    console.log(`Captured $${input.amount}`);
    return new StepResponse({ captureId }, { captureId, amount: input.amount });
  },
  compensate: async (data) => {
    if ("captureId" in data) {
      console.log(`Refunded $${data.amount} for capture ${data.captureId}`);
    }
  },
});

// Payment workflow - can be called directly or embedded
export const paymentWorkflow = createSagaWorkflow(
  "PaymentWorkflow",
  async (saga, input: { amount: number; cardToken: string }) => {
    const auth = await authorizePayment(saga, input);
    const capture = await capturePayment(saga, {
      authId: auth.authId,
      amount: input.amount,
    });
    return { paymentId: capture.captureId };
  }
);

// ============================================================
// Shipping Workflow (can run standalone or as part of order)
// ============================================================

const createLabel = createSagaStep<
  { orderId: string; address: string },
  { labelId: string },
  { labelId: string }
>({
  name: "CreateLabel",
  run: async ({ input }) => {
    const labelId = `label_${Date.now()}`;
    console.log(`Created shipping label for ${input.address}`);
    return new StepResponse({ labelId }, { labelId });
  },
  compensate: async (data) => {
    if ("labelId" in data) {
      console.log(`Voided shipping label ${data.labelId}`);
    }
  },
});

const schedulePickup = createSagaStep<
  { labelId: string },
  { pickupId: string },
  { pickupId: string }
>({
  name: "SchedulePickup",
  run: async ({ input }) => {
    // Simulate occasional failures
    if (input.labelId.includes("FAIL")) {
      return StepResponse.permanentFailure("Pickup unavailable in area", {
        pickupId: "",
      });
    }
    const pickupId = `pickup_${Date.now()}`;
    console.log(`Scheduled pickup for label ${input.labelId}`);
    return new StepResponse({ pickupId }, { pickupId });
  },
  compensate: async (data) => {
    if ("pickupId" in data && data.pickupId) {
      console.log(`Cancelled pickup ${data.pickupId}`);
    }
  },
});

// Shipping workflow - can be called directly or embedded
export const shippingWorkflow = createSagaWorkflow(
  "ShippingWorkflow",
  async (saga, input: { orderId: string; address: string }) => {
    const label = await createLabel(saga, input);
    const pickup = await schedulePickup(saga, { labelId: label.labelId });
    return { shipmentId: pickup.pickupId };
  }
);

// ============================================================
// Order Workflow (composes payment and shipping)
// ============================================================

const createOrder = createSagaStep<
  { customerId: string; items: string[] },
  { orderId: string },
  { orderId: string }
>({
  name: "CreateOrder",
  run: async ({ input }) => {
    const orderId = `order_${Date.now()}`;
    console.log(`Created order ${orderId} for customer ${input.customerId}`);
    return new StepResponse({ orderId }, { orderId });
  },
  compensate: async (data) => {
    if ("orderId" in data) {
      console.log(`Cancelled order ${data.orderId}`);
    }
  },
});

const updateInventory = createSagaStep<
  { orderId: string; items: string[] },
  { updated: boolean },
  { orderId: string; items: string[] }
>({
  name: "UpdateInventory",
  run: async ({ input }) => {
    console.log(`Reserved inventory for order ${input.orderId}`);
    return new StepResponse({ updated: true }, input);
  },
  compensate: async (data) => {
    console.log(`Released inventory for order ${data.orderId}`);
  },
});

// Main order workflow that composes payment and shipping
export const orderWorkflow = createSagaWorkflow(
  "OrderWorkflow",
  async (
    saga,
    input: {
      customerId: string;
      items: string[];
      amount: number;
      cardToken: string;
      address: string;
    }
  ) => {
    // Step 1: Create order
    const order = await createOrder(saga, {
      customerId: input.customerId,
      items: input.items,
    });

    // Step 2: Update inventory
    await updateInventory(saga, {
      orderId: order.orderId,
      items: input.items,
    });

    // Step 3: Process payment using runAsStep
    // Payment workflow's compensations join this saga
    const payment = await paymentWorkflow.runAsStep(saga, {
      amount: input.amount,
      cardToken: input.cardToken,
    });

    // Step 4: Ship order using runAsStep
    // If shipping fails, payment, inventory, AND order are all rolled back
    const shipment = await shippingWorkflow.runAsStep(saga, {
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

// All three workflows are available as separate services
restate
  .endpoint()
  .bind(paymentWorkflow)
  .bind(shippingWorkflow)
  .bind(orderWorkflow)
  .listen(9080);
