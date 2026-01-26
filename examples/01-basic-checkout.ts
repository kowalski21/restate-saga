/**
 * Basic Checkout Workflow
 *
 * A simple e-commerce checkout demonstrating the core saga pattern:
 * - Multiple steps with compensation
 * - Automatic rollback on failure
 * - Type-safe step definitions
 */

import * as restate from "@restatedev/restate-sdk";
import { createSagaWorkflow, createSagaStep, StepResponse, InferServiceType } from "../src/index.js";

// Step 1: Reserve inventory
const reserveInventory = createSagaStep<
  { productId: string; quantity: number },
  { reservationId: string },
  { reservationId: string }
>({
  name: "ReserveInventory",
  run: async ({ input }) => {
    // In production: call inventory service
    const reservationId = `res_${Date.now()}`;
    console.log(`Reserved ${input.quantity} of ${input.productId}`);
    return new StepResponse({ reservationId }, { reservationId });
  },
  compensate: async (data) => {
    // Release the reservation (use type guard for union type)
    if ("reservationId" in data) {
      console.log(`Released reservation ${data.reservationId}`);
    }
  },
});

// Step 2: Charge payment
const chargePayment = createSagaStep<
  { amount: number; currency: string },
  { paymentId: string },
  { paymentId: string; amount: number }
>({
  name: "ChargePayment",
  run: async ({ input }) => {
    // In production: call payment gateway
    const paymentId = `pay_${Date.now()}`;
    console.log(`Charged ${input.amount} ${input.currency}`);
    return new StepResponse({ paymentId }, { paymentId, amount: input.amount });
  },
  compensate: async (data) => {
    // Refund the payment (use type guard for union type)
    if ("paymentId" in data) {
      console.log(`Refunded ${data.amount} for payment ${data.paymentId}`);
    }
  },
});

// Step 3: Create shipment
const createShipment = createSagaStep<
  { orderId: string; address: string },
  { trackingNumber: string },
  { trackingNumber: string }
>({
  name: "CreateShipment",
  run: async ({ input }) => {
    // Simulate occasional failures
    if (input.address === "FAIL") {
      return StepResponse.permanentFailure("Invalid shipping address", {
        trackingNumber: "",
      });
    }
    const trackingNumber = `TRACK_${Date.now()}`;
    console.log(`Created shipment to ${input.address}`);
    return new StepResponse({ trackingNumber }, { trackingNumber });
  },
  compensate: async (data) => {
    if ("trackingNumber" in data && data.trackingNumber) {
      console.log(`Cancelled shipment ${data.trackingNumber}`);
    }
  },
});

// Checkout workflow
export const checkoutWorkflow = createSagaWorkflow(
  "CheckoutWorkflow",
  async (
    saga,
    input: {
      productId: string;
      quantity: number;
      amount: number;
      currency: string;
      address: string;
    },
  ) => {
    // Step 1: Reserve inventory
    const inventory = await reserveInventory(saga, {
      productId: input.productId,
      quantity: input.quantity,
    });

    // Step 2: Charge payment
    const payment = await chargePayment(saga, {
      amount: input.amount,
      currency: input.currency,
    });

    // Step 3: Create shipment
    // If this fails, payment and inventory are automatically rolled back
    const shipment = await createShipment(saga, {
      orderId: `order_${Date.now()}`,
      address: input.address,
    });

    return {
      reservationId: inventory.reservationId,
      paymentId: payment.paymentId,
      trackingNumber: shipment.trackingNumber,
    };
  },
);

export type CheckoutWorkflow = InferServiceType<typeof checkoutWorkflow>;
// Start the service
restate.endpoint().bind(checkoutWorkflow).listen(9080);
