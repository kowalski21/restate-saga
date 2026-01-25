/**
 * Advanced Error Handling
 *
 * Demonstrates:
 * - Global terminal error registry
 * - Per-step error mapping
 * - Custom error mapper functions
 * - StepResponse.permanentFailure vs throwing errors
 */

import * as restate from "@restatedev/restate-sdk";
import {
  createSagaWorkflow,
  createSagaStep,
  StepResponse,
  registerTerminalErrors,
  setGlobalErrorMapper,
} from "../src/index.js";

// ============================================================
// Custom Error Classes
// ============================================================

class ValidationError extends Error {
  field: string;
  constructor(message: string, field: string) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

class BusinessRuleError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "BusinessRuleError";
    this.code = code;
  }
}

class ExternalServiceError extends Error {
  service: string;
  retryable: boolean;
  constructor(message: string, service: string, retryable: boolean) {
    super(message);
    this.name = "ExternalServiceError";
    this.service = service;
    this.retryable = retryable;
  }
}

// ============================================================
// Method 1: Register Error Classes Globally
// ============================================================

// These errors will ALWAYS trigger compensation (no retries)
registerTerminalErrors([ValidationError, BusinessRuleError]);

// ============================================================
// Method 2: Global Error Mapper for Complex Logic
// ============================================================

// Use when you need conditional logic based on error properties
setGlobalErrorMapper((err) => {
  // Only treat non-retryable external errors as terminal
  if (err instanceof ExternalServiceError && !err.retryable) {
    return new restate.TerminalError(
      `Service ${err.service} failed permanently: ${err.message}`
    );
  }
  // Return undefined to let Restate retry or use default behavior
  return undefined;
});

// ============================================================
// Steps with Different Error Handling Strategies
// ============================================================

// Strategy 1: Throw registered terminal error
const validateOrder = createSagaStep<
  { items: string[]; customerId: string },
  { valid: boolean },
  null
>({
  name: "ValidateOrder",
  run: async ({ input }) => {
    if (input.items.length === 0) {
      // This throws a ValidationError - registered as terminal
      throw new ValidationError("Order must have at least one item", "items");
    }
    if (!input.customerId) {
      throw new ValidationError("Customer ID is required", "customerId");
    }
    return new StepResponse({ valid: true }, null);
  },
  // No compensation needed for validation
});

// Strategy 2: Use StepResponse.permanentFailure for expected failures
const checkInventory = createSagaStep<
  { items: string[] },
  { available: boolean },
  { items: string[] }
>({
  name: "CheckInventory",
  run: async ({ input }) => {
    const unavailable = input.items.filter((item) => item.startsWith("OUT_"));

    if (unavailable.length > 0) {
      // Use permanentFailure for expected business failures
      // This gives you control over the error message and compensation data
      return StepResponse.permanentFailure(
        `Items unavailable: ${unavailable.join(", ")}`,
        { items: input.items }
      );
    }

    return new StepResponse({ available: true }, { items: input.items });
  },
  compensate: async (data) => {
    console.log(`Releasing inventory hold for: ${data.items.join(", ")}`);
  },
});

// Strategy 3: Throw error that uses global mapper
const callPaymentService = createSagaStep<
  { amount: number },
  { transactionId: string },
  { transactionId: string }
>({
  name: "CallPaymentService",
  run: async ({ input }) => {
    // Simulate different external service failures
    if (input.amount > 10000) {
      // Non-retryable: triggers compensation via global mapper
      throw new ExternalServiceError(
        "Amount exceeds limit",
        "PaymentGateway",
        false
      );
    }
    if (input.amount === 999) {
      // Retryable: will be retried by Restate
      throw new ExternalServiceError(
        "Temporary gateway error",
        "PaymentGateway",
        true
      );
    }

    const transactionId = `txn_${Date.now()}`;
    return new StepResponse({ transactionId }, { transactionId });
  },
  compensate: async (data) => {
    if ("transactionId" in data) {
      console.log(`Refunding transaction ${data.transactionId}`);
    }
  },
});

// Strategy 4: Per-step error mapper
const processShipping = createSagaStep<
  { address: string },
  { trackingId: string },
  { trackingId: string }
>({
  name: "ProcessShipping",
  run: async ({ input }) => {
    if (input.address === "BLOCKED") {
      throw new Error("Cannot ship to blocked address");
    }
    const trackingId = `TRACK_${Date.now()}`;
    return new StepResponse({ trackingId }, { trackingId });
  },
  compensate: async (data) => {
    if ("trackingId" in data) {
      console.log(`Cancelling shipment ${data.trackingId}`);
    }
  },
  // Per-step mapper: only applies to this step
  options: {
    asTerminalError: (err) => {
      if (err instanceof Error && err.message.includes("blocked")) {
        return new restate.TerminalError("Shipping address is not allowed");
      }
      return undefined;
    },
  },
});

// ============================================================
// Workflow
// ============================================================

export const orderWorkflow = createSagaWorkflow(
  "OrderWorkflow",
  async (
    saga,
    input: {
      customerId: string;
      items: string[];
      amount: number;
      address: string;
    }
  ) => {
    // Step 1: Validate (throws ValidationError if invalid)
    await validateOrder(saga, {
      items: input.items,
      customerId: input.customerId,
    });

    // Step 2: Check inventory (uses permanentFailure)
    await checkInventory(saga, { items: input.items });

    // Step 3: Payment (uses global error mapper)
    const payment = await callPaymentService(saga, { amount: input.amount });

    // Step 4: Shipping (uses per-step error mapper)
    const shipping = await processShipping(saga, { address: input.address });

    return {
      transactionId: payment.transactionId,
      trackingId: shipping.trackingId,
    };
  }
);

restate.endpoint().bind(orderWorkflow).listen(9080);
