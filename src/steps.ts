import * as restate from "@restatedev/restate-sdk";
import type { SagaContext, SagaStepOptions, StepRetryPolicy, RestateRunOptions } from "./types.js";
import { resolveTerminalError } from "./error-registry.js";

/**
 * Convert StepRetryPolicy to Restate RunOptions format.
 * @internal
 */
function toRunOptions(policy?: StepRetryPolicy): RestateRunOptions | undefined {
  if (!policy) return undefined;

  return {
    maxRetryAttempts: policy.maxRetryAttempts,
    maxRetryDuration: policy.maxRetryDuration,
    initialRetryInterval: policy.initialRetryInterval,
    retryIntervalFactor: policy.retryIntervalFactor,
    maxRetryInterval: policy.maxRetryInterval,
  };
}

/**
 * Helper to call ctx.run with optional run options.
 * This avoids TypeScript issues with passing undefined as the third parameter.
 * @internal
 */
async function runWithOptions<T>(
  ctx: restate.Context,
  name: string,
  fn: () => Promise<T>,
  options?: RestateRunOptions
): Promise<T> {
  if (options) {
    return ctx.run(name, fn, options);
  }
  return ctx.run(name, fn);
}

/**
 * Response object for saga steps.
 *
 * Usage:
 * - Success: `return new StepResponse(output, compensationData)`
 * - Failure with compensation: `return StepResponse.permanentFailure(message, compensationData)`
 *
 * @example
 * ```typescript
 * const myStep = createSagaStep({
 *   name: "CreateOrder",
 *   run: async ({ input }) => {
 *     const order = await orderService.create(input);
 *     return new StepResponse(
 *       { orderId: order.id },           // Output
 *       { orderId: order.id }            // Compensation data
 *     );
 *   },
 *   compensate: async (data) => {
 *     await orderService.cancel(data.orderId);
 *   },
 * });
 * ```
 */
export class StepResponse<Output, CompensationData> {
  readonly output: Output;
  readonly compensationData: CompensationData;
  readonly failed: boolean;
  readonly errorMessage?: string;

  constructor(output: Output, compensationData: CompensationData) {
    this.output = output;
    this.compensationData = compensationData;
    this.failed = false;
  }

  /**
   * Create a permanent failure response with compensation data.
   * Use this when a step partially completes and needs to pass
   * information about what succeeded to the compensation function.
   *
   * @example
   * ```typescript
   * const paymentStep = createSagaStep({
   *   name: "ProcessPayment",
   *   run: async ({ input }) => {
   *     const auth = await paymentGateway.authorize(input.amount);
   *
   *     // Authorization succeeded but capture failed
   *     const captureResult = await paymentGateway.capture(auth.id);
   *     if (!captureResult.success) {
   *       // Fail but provide auth ID for compensation to void it
   *       return StepResponse.permanentFailure("Capture failed", {
   *         authorizationId: auth.id,
   *       });
   *     }
   *
   *     return new StepResponse({ paymentId: captureResult.id }, { ... });
   *   },
   *   compensate: async (data) => {
   *     if (data.authorizationId) {
   *       await paymentGateway.voidAuthorization(data.authorizationId);
   *     }
   *   },
   * });
   * ```
   */
  static permanentFailure<C>(
    message: string,
    compensationData: C
  ): StepResponse<never, C> {
    // Create instance without constructor to avoid requiring output parameter.
    // Cast to writable version for assignment, then return as readonly.
    const response = Object.create(StepResponse.prototype) as {
      -readonly [K in keyof StepResponse<never, C>]: StepResponse<never, C>[K];
    };
    response.output = undefined as never;
    response.compensationData = compensationData;
    response.failed = true;
    response.errorMessage = message;
    return response as StepResponse<never, C>;
  }
}

/**
 * Creates a saga step with hybrid compensation (Restate + Medusa pattern).
 *
 * Key behaviors:
 * - `run` returns a StepResponse with output and compensationData
 * - Use `StepResponse.permanentFailure(msg, data)` to fail with compensation data
 * - `compensate` is optional - if provided, receives compensationData or falls back to input
 * - Compensation is registered BEFORE execution, so it runs even if step fails
 *
 * This hybrid approach ensures:
 * - If step succeeds: compensation uses rich output data
 * - If step fails with permanentFailure: compensation uses provided data
 * - If step throws: compensation uses input as fallback
 *
 * @example
 * ```typescript
 * // Step with compensation
 * const reserveInventory = createSagaStep({
 *   name: "ReserveInventory",
 *   options: {
 *     retry: { maxRetryAttempts: 3, initialRetryInterval: { seconds: 1 } },
 *     compensationRetry: { maxRetryAttempts: 5 },
 *   },
 *   run: async ({ input }) => {
 *     const reservation = await inventory.reserve(input.productId, input.quantity);
 *     return new StepResponse(
 *       { reservationId: reservation.id },
 *       { reservationId: reservation.id }
 *     );
 *   },
 *   compensate: async (data) => {
 *     if ("reservationId" in data) {
 *       await inventory.release(data.reservationId);
 *     }
 *   },
 * });
 *
 * // Step without compensation (validation, read-only, idempotent operations)
 * const validateInput = createSagaStep({
 *   name: "ValidateInput",
 *   run: async ({ input }) => {
 *     if (!input.email) {
 *       return StepResponse.permanentFailure("Email required", null);
 *     }
 *     return new StepResponse({ valid: true }, null);
 *   },
 *   // No compensate needed - validation has no side effects
 * });
 * ```
 */
export function createSagaStep<Input, Output, CompensationData = Input>(opts: {
  name: string;
  options?: SagaStepOptions;
  run: (args: {
    ctx: restate.Context;
    input: Input;
  }) => Promise<StepResponse<Output, CompensationData>>;
  /** Optional compensation function. If not provided, no rollback action is registered. */
  compensate?: (data: CompensationData | Input, context: { failed: boolean }) => Promise<void>;
}) {
  // Pre-compute run options for performance
  const runOptions = toRunOptions(opts.options?.retry);
  const compensationRunOptions = toRunOptions(
    opts.options?.compensationRetry ?? opts.options?.retry
  );
  const errorMapper = opts.options?.asTerminalError;

  return async (saga: SagaContext, input: Input) => {
    const { ctx, compensations } = saga;

    // Track step state
    let stepFailed = true;
    let compensationData: CompensationData | undefined;

    // 1️⃣ Register compensation FIRST (runs even if step fails) - only if compensate is provided
    if (opts.compensate) {
      const compensateFn = opts.compensate; // Capture for closure
      compensations.push(async () => {
        const data = compensationData !== undefined ? compensationData : input;
        await runWithOptions(
          ctx,
          `compensate:${opts.name}`,
          () => compensateFn(data as CompensationData | Input, { failed: stepFailed }),
          compensationRunOptions
        );
      });
    }

    // 2️⃣ Execute forward action with retry options and error mapping
    const response = await runWithOptions(
      ctx,
      opts.name,
      async () => {
        try {
          return await opts.run({ ctx, input });
        } catch (err) {
          // Map custom errors to TerminalError (step-level first, then global)
          const terminalError = resolveTerminalError(err, errorMapper);
          if (terminalError) {
            throw terminalError;
          }
          throw err;
        }
      },
      runOptions
    );

    // 3️⃣ Capture compensation data (available for both success and permanentFailure)
    compensationData = response.compensationData;

    // 4️⃣ Check if step returned permanentFailure
    if (response.failed) {
      throw new restate.TerminalError(response.errorMessage || "Step failed permanently");
    }

    // 5️⃣ Mark as succeeded
    stepFailed = false;

    return response.output;
  };
}

/**
 * Creates a saga step with strict Medusa-style compensation.
 *
 * Key behaviors:
 * - `run` returns a StepResponse with output and compensationData
 * - `compensate` ONLY runs if step completed successfully (optional)
 * - Compensation receives the exact compensationData returned by the step
 * - Does NOT support permanentFailure (use createSagaStep for that)
 *
 * Use when:
 * - Compensation requires data that only exists after step completes (e.g., orderId)
 * - You only want to roll back fully completed operations
 * - Step failure means no side effects occurred that need reversal
 *
 * @example
 * ```typescript
 * const createOrder = createSagaStepStrict({
 *   name: "CreateOrder",
 *   options: {
 *     retry: { maxRetryAttempts: 3 },
 *   },
 *   run: async ({ input }) => {
 *     const order = await orderService.create(input);
 *     return new StepResponse(
 *       { orderId: order.id },
 *       { orderId: order.id }
 *     );
 *   },
 *   compensate: async (data) => {
 *     await orderService.cancel(data.orderId);
 *   },
 * });
 *
 * // Step without compensation (validation, read-only, etc.)
 * const validateStep = createSagaStepStrict({
 *   name: "Validate",
 *   run: async ({ input }) => new StepResponse(result, null),
 * });
 * ```
 */
export function createSagaStepStrict<Input, Output, CompensationData>(opts: {
  name: string;
  options?: SagaStepOptions;
  run: (args: {
    ctx: restate.Context;
    input: Input;
  }) => Promise<StepResponse<Output, CompensationData>>;
  /** Optional compensation function. If not provided, no rollback action is registered. */
  compensate?: (data: CompensationData) => Promise<void>;
}) {
  // Pre-compute run options for performance
  const runOptions = toRunOptions(opts.options?.retry);
  const compensationRunOptions = toRunOptions(
    opts.options?.compensationRetry ?? opts.options?.retry
  );
  const errorMapper = opts.options?.asTerminalError;

  return async (saga: SagaContext, input: Input) => {
    const { ctx, compensations } = saga;

    // 1️⃣ Execute forward action FIRST with retry options and error mapping
    const response = await runWithOptions(
      ctx,
      opts.name,
      async () => {
        try {
          return await opts.run({ ctx, input });
        } catch (err) {
          // Map custom errors to TerminalError (step-level first, then global)
          const terminalError = resolveTerminalError(err, errorMapper);
          if (terminalError) {
            throw terminalError;
          }
          throw err;
        }
      },
      runOptions
    );

    // 2️⃣ If permanentFailure, throw without registering compensation
    if (response.failed) {
      throw new restate.TerminalError(response.errorMessage || "Step failed permanently");
    }

    // 3️⃣ Register compensation AFTER success (only for completed steps) - only if compensate is provided
    if (opts.compensate) {
      const compensateFn = opts.compensate; // Capture for closure
      compensations.push(() =>
        runWithOptions(
          ctx,
          `compensate:${opts.name}`,
          () => compensateFn(response.compensationData),
          compensationRunOptions
        )
      );
    }

    return response.output;
  };
}
