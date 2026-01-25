import * as restate from "@restatedev/restate-sdk";
import type { ErrorClass, ErrorMapper } from "./types.js";

/**
 * Global configuration for terminal errors.
 */
interface GlobalErrorConfig {
  /** Error classes that should always be treated as terminal */
  terminalErrorClasses: Set<ErrorClass>;
  /** Custom global error mapper function */
  globalMapper: ErrorMapper | null;
}

const globalErrorConfig: GlobalErrorConfig = {
  terminalErrorClasses: new Set(),
  globalMapper: null,
};

/**
 * Register error classes that should always be treated as TerminalError.
 * These errors will not be retried and will trigger saga compensation.
 *
 * @param errorClasses - Array of error class constructors to register
 *
 * @example
 * ```typescript
 * // Define custom error classes
 * class ValidationError extends Error {
 *   constructor(message: string) {
 *     super(message);
 *     this.name = "ValidationError";
 *   }
 * }
 *
 * class NotFoundError extends Error {
 *   constructor(message: string) {
 *     super(message);
 *     this.name = "NotFoundError";
 *   }
 * }
 *
 * // Register them globally
 * registerTerminalErrors([ValidationError, NotFoundError]);
 *
 * // Now any step that throws these will trigger compensation
 * const myStep = createSagaStep({
 *   name: "MyStep",
 *   run: async ({ input }) => {
 *     if (!input.email) {
 *       throw new ValidationError("Email is required"); // → Triggers compensation
 *     }
 *     // ...
 *   },
 * });
 * ```
 */
export function registerTerminalErrors(errorClasses: ErrorClass[]): void {
  for (const errorClass of errorClasses) {
    globalErrorConfig.terminalErrorClasses.add(errorClass);
  }
}

/**
 * Unregister error classes from the terminal error registry.
 *
 * @param errorClasses - Array of error class constructors to unregister
 */
export function unregisterTerminalErrors(errorClasses: ErrorClass[]): void {
  for (const errorClass of errorClasses) {
    globalErrorConfig.terminalErrorClasses.delete(errorClass);
  }
}

/**
 * Clear all registered terminal error classes.
 */
export function clearTerminalErrors(): void {
  globalErrorConfig.terminalErrorClasses.clear();
}

/**
 * Set a global error mapper function.
 * This mapper is used when no step-level mapper is provided or when
 * the step-level mapper returns undefined.
 *
 * @param mapper - Error mapper function, or null to clear
 *
 * @example
 * ```typescript
 * setGlobalErrorMapper((err) => {
 *   // Map HTTP 4xx errors to terminal
 *   if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
 *     return new restate.TerminalError(err.message);
 *   }
 *   // Map errors with specific codes
 *   if (err instanceof AppError && err.code === "DUPLICATE_ENTRY") {
 *     return new restate.TerminalError("Record already exists");
 *   }
 *   return undefined; // Let other errors retry
 * });
 * ```
 */
export function setGlobalErrorMapper(mapper: ErrorMapper | null): void {
  globalErrorConfig.globalMapper = mapper;
}

/**
 * Get the current global error mapper function.
 *
 * @returns The current global error mapper, or null if not set
 */
export function getGlobalErrorMapper(): ErrorMapper | null {
  return globalErrorConfig.globalMapper;
}

/**
 * Check if an error should be terminal based on global configuration.
 * Resolution order:
 * 1. Check if error is instance of any registered terminal error class
 * 2. Check global mapper function
 * 3. Return undefined (error will be retried)
 *
 * @internal
 */
function checkGlobalTerminalError(err: unknown): restate.TerminalError | undefined {
  // Check registered error classes
  if (err instanceof Error) {
    for (const errorClass of Array.from(globalErrorConfig.terminalErrorClasses)) {
      if (err instanceof errorClass) {
        return new restate.TerminalError(err.message);
      }
    }
  }

  // Check global mapper
  if (globalErrorConfig.globalMapper) {
    return globalErrorConfig.globalMapper(err);
  }

  return undefined;
}

/**
 * Resolve terminal error using step-level mapper first, then global config.
 * This is the main function used by saga steps to determine if an error
 * should trigger compensation.
 *
 * Resolution order:
 * 1. Step-level asTerminalError mapper (if provided)
 * 2. Global registered error classes
 * 3. Global error mapper function
 * 4. undefined (error will be retried by Restate)
 *
 * @internal
 */
export function resolveTerminalError(
  err: unknown,
  stepMapper?: ErrorMapper
): restate.TerminalError | undefined {
  // Step-level mapper takes precedence
  if (stepMapper) {
    const result = stepMapper(err);
    if (result) {
      return result;
    }
  }

  // Fall back to global configuration
  return checkGlobalTerminalError(err);
}
