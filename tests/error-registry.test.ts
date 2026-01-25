import { describe, it, expect, beforeEach } from "vitest";
import * as restate from "@restatedev/restate-sdk";
import {
  registerTerminalErrors,
  unregisterTerminalErrors,
  clearTerminalErrors,
  setGlobalErrorMapper,
  getGlobalErrorMapper,
  resolveTerminalError,
} from "../src/error-registry.js";

// Custom error classes for testing
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

class BusinessError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "BusinessError";
    this.code = code;
  }
}

describe("Error Registry", () => {
  beforeEach(() => {
    // Clean up before each test
    clearTerminalErrors();
    setGlobalErrorMapper(null);
  });

  describe("registerTerminalErrors", () => {
    it("should register error classes", () => {
      registerTerminalErrors([ValidationError, NotFoundError]);

      const result1 = resolveTerminalError(new ValidationError("test"));
      const result2 = resolveTerminalError(new NotFoundError("test"));

      expect(result1).toBeInstanceOf(restate.TerminalError);
      expect(result2).toBeInstanceOf(restate.TerminalError);
    });

    it("should not affect unregistered error classes", () => {
      registerTerminalErrors([ValidationError]);

      const result = resolveTerminalError(new NotFoundError("test"));

      expect(result).toBeUndefined();
    });
  });

  describe("unregisterTerminalErrors", () => {
    it("should unregister error classes", () => {
      registerTerminalErrors([ValidationError, NotFoundError]);
      unregisterTerminalErrors([ValidationError]);

      const result1 = resolveTerminalError(new ValidationError("test"));
      const result2 = resolveTerminalError(new NotFoundError("test"));

      expect(result1).toBeUndefined();
      expect(result2).toBeInstanceOf(restate.TerminalError);
    });
  });

  describe("clearTerminalErrors", () => {
    it("should clear all registered error classes", () => {
      registerTerminalErrors([ValidationError, NotFoundError]);
      clearTerminalErrors();

      const result1 = resolveTerminalError(new ValidationError("test"));
      const result2 = resolveTerminalError(new NotFoundError("test"));

      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();
    });
  });

  describe("setGlobalErrorMapper", () => {
    it("should set a global error mapper", () => {
      setGlobalErrorMapper((err) => {
        if (err instanceof BusinessError && err.code === "DUPLICATE") {
          return new restate.TerminalError("Duplicate entry");
        }
        return undefined;
      });

      const result = resolveTerminalError(new BusinessError("test", "DUPLICATE"));

      expect(result).toBeInstanceOf(restate.TerminalError);
      expect(result?.message).toBe("Duplicate entry");
    });

    it("should return undefined for non-matching errors", () => {
      setGlobalErrorMapper((err) => {
        if (err instanceof BusinessError && err.code === "DUPLICATE") {
          return new restate.TerminalError("Duplicate entry");
        }
        return undefined;
      });

      const result = resolveTerminalError(new BusinessError("test", "OTHER"));

      expect(result).toBeUndefined();
    });

    it("should clear mapper when set to null", () => {
      setGlobalErrorMapper((err) => new restate.TerminalError("mapped"));
      setGlobalErrorMapper(null);

      const result = resolveTerminalError(new Error("test"));

      expect(result).toBeUndefined();
    });
  });

  describe("getGlobalErrorMapper", () => {
    it("should return null when no mapper is set", () => {
      expect(getGlobalErrorMapper()).toBeNull();
    });

    it("should return the set mapper", () => {
      const mapper = (err: unknown) => undefined;
      setGlobalErrorMapper(mapper);

      expect(getGlobalErrorMapper()).toBe(mapper);
    });
  });

  describe("resolveTerminalError", () => {
    it("should prioritize step-level mapper over global config", () => {
      registerTerminalErrors([ValidationError]);

      const stepMapper = (err: unknown) => {
        if (err instanceof ValidationError) {
          return new restate.TerminalError("Step-level: " + (err as Error).message);
        }
        return undefined;
      };

      const result = resolveTerminalError(new ValidationError("test"), stepMapper);

      expect(result?.message).toBe("Step-level: test");
    });

    it("should fall back to global registry when step mapper returns undefined", () => {
      registerTerminalErrors([ValidationError]);

      const stepMapper = (err: unknown) => undefined;

      const result = resolveTerminalError(new ValidationError("test"), stepMapper);

      expect(result).toBeInstanceOf(restate.TerminalError);
      expect(result?.message).toBe("test");
    });

    it("should check global mapper after registered classes", () => {
      setGlobalErrorMapper((err) => {
        if (err instanceof Error && err.message.includes("special")) {
          return new restate.TerminalError("Special error");
        }
        return undefined;
      });

      const result = resolveTerminalError(new Error("This is special"));

      expect(result?.message).toBe("Special error");
    });

    it("should return undefined for non-matching errors", () => {
      const result = resolveTerminalError(new Error("regular error"));

      expect(result).toBeUndefined();
    });

    it("should handle non-Error objects", () => {
      registerTerminalErrors([ValidationError]);

      const result = resolveTerminalError("string error");

      expect(result).toBeUndefined();
    });
  });
});
