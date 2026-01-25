import * as restate from "@restatedev/restate-sdk";
import type {
  SagaObjectContext,
  SagaObjectHandler,
  SagaVirtualObjectOptions,
  WorkflowRetryPolicy,
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
 * Creates a Restate Virtual Object with saga pattern support.
 *
 * Virtual Objects are keyed by an entity ID (key). Handlers execute with
 * mutual exclusion per key, making them ideal for entities like shopping carts,
 * user accounts, or any stateful resource.
 *
 * Handler types:
 * - **Exclusive handlers** (first parameter): Have saga support, mutual exclusion per key
 * - **Shared handlers** (second parameter): No saga support, concurrent access, read-only
 *
 * @param name - The virtual object name
 * @param handlers - Object handlers, each wrapped with saga support
 * @param sharedHandlers - Optional shared handlers (concurrent access, no saga support)
 * @param options - Optional object-level configuration
 *
 * @example
 * ```typescript
 * export const shoppingCart = createSagaVirtualObject(
 *   "ShoppingCart",
 *   {
 *     // Exclusive handlers with saga support
 *     checkout: async (saga, ctx, input: { paymentMethod: string }) => {
 *       const items = await ctx.get<Item[]>("items") || [];
 *       const payment = await chargePayment(saga, { items, method: input.paymentMethod });
 *       const order = await createOrder(saga, { items, paymentId: payment.id });
 *
 *       // Clear cart on success
 *       ctx.clear("items");
 *       return { orderId: order.id };
 *     },
 *     addItem: async (saga, ctx, item: Item) => {
 *       const items = await ctx.get<Item[]>("items") || [];
 *       items.push(item);
 *       ctx.set("items", items);
 *       return { itemCount: items.length };
 *     },
 *   },
 *   {
 *     // Shared handlers (read-only, concurrent)
 *     getItems: async (ctx) => {
 *       return await ctx.get<Item[]>("items") || [];
 *     },
 *     getTotal: async (ctx) => {
 *       const items = await ctx.get<Item[]>("items") || [];
 *       return items.reduce((sum, item) => sum + item.price, 0);
 *     },
 *   },
 *   {
 *     retryPolicy: { maxAttempts: 5 },
 *     inactivityTimeout: { minutes: 30 },
 *   }
 * );
 *
 * // Call with key:
 * // client.objectClient(shoppingCart, "cart-456").checkout({ paymentMethod: "credit_card" });
 * ```
 */
export function createSagaVirtualObject<
  SagaHandlers extends Record<string, SagaObjectHandler<any, any>>,
  SharedHandlers extends Record<
    string,
    (ctx: restate.ObjectSharedContext, input: any) => Promise<any>
  > = Record<string, never>,
>(
  name: string,
  handlers: SagaHandlers,
  sharedHandlers?: SharedHandlers,
  options?: SagaVirtualObjectOptions
) {
  // Build object options
  const objectOptions = options
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

  // Wrap each saga handler with compensation logic
  const wrappedHandlers: Record<
    string,
    (ctx: restate.ObjectContext, input: any) => Promise<any>
  > = {};

  for (const [handlerName, handler] of Object.entries(handlers)) {
    wrappedHandlers[handlerName] = async (ctx: restate.ObjectContext, input: any) => {
      const saga: SagaObjectContext = {
        ctx,
        compensations: [],
      };

      try {
        return await handler(saga, ctx, input);
      } catch (e) {
        if (e instanceof restate.TerminalError) {
          for (const compensate of saga.compensations.reverse()) {
            await compensate();
          }
        }
        throw e;
      }
    };
  }

  // Wrap shared handlers (no saga support, just pass through)
  const wrappedSharedHandlers: Record<string, any> = {};

  if (sharedHandlers) {
    for (const [handlerName, handler] of Object.entries(sharedHandlers)) {
      wrappedSharedHandlers[handlerName] = restate.handlers.object.shared(handler);
    }
  }

  return restate.object({
    name,
    handlers: {
      ...wrappedHandlers,
      ...wrappedSharedHandlers,
    },
    options: objectOptions,
  });
}
