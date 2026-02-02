import * as restate from "@restatedev/restate-sdk";
import type { RestateServiceDefinition, RestateObjectDefinition } from "./types.js";

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

/**
 * Create a typed service client for calling another saga workflow.
 *
 * @param ctx - The Restate context
 * @param definition - The workflow service definition (import the actual workflow)
 * @returns A typed client for calling the workflow
 *
 * @example
 * ```typescript
 * import { paymentWorkflow } from "./workflows/payment.js";
 *
 * // In a saga step
 * const client = workflowClient(ctx, paymentWorkflow);
 * const result = await client.run({ amount: 100, customerId: "123" });
 * ```
 */
export function workflowClient<T extends RestateServiceDefinition>(
  ctx: restate.Context,
  definition: T
) {
  // Cast required: Restate SDK's serviceClient expects internal ServiceDefinitionFrom type,
  // but SagaWorkflowService extends the base ServiceDefinition with runAsStep capability.
  // The cast preserves runtime behavior while the generic constraint ensures type safety for callers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ctx.serviceClient(definition as any) as restate.Client<T["handlers"]>;
}

/**
 * Create a typed send client for fire-and-forget calls to another saga workflow.
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
 * const client = workflowSendClient(ctx, notificationWorkflow);
 * await client.run({ userId: "123", message: "Hello" });
 * ```
 */
export function workflowSendClient<T extends RestateServiceDefinition>(
  ctx: restate.Context,
  definition: T
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ctx.serviceSendClient(definition as any) as restate.SendClient<T["handlers"]>;
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
  return ctx.serviceClient(definition as any) as restate.Client<T["handlers"]>;
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
  return ctx.serviceSendClient(definition as any) as restate.SendClient<T["handlers"]>;
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
  return ctx.objectClient(definition as any, key) as restate.Client<T["handlers"]>;
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
  return ctx.objectSendClient(definition as any, key) as restate.SendClient<T["handlers"]>;
}
