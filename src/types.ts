import type * as restate from "@restatedev/restate-sdk";

/**
 * Context passed to saga steps containing the Restate context and compensation stack.
 */
export type SagaContext = {
  ctx: restate.Context;
  compensations: Array<() => Promise<void>>;
};

/**
 * A saga step function signature.
 */
export type SagaStep<Input, Output> = (saga: SagaContext, input: Input) => Promise<Output>;

/**
 * Duration can be specified as an object with time units or as milliseconds.
 */
export type Duration = {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  millis?: number;
};

/**
 * Retry policy for step-level operations (ctx.run).
 */
export type StepRetryPolicy = {
  /** Max number of retry attempts before giving up */
  maxRetryAttempts?: number;
  /** Max duration of retries before giving up (ms or Duration) */
  maxRetryDuration?: Duration | number;
  /** Initial interval for first retry (ms or Duration) */
  initialRetryInterval?: Duration | number;
  /** Factor to multiply retry interval by after each attempt */
  retryIntervalFactor?: number;
  /** Maximum retry interval cap (ms or Duration) */
  maxRetryInterval?: Duration | number;
};

/**
 * Retry policy for service/workflow level.
 */
export type WorkflowRetryPolicy = {
  /** Max number of retry attempts (including initial) */
  maxAttempts?: number;
  /** What to do when max attempts reached */
  onMaxAttempts?: "pause" | "kill";
  /** Initial interval for first retry */
  initialInterval?: Duration | number;
  /** Factor to multiply retry interval by */
  exponentiationFactor?: number;
  /** Maximum retry interval cap */
  maxInterval?: Duration | number;
};

/**
 * Error mapper function type.
 * Maps custom errors to TerminalError for non-retryable failures.
 */
export type ErrorMapper = (err: unknown) => restate.TerminalError | undefined;

/**
 * Error class constructor type for registration.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ErrorClass = new (...args: any[]) => Error;

/**
 * Options for saga workflow (service-level).
 */
export type SagaWorkflowOptions = {
  /** Default retry policy for all handlers */
  retryPolicy?: WorkflowRetryPolicy;
  /** How long to retain idempotency keys */
  idempotencyRetention?: Duration | number;
  /** How long to retain execution journal */
  journalRetention?: Duration | number;
  /** Timeout for inactivity before suspension */
  inactivityTimeout?: Duration | number;
  /** Timeout before aborting after inactivity */
  abortTimeout?: Duration | number;
  /** If true, service can only be called from other services */
  ingressPrivate?: boolean;
  /** Map custom errors to TerminalError (non-retryable) */
  asTerminalError?: ErrorMapper;
};

/**
 * Options for individual saga steps.
 */
export type SagaStepOptions = {
  /** Retry policy for the forward action */
  retry?: StepRetryPolicy;
  /** Retry policy for the compensation action (defaults to forward policy) */
  compensationRetry?: StepRetryPolicy;
  /** Map custom errors to TerminalError (non-retryable) at step level */
  asTerminalError?: ErrorMapper;
};

/**
 * Options for Restate workflow (workflow-level).
 */
export type SagaRestateWorkflowOptions = {
  /** Default retry policy for all handlers */
  retryPolicy?: WorkflowRetryPolicy;
  /** How long to retain idempotency keys */
  idempotencyRetention?: Duration | number;
  /** How long to retain execution journal */
  journalRetention?: Duration | number;
  /** Timeout for inactivity before suspension */
  inactivityTimeout?: Duration | number;
  /** Timeout before aborting after inactivity */
  abortTimeout?: Duration | number;
  /** If true, workflow can only be called from other services */
  ingressPrivate?: boolean;
  /** Map custom errors to TerminalError (non-retryable) */
  asTerminalError?: ErrorMapper;
};

/**
 * Context for Restate Workflow saga handlers.
 */
export type SagaWorkflowContext = {
  ctx: restate.WorkflowContext;
  compensations: Array<() => Promise<void>>;
};

/**
 * Context for Virtual Object saga handlers.
 */
export type SagaObjectContext = {
  ctx: restate.ObjectContext;
  compensations: Array<() => Promise<void>>;
};

/**
 * Options for Restate virtual object (object-level).
 */
export type SagaVirtualObjectOptions = {
  /** Default retry policy for all handlers */
  retryPolicy?: WorkflowRetryPolicy;
  /** How long to retain idempotency keys */
  idempotencyRetention?: Duration | number;
  /** How long to retain execution journal */
  journalRetention?: Duration | number;
  /** Timeout for inactivity before suspension */
  inactivityTimeout?: Duration | number;
  /** Timeout before aborting after inactivity */
  abortTimeout?: Duration | number;
  /** If true, object can only be called from other services */
  ingressPrivate?: boolean;
  /** Map custom errors to TerminalError (non-retryable) */
  asTerminalError?: ErrorMapper;
};

/**
 * Handler definition for virtual object saga handlers.
 */
export type SagaObjectHandler<Input, Output> = (
  saga: SagaObjectContext,
  ctx: restate.ObjectContext,
  input: Input
) => Promise<Output>;

/**
 * Base saga context type that all saga contexts share.
 * Used for runAsStep to accept any saga context.
 */
export type AnySagaContext = {
  ctx: restate.Context;
  compensations: Array<() => Promise<void>>;
};

/**
 * Extracts the base Restate service type from a SagaWorkflowService or SagaVirtualObject.
 *
 * Use this when you need a type compatible with the Restate SDK client's
 * `serviceClient<T>({ name: "..." })` pattern, where you only import the type
 * (not the implementation).
 *
 * @example
 * ```typescript
 * // In your workflow file:
 * export const checkoutWorkflow = createSagaWorkflow(...);
 * export type CheckoutWorkflow = InferServiceType<typeof checkoutWorkflow>;
 *
 * // In your client code (separate package):
 * import type { CheckoutWorkflow } from "./workflows/checkout";
 *
 * const result = await restateClient
 *   .serviceClient<CheckoutWorkflow>({ name: "CheckoutWorkflow" })
 *   .run({ ... });
 * ```
 */
export type InferServiceType<T> = T extends { handlers: infer H; name: infer N extends string }
  ? restate.ServiceDefinition<N, H>
  : never;

/**
 * Extracts the base Restate virtual object type from a SagaVirtualObject.
 *
 * Use this when you need a type compatible with the Restate SDK client's
 * `objectClient<T>({ name: "..." }, key)` pattern.
 *
 * @example
 * ```typescript
 * // In your virtual object file:
 * export const accountObject = createSagaVirtualObject(...);
 * export type AccountObject = InferObjectType<typeof accountObject>;
 *
 * // In your client code (separate package):
 * import type { AccountObject } from "./objects/account";
 *
 * const balance = await restateClient
 *   .objectClient<AccountObject>({ name: "Account" }, "user-123")
 *   .getBalance();
 * ```
 */
export type InferObjectType<T> = T extends { handlers: infer H; name: infer N extends string }
  ? restate.VirtualObjectDefinition<N, H>
  : never;

// =============================================================================
// Internal Types for Restate SDK Integration
// =============================================================================

/**
 * Run options for ctx.run() operations.
 * Matches the Restate SDK's expected run options format.
 * @internal
 */
export type RestateRunOptions = {
  maxRetryAttempts?: number;
  maxRetryDuration?: Duration | number;
  initialRetryInterval?: Duration | number;
  retryIntervalFactor?: number;
  maxRetryInterval?: Duration | number;
};

/**
 * Type constraint for Restate service definitions.
 * Used to ensure type safety when working with service clients.
 * @internal
 */
export type RestateServiceDefinition = {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handlers: Record<string, (...args: any[]) => any>;
};

/**
 * Type constraint for Restate object definitions.
 * Used to ensure type safety when working with object clients.
 * @internal
 */
export type RestateObjectDefinition = RestateServiceDefinition;
