// @ts-nocheck - SagaWorkflowService type is incompatible with SDK client types
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import * as clients from "@restatedev/restate-sdk-clients";
import {
  createSagaWorkflow,
  createSagaStep,
  StepResponse,
  registerTerminalErrors,
  clearTerminalErrors,
} from "../../src/index.js";

// Test error classes
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// Track compensation calls for verification
const compensationLog: string[] = [];

// Test steps
const step1 = createSagaStep<{ value: number }, { result: number }, { value: number }>({
  name: "Step1",
  run: async ({ input }) => {
    return new StepResponse({ result: input.value * 2 }, { value: input.value });
  },
  compensate: async (data) => {
    compensationLog.push(`compensate:step1:${data.value}`);
  },
});

const step2 = createSagaStep<{ result: number }, { final: number }, { result: number }>({
  name: "Step2",
  run: async ({ input }) => {
    return new StepResponse({ final: input.result + 10 }, { result: input.result });
  },
  compensate: async (data) => {
    compensationLog.push(`compensate:step2:${data.result}`);
  },
});

const failingStep = createSagaStep<{ shouldFail: boolean }, { success: boolean }, null>({
  name: "FailingStep",
  run: async ({ input }) => {
    if (input.shouldFail) {
      return StepResponse.permanentFailure("Intentional failure", null);
    }
    return new StepResponse({ success: true }, null);
  },
});

const validationStep = createSagaStep<{ email: string }, { valid: boolean }, null>({
  name: "ValidationStep",
  run: async ({ input }) => {
    if (!input.email.includes("@")) {
      throw new ValidationError("Invalid email format");
    }
    return new StepResponse({ valid: true }, null);
  },
});

// Test workflows
const successWorkflow = createSagaWorkflow(
  "SuccessWorkflow",
  async (saga, input: { value: number }) => {
    const s1 = await step1(saga, input);
    const s2 = await step2(saga, s1);
    return { finalValue: s2.final };
  }
);

const failureWorkflow = createSagaWorkflow(
  "FailureWorkflow",
  async (saga, input: { value: number; shouldFail: boolean }) => {
    const s1 = await step1(saga, { value: input.value });
    const s2 = await step2(saga, s1);
    await failingStep(saga, { shouldFail: input.shouldFail });
    return { finalValue: s2.final };
  }
);

const validationWorkflow = createSagaWorkflow(
  "ValidationWorkflow",
  async (saga, input: { email: string; value: number }) => {
    const s1 = await step1(saga, { value: input.value });
    await validationStep(saga, { email: input.email });
    return { result: s1.result };
  }
);

describe("Saga Workflow Integration", () => {
  let restateTestEnvironment: RestateTestEnvironment;
  let restateIngress: clients.Ingress;

  beforeAll(async () => {
    // Register terminal errors
    registerTerminalErrors([ValidationError]);

    restateTestEnvironment = await RestateTestEnvironment.start({
      services: [successWorkflow, failureWorkflow, validationWorkflow],
    });
    restateIngress = clients.connect({
      url: restateTestEnvironment.baseUrl(),
    });
  }, 30000);

  afterAll(async () => {
    clearTerminalErrors();
    await restateTestEnvironment?.stop();
  });

  describe("Successful execution", () => {
    it("should execute all steps and return result", async () => {
      const client = restateIngress.serviceClient(successWorkflow);

      const result = await client.run({ value: 5 });

      expect(result.finalValue).toBe(20); // (5 * 2) + 10
    });
  });

  describe("Compensation on failure", () => {
    it("should run compensations in reverse order when step fails", async () => {
      compensationLog.length = 0; // Clear log
      const client = restateIngress.serviceClient(failureWorkflow);

      await expect(
        client.run({ value: 7, shouldFail: true })
      ).rejects.toThrow("Intentional failure");

      // Wait a bit for compensations to complete
      await new Promise((r) => setTimeout(r, 500));

      // Compensations should run in reverse order
      expect(compensationLog).toContain("compensate:step2:14"); // 7 * 2
      expect(compensationLog).toContain("compensate:step1:7");
      expect(compensationLog.indexOf("compensate:step2:14")).toBeLessThan(
        compensationLog.indexOf("compensate:step1:7")
      );
    });

    it("should not run compensations when workflow succeeds", async () => {
      compensationLog.length = 0;
      const client = restateIngress.serviceClient(failureWorkflow);

      const result = await client.run({ value: 3, shouldFail: false });

      expect(result.finalValue).toBe(16); // (3 * 2) + 10
      expect(compensationLog).toHaveLength(0);
    });
  });

  describe("Terminal error handling", () => {
    it("should trigger compensation for registered terminal errors", async () => {
      compensationLog.length = 0;
      const client = restateIngress.serviceClient(validationWorkflow);

      await expect(
        client.run({ email: "invalid-email", value: 5 })
      ).rejects.toThrow("Invalid email format");

      await new Promise((r) => setTimeout(r, 500));

      expect(compensationLog).toContain("compensate:step1:5");
    });

    it("should succeed with valid input", async () => {
      const client = restateIngress.serviceClient(validationWorkflow);

      const result = await client.run({ email: "test@example.com", value: 5 });

      expect(result.result).toBe(10);
    });
  });
});
