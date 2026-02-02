/**
 * Integration tests for runAsStep functionality.
 *
 * Note: These tests demonstrate composing workflows using runAsStep.
 * Type assertions are used where the hybrid compensation pattern creates
 * union types (Input | CompensationData).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import * as clients from "@restatedev/restate-sdk-clients";
import {
  createSagaWorkflow,
  createSagaStep,
  StepResponse,
  type InferServiceType,
} from "../../src/index.js";

// Track compensation calls
const compensationLog: string[] = [];

// Payment workflow steps - using type guards for compensation data
const authorizePayment = createSagaStep<
  { amount: number },
  { authId: string },
  { authId: string }
>({
  name: "AuthorizePayment",
  run: async ({ input }) => {
    const authId = `auth_${Date.now()}`;
    return new StepResponse({ authId }, { authId });
  },
  compensate: async (data) => {
    // Type guard for hybrid compensation pattern
    if ("authId" in data) {
      compensationLog.push(`void:${data.authId}`);
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
    return new StepResponse({ captureId }, { captureId, amount: input.amount });
  },
  compensate: async (data) => {
    // Type guard for hybrid compensation pattern
    if ("captureId" in data) {
      compensationLog.push(`refund:${data.captureId}:${data.amount}`);
    }
  },
});

// Payment workflow (can run standalone or as a step)
const paymentWorkflow = createSagaWorkflow(
  "PaymentWorkflow",
  async (saga, input: { amount: number }) => {
    const auth = await authorizePayment(saga, { amount: input.amount });
    const capture = await capturePayment(saga, {
      authId: auth.authId,
      amount: input.amount,
    });
    return { paymentId: capture.captureId };
  }
);
type PaymentWorkflowService = InferServiceType<typeof paymentWorkflow>;

// Order workflow steps
const createOrder = createSagaStep<
  { customerId: string },
  { orderId: string },
  { orderId: string }
>({
  name: "CreateOrder",
  run: async ({ input }) => {
    const orderId = `order_${Date.now()}`;
    return new StepResponse({ orderId }, { orderId });
  },
  compensate: async (data) => {
    if ("orderId" in data) {
      compensationLog.push(`cancel:${data.orderId}`);
    }
  },
});

const shipOrder = createSagaStep<
  { orderId: string; shouldFail: boolean },
  { shipmentId: string },
  { shipmentId: string }
>({
  name: "ShipOrder",
  run: async ({ input }) => {
    if (input.shouldFail) {
      return StepResponse.permanentFailure("Shipping failed", {
        shipmentId: "",
      });
    }
    const shipmentId = `ship_${Date.now()}`;
    return new StepResponse({ shipmentId }, { shipmentId });
  },
  compensate: async (data) => {
    if ("shipmentId" in data && data.shipmentId) {
      compensationLog.push(`cancelShipment:${data.shipmentId}`);
    }
  },
});

// Order workflow that uses payment workflow as a step
const orderWorkflow = createSagaWorkflow(
  "OrderWorkflow",
  async (
    saga,
    input: { customerId: string; amount: number; shouldFailShipping: boolean }
  ) => {
    // Create order
    const order = await createOrder(saga, { customerId: input.customerId });

    // Process payment using runAsStep - compensations join this saga
    const payment = await paymentWorkflow.runAsStep(saga, {
      amount: input.amount,
    });

    // Ship order (may fail)
    const shipment = await shipOrder(saga, {
      orderId: order.orderId,
      shouldFail: input.shouldFailShipping,
    });

    return {
      orderId: order.orderId,
      paymentId: payment.paymentId,
      shipmentId: shipment.shipmentId,
    };
  }
);
type OrderWorkflowService = InferServiceType<typeof orderWorkflow>;

describe("runAsStep Integration", () => {
  let restateTestEnvironment: RestateTestEnvironment;
  let restateIngress: clients.Ingress;

  beforeAll(async () => {
    restateTestEnvironment = await RestateTestEnvironment.start({
      services: [paymentWorkflow, orderWorkflow],
    });
    restateIngress = clients.connect({
      url: restateTestEnvironment.baseUrl(),
    });
  }, 30000);

  afterAll(async () => {
    await restateTestEnvironment?.stop();
  });

  describe("Standalone workflow", () => {
    it("should execute payment workflow independently", async () => {
      compensationLog.length = 0;
      const client = restateIngress.serviceClient<PaymentWorkflowService>({
        name: "PaymentWorkflow",
      });

      const result = await client.run({ amount: 100 });

      expect(result.paymentId).toMatch(/^cap_/);
      expect(compensationLog).toHaveLength(0);
    });
  });

  describe("Workflow as step", () => {
    it("should complete order with embedded payment workflow", async () => {
      compensationLog.length = 0;
      const client = restateIngress.serviceClient<OrderWorkflowService>({
        name: "OrderWorkflow",
      });

      const result = await client.run({
        customerId: "cust_123",
        amount: 150,
        shouldFailShipping: false,
      });

      expect(result.orderId).toMatch(/^order_/);
      expect(result.paymentId).toMatch(/^cap_/);
      expect(result.shipmentId).toMatch(/^ship_/);
      expect(compensationLog).toHaveLength(0);
    });

    it("should compensate payment workflow when shipping fails", async () => {
      compensationLog.length = 0;
      const client = restateIngress.serviceClient<OrderWorkflowService>({
        name: "OrderWorkflow",
      });

      await expect(
        client.run({
          customerId: "cust_456",
          amount: 200,
          shouldFailShipping: true,
        })
      ).rejects.toThrow("Shipping failed");

      // Wait for compensations
      await new Promise((r) => setTimeout(r, 500));

      // Should compensate in reverse order:
      // 1. Ship order (no-op since it failed)
      // 2. Capture payment (refund)
      // 3. Authorize payment (void)
      // 4. Create order (cancel)
      expect(compensationLog.some((log) => log.startsWith("refund:"))).toBe(true);
      expect(compensationLog.some((log) => log.startsWith("void:"))).toBe(true);
      expect(compensationLog.some((log) => log.startsWith("cancel:"))).toBe(true);

      // Verify order: payment compensations should run before order compensation
      const refundIndex = compensationLog.findIndex((log) =>
        log.startsWith("refund:")
      );
      const cancelIndex = compensationLog.findIndex((log) =>
        log.startsWith("cancel:")
      );
      expect(refundIndex).toBeLessThan(cancelIndex);
    });
  });
});
