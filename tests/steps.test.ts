import { describe, it, expect } from "vitest";
import { StepResponse, failure, success } from "../src/steps.js";

describe("StepResponse", () => {
  it("provides concise success and failure helpers", () => {
    expect(success({ ok: true }, { id: "1" })).toMatchObject({
      output: { ok: true },
      compensationData: { id: "1" },
      failed: false,
    });
    expect(failure("Nope", { id: "1" })).toMatchObject({
      compensationData: { id: "1" },
      failed: true,
      errorMessage: "Nope",
    });
  });
  describe("constructor", () => {
    it("should create a successful response with output and compensation data", () => {
      const response = new StepResponse(
        { orderId: "123" },
        { orderId: "123", amount: 100 }
      );

      expect(response.output).toEqual({ orderId: "123" });
      expect(response.compensationData).toEqual({ orderId: "123", amount: 100 });
      expect(response.failed).toBe(false);
      expect(response.errorMessage).toBeUndefined();
    });

    it("should handle null compensation data", () => {
      const response = new StepResponse({ valid: true }, null);

      expect(response.output).toEqual({ valid: true });
      expect(response.compensationData).toBeNull();
      expect(response.failed).toBe(false);
    });
  });

  describe("permanentFailure", () => {
    it("should create a failed response with message and compensation data", () => {
      const response = StepResponse.permanentFailure("Payment declined", {
        authId: "auth_123",
      });

      expect(response.output).toBeUndefined();
      expect(response.compensationData).toEqual({ authId: "auth_123" });
      expect(response.failed).toBe(true);
      expect(response.errorMessage).toBe("Payment declined");
    });

    it("should handle null compensation data in failure", () => {
      const response = StepResponse.permanentFailure("Validation failed", null);

      expect(response.compensationData).toBeNull();
      expect(response.failed).toBe(true);
      expect(response.errorMessage).toBe("Validation failed");
    });
  });
});
