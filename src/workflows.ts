import * as restate from "@restatedev/restate-sdk";
import type {
  SagaContext,
  SagaWorkflowContext,
  SagaWorkflowOptions,
  SagaRestateWorkflowOptions,
  WorkflowRetryPolicy,
  AnySagaContext,
} from "./types.js";

/**
 * Convert WorkflowRetryPolicy to Restate service options format.
 * @internal
 */
function toServiceRetryPolicy(policy?: WorkflowRetryPolicy): object | undefined {
  if (!policy) return undefined;

  return {
    maxAttempts: policy.maxAttempts,
    onMaxAttempts: policy.onMaxAttempts,
    initialInterval: policy.initialInterval,
    exponentiationFactor: policy.exponentiationFactor,
    maxInterval: policy.maxInterval,
  };
}

/**
 * Return type for createSagaWorkflow that includes runAsStep capability.
 * Explicitly types the handlers so external clients can infer method signatures.
 */
export type SagaWorkflowService<Name extends string, Input, Output> = {
  name: Name;
  handlers: {
    run: (ctx: restate.Context, input: Input) => Promise<Output>;
  };
} & {
  /**
   * Run this workflow as a step in a parent saga.
   *
   * When called, the workflow's steps register their compensations with the
   * parent's saga context. If the parent saga fails after this workflow
   * completes, all compensations (including this workflow's) run in reverse order.
   *
   * This method accepts any saga context type:
   * - `SagaContext` (from createSagaWorkflow)
   * - `SagaObjectContext` (from createSagaVirtualObject)
   * - `SagaWorkflowContext` (from createSagaRestateWorkflow)
   *
   * @param parentSaga - The parent saga context to register compensations with
   * @param input - The workflow input
   * @returns The workflow output
   *
   * @example
   * ```typescript
   * // Define a payment workflow
   * export const paymentWorkflow = createSagaWorkflow(
   *   "PaymentWorkflow",
   *   async (saga, input: { amount: number }) => {
   *     const auth = await authorizePayment(saga, input);
   *     const capture = await capturePayment(saga, { paymentId: auth.id });
   *     return { paymentId: capture.id };
   *   }
   * );
   *
   * // Use in a parent workflow
   * export const orderWorkflow = createSagaWorkflow(
   *   "OrderWorkflow",
   *   async (saga, input) => {
   *     const order = await createOrder(saga, input);
   *
   *     // Run payment workflow as a step - compensations join parent's saga
   *     const payment = await paymentWorkflow.runAsStep(saga, {
   *       amount: input.total,
   *     });
   *
   *     // If shipping fails, both order AND payment compensations run
   *     const shipping = await shipOrder(saga, { orderId: order.id });
   *
   *     return { orderId: order.id, paymentId: payment.paymentId };
   *   }
   * );
   * ```
   */
  runAsStep: (parentSaga: AnySagaContext, input: Input) => Promise<Output>;
};

/**
 * Creates a saga workflow that orchestrates multiple steps with automatic compensation.
 *
 * The returned workflow can be:
 * 1. Called as a standalone service via Restate (normal service call)
 * 2. Embedded in another workflow using `runAsStep` (compensations join parent)
 *
 * @param name - The service name for this workflow
 * @param handler - The workflow handler that executes steps
 * @param options - Optional service-level configuration (retry policy, timeouts, etc.)
 *
 * @example
 * ```typescript
 * // Create and export the workflow
 * export const checkoutWorkflow = createSagaWorkflow(
 *   "CheckoutWorkflow",
 *   async (saga, input: { customerId: string; items: Item[] }) => {
 *     const order = await createOrder(saga, input);
 *     const payment = await processPayment(saga, { orderId: order.id, amount: order.total });
 *     const shipment = await createShipment(saga, { orderId: order.id });
 *     return { orderId: order.id, shipmentId: shipment.id };
 *   },
 *   {
 *     retryPolicy: { maxAttempts: 5, initialInterval: { seconds: 1 } },
 *     inactivityTimeout: { minutes: 10 },
 *   }
 * );
 *
 * // Export the type for other services to use
 * export type CheckoutWorkflow = typeof checkoutWorkflow;
 * ```
 */
export function createSagaWorkflow<Name extends string, Input, Output>(
  name: Name,
  handler: (saga: SagaContext, input: Input) => Promise<Output>,
  options?: SagaWorkflowOptions
): SagaWorkflowService<Name, Input, Output> {
  // Build service options
  const serviceOptions = options
    ? {
        retryPolicy: toServiceRetryPolicy(options.retryPolicy),
        idempotencyRetention: options.idempotencyRetention,
        journalRetention: options.journalRetention,
        inactivityTimeout: options.inactivityTimeout,
        abortTimeout: options.abortTimeout,
        ingressPrivate: options.ingressPrivate,
        asTerminalError: options.asTerminalError,
      }
    : undefined;

  const service = restate.service({
    name,
    handlers: {
      run: async (ctx: restate.Context, input: Input) => {
        const saga: SagaContext = {
          ctx,
          compensations: [],
        };

        try {
          return await handler(saga, input);
        } catch (e) {
          if (e instanceof restate.TerminalError) {
            for (const compensate of saga.compensations.reverse()) {
              await compensate();
            }
          }
          throw e;
        }
      },
    },
    options: serviceOptions,
  });

  // Add runAsStep capability
  return Object.assign(service, {
    runAsStep: (parentSaga: AnySagaContext, input: Input): Promise<Output> => {
      // Execute the handler with the parent's saga context.
      // All steps will register their compensations with the parent's
      // compensation stack, so they run if the parent fails.
      return handler(parentSaga as SagaContext, input);
    },
  }) as SagaWorkflowService<Name, Input, Output>;
}

/**
 * Return type for createSagaRestateWorkflow that includes runAsStep capability.
 * Explicitly types the handlers so external clients can infer method signatures.
 */
export type SagaRestateWorkflowService<Name extends string, Input, Output> = {
  name: Name;
  handlers: {
    run: (ctx: restate.WorkflowContext, input: Input) => Promise<Output>;
  };
} & {
  /**
   * Run this workflow as a step in a parent Restate Workflow saga.
   *
   * When called, the workflow's steps register their compensations with the
   * parent's saga context. If the parent saga fails after this workflow
   * completes, all compensations run in reverse order.
   *
   * Note: The parent must be a Restate Workflow (not a regular service) because
   * this workflow's handler may use WorkflowContext-specific features like
   * `ctx.workflowId()` or durable promises.
   *
   * @param parentSaga - The parent Restate Workflow saga context
   * @param input - The workflow input
   * @returns The workflow output
   */
  runAsStep: (parentSaga: SagaWorkflowContext, input: Input) => Promise<Output>;
};

/**
 * Creates a Restate Workflow with saga pattern support.
 *
 * Restate Workflows are long-running processes identified by a unique workflowId.
 * The `run` handler executes exactly once per workflowId, with automatic deduplication.
 * Additional handlers can be used for signals and queries while the workflow runs.
 *
 * The returned workflow can be:
 * 1. Called as a standalone workflow via Restate (normal workflow call)
 * 2. Embedded in another Restate Workflow using `runAsStep` (compensations join parent)
 *
 * @param name - The workflow name
 * @param run - The main workflow handler with saga support
 * @param handlers - Optional additional handlers (signals, queries) without saga support
 * @param options - Optional workflow-level configuration
 *
 * @example
 * ```typescript
 * export const orderWorkflow = createSagaRestateWorkflow(
 *   "OrderWorkflow",
 *   async (saga, ctx, input: { customerId: string; items: Item[] }) => {
 *     const payment = await chargePayment(saga, input);
 *     const order = await createOrder(saga, { ...input, paymentId: payment.id });
 *     return { orderId: order.id };
 *   },
 *   {
 *     // Optional signal/query handlers
 *     getStatus: async (ctx) => {
 *       return ctx.promise<string>("status");
 *     },
 *     cancel: async (ctx) => {
 *       ctx.resolvePromise("cancelled", true);
 *     },
 *   },
 *   {
 *     retryPolicy: { maxAttempts: 5 },
 *   }
 * );
 *
 * // Call with workflowId:
 * // client.workflowSubmit("OrderWorkflow", "order-123", { customerId: "cust-1", items: [] });
 * ```
 */
export function createSagaRestateWorkflow<
  Name extends string,
  Input,
  Output,
  Handlers extends Record<
    string,
    (ctx: restate.WorkflowSharedContext, input: any) => Promise<any>
  > = Record<string, never>,
>(
  name: Name,
  run: (saga: SagaWorkflowContext, ctx: restate.WorkflowContext, input: Input) => Promise<Output>,
  handlers?: Handlers,
  options?: SagaRestateWorkflowOptions
): SagaRestateWorkflowService<Name, Input, Output> {
  // Build workflow options
  const workflowOptions = options
    ? {
        retryPolicy: toServiceRetryPolicy(options.retryPolicy),
        idempotencyRetention: options.idempotencyRetention,
        journalRetention: options.journalRetention,
        inactivityTimeout: options.inactivityTimeout,
        abortTimeout: options.abortTimeout,
        ingressPrivate: options.ingressPrivate,
        asTerminalError: options.asTerminalError,
      }
    : undefined;

  const workflow = restate.workflow({
    name,
    handlers: {
      run: async (ctx: restate.WorkflowContext, input: Input) => {
        const saga: SagaWorkflowContext = {
          ctx,
          compensations: [],
        };

        try {
          return await run(saga, ctx, input);
        } catch (e) {
          if (e instanceof restate.TerminalError) {
            for (const compensate of saga.compensations.reverse()) {
              await compensate();
            }
          }
          throw e;
        }
      },
      ...handlers,
    },
    options: workflowOptions,
  });

  // Add runAsStep capability
  return Object.assign(workflow, {
    runAsStep: (parentSaga: SagaWorkflowContext, input: Input): Promise<Output> => {
      // Execute the handler with the parent's saga context and WorkflowContext.
      return run(parentSaga, parentSaga.ctx, input);
    },
  }) as SagaRestateWorkflowService<Name, Input, Output>;
}
