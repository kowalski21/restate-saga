import * as restate from "@restatedev/restate-sdk";
import type {
  RestateServiceDefinition,
  RestateObjectDefinition,
} from "./types.js";

/**
 * Type helper to extract input type from a saga workflow.
 *
 * @example
 * ```typescript
 * import { checkoutWorkflow } from "./workflows/checkout.js";
 *
 * type Input = WorkflowInput<typeof checkoutWorkflow>;
 * // { customerId: string; items: Item[] }
 * ```
 */
export type WorkflowInput<T> = T extends {
  handlers: { run: (ctx: any, input: infer I) => any };
}
  ? I
  : never;

/**
 * Type helper to extract output type from a saga workflow.
 *
 * @example
 * ```typescript
 * import { checkoutWorkflow } from "./workflows/checkout.js";
 *
 * type Output = WorkflowOutput<typeof checkoutWorkflow>;
 * // { orderId: string; shipmentId: string }
 * ```
 */
export type WorkflowOutput<T> = T extends {
  handlers: { run: (ctx: any, input: any) => Promise<infer O> };
}
  ? O
  : never;

/** The typed client returned by the in-handler client helpers. */
export type SagaClient<T extends RestateServiceDefinition> = restate.Client<T["handlers"]>;

/** The typed fire-and-forget client returned by the in-handler helpers. */
export type SagaSendClient<T extends RestateServiceDefinition> = restate.SendClient<T["handlers"]>;

/** A typed client for a keyed Restate Workflow. */
export type SagaWorkflowClient<T extends RestateServiceDefinition> = SagaClient<T>;

/** A typed send client for a keyed Restate Workflow. */
export type SagaWorkflowSendClient<T extends RestateServiceDefinition> = SagaSendClient<T>;

/**
 * Create a typed client for calling a keyed Restate Workflow.
 *
 * @param ctx - The Restate context
 * @param definition - The workflow definition (import the actual workflow)
 * @param key - The workflow ID
 * @returns A typed client for calling the workflow
 *
 * @example
 * ```typescript
 * import { paymentWorkflow } from "./workflows/payment.js";
 *
 * // In a saga step
 * const client = workflowClient(ctx, paymentWorkflow, "payment-123");
 * const result = await client.run({ amount: 100, customerId: "123" });
 * ```
 *
 * Omitting `key` is supported for backward compatibility and uses the
 * previous service-style client behavior.
 */
export function workflowClient<T extends RestateServiceDefinition>(
  ctx: restate.Context,
  definition: T
): SagaClient<T>;
export function workflowClient<T extends RestateServiceDefinition>(
  ctx: restate.Context,
  definition: T,
  key: string
): SagaWorkflowClient<T>;
export function workflowClient<T extends RestateServiceDefinition>(
  ctx: restate.Context,
  definition: T,
  key?: string
) {
  if (key === undefined) {
    /** @deprecated Legacy saga workflows are regular Restate services. */
    return ctx.serviceClient(definition as any) as SagaClient<T>;
  }

  // Cast required because the SDK's definition type does not structurally retain
  // the handler map in all module-resolution modes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ctx.workflowClient(definition as any, key) as SagaWorkflowClient<T>;
}

/**
 * Create a typed send client for fire-and-forget calls to a keyed Restate Workflow.
 *
 * @param ctx - The Restate context
 * @param definition - The workflow service definition
 * @returns A typed send client
 *
 * @example
 * ```typescript
 * import { notificationWorkflow } from "./workflows/notification.js";
 *
 * // Fire and forget - don't wait for completion
 * const client = workflowSendClient(ctx, notificationWorkflow, "notification-123");
 * const handle = client.run({ userId: "123", message: "Hello" });
 * // If needed, await handle.invocationId to get the accepted invocation ID.
 * ```
 *
 * Omitting `key` is supported for backward compatibility and uses the
 * previous service-style client behavior.
 */
export function workflowSendClient<T extends RestateServiceDefinition>(
  ctx: restate.Context,
  definition: T
): SagaSendClient<T>;
export function workflowSendClient<T extends RestateServiceDefinition>(
  ctx: restate.Context,
  definition: T,
  key: string
): SagaWorkflowSendClient<T>;
export function workflowSendClient<T extends RestateServiceDefinition>(
  ctx: restate.Context,
  definition: T,
  key?: string
) {
  if (key === undefined) {
    /** @deprecated Legacy saga workflows are regular Restate services. */
    return ctx.serviceSendClient(definition as any) as SagaSendClient<T>;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ctx.workflowSendClient(definition as any, key) as SagaWorkflowSendClient<T>;
}

/**
 * Create a typed service client for calling a generic Restate service.
 *
 * @param ctx - The Restate context
 * @param definition - The service definition
 * @returns A typed client
 *
 * @example
 * ```typescript
 * import { inventoryService } from "./services/inventory.js";
 *
 * const client = serviceClient(ctx, inventoryService);
 * const stock = await client.checkStock({ productId: "abc" });
 * ```
 */
export function serviceClient<T extends RestateServiceDefinition>(
  ctx: restate.Context,
  definition: T
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ctx.serviceClient(definition as any) as SagaClient<T>;
}

/**
 * Create a typed send client for fire-and-forget calls to a generic Restate service.
 *
 * @param ctx - The Restate context
 * @param definition - The service definition
 * @returns A typed send client
 */
export function serviceSendClient<T extends RestateServiceDefinition>(
  ctx: restate.Context,
  definition: T
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ctx.serviceSendClient(definition as any) as SagaSendClient<T>;
}

/**
 * Create a typed object client for calling a Restate Virtual Object.
 *
 * @param ctx - The Restate context
 * @param definition - The virtual object definition
 * @param key - The object key (entity ID)
 * @returns A typed client for calling the object
 *
 * @example
 * ```typescript
 * import { walletObject } from "./objects/wallet.js";
 *
 * const wallet = objectClient(ctx, walletObject, "user-123");
 * const balance = await wallet.getBalance();
 * ```
 */
export function objectClient<T extends RestateObjectDefinition>(
  ctx: restate.Context,
  definition: T,
  key: string
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ctx.objectClient(definition as any, key) as SagaClient<T>;
}

/**
 * Create a typed send client for fire-and-forget calls to a Restate Virtual Object.
 *
 * @param ctx - The Restate context
 * @param definition - The virtual object definition
 * @param key - The object key (entity ID)
 * @returns A typed send client
 */
export function objectSendClient<T extends RestateObjectDefinition>(
  ctx: restate.Context,
  definition: T,
  key: string
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ctx.objectSendClient(definition as any, key) as SagaSendClient<T>;
}

/** Create a typed service client routed through a Restate scope. */
export function scopedServiceClient<T extends RestateServiceDefinition>(
  ctx: restate.Context,
  scope: string,
  definition: T
) {
  return ctx.scope(scope).serviceClient(definition as any) as SagaClient<T>;
}

/** Create a typed send client routed through a Restate scope. */
export function scopedServiceSendClient<T extends RestateServiceDefinition>(
  ctx: restate.Context,
  scope: string,
  definition: T
) {
  return ctx.scope(scope).serviceSendClient(definition as any) as SagaSendClient<T>;
}

/** Create a typed workflow client routed through a Restate scope. */
export function scopedWorkflowClient<T extends RestateServiceDefinition>(
  ctx: restate.Context,
  scope: string,
  definition: T,
  key: string
) {
  return ctx.scope(scope).workflowClient(definition as any, key) as SagaWorkflowClient<T>;
}

/** Create a typed workflow send client routed through a Restate scope. */
export function scopedWorkflowSendClient<T extends RestateServiceDefinition>(
  ctx: restate.Context,
  scope: string,
  definition: T,
  key: string
) {
  return ctx.scope(scope).workflowSendClient(definition as any, key) as SagaWorkflowSendClient<T>;
}

/** Create a typed virtual-object client routed through a Restate scope. */
export function scopedObjectClient<T extends RestateObjectDefinition>(
  ctx: restate.Context,
  scope: string,
  definition: T,
  key: string
) {
  return ctx.scope(scope).objectClient(definition as any, key) as SagaClient<T>;
}

/** Create a typed virtual-object send client routed through a Restate scope. */
export function scopedObjectSendClient<T extends RestateObjectDefinition>(
  ctx: restate.Context,
  scope: string,
  definition: T,
  key: string
) {
  return ctx.scope(scope).objectSendClient(definition as any, key) as SagaSendClient<T>;
}

/** Wait for a named signal on the current invocation. */
export function waitForSignal<T>(ctx: restate.Context, name: string) {
  return ctx.signal<T>(name);
}

/** Get a reference used to attach to, cancel, or signal another invocation. */
export function invocation(ctx: restate.Context, invocationId: restate.InvocationId) {
  return ctx.invocation(invocationId);
}

/** Resolve a named signal on another invocation. */
export function resolveSignal<T>(
  ctx: restate.Context,
  invocationId: restate.InvocationId,
  name: string,
  payload?: T
): void {
  ctx.invocation(invocationId).signal<T>(name).resolve(payload);
}

/** Reject a named signal on another invocation. */
export function rejectSignal(
  ctx: restate.Context,
  invocationId: restate.InvocationId,
  name: string,
  reason: string | restate.TerminalError
): void {
  ctx.invocation(invocationId).signal(name).reject(reason);
}
