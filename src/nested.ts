import type { SagaContext } from "./types.js";

/**
 * Run a nested saga that shares the parent's compensation context.
 *
 * When you call another workflow's logic inline (not via service call),
 * use this to ensure the nested workflow's compensations are registered
 * in the parent's compensation stack. If the parent saga fails after the
 * nested saga completes, all compensations run together in reverse order.
 *
 * Use this when:
 * - You want to compose workflow logic without separate service calls
 * - You need compensations from nested logic to run if parent fails
 * - You're building reusable saga "modules" that can be embedded
 *
 * @param saga - The parent saga context
 * @param handler - The nested saga handler function
 * @returns The result of the nested handler
 *
 * @example
 * ```typescript
 * // Define a reusable saga module
 * async function processPaymentSaga(saga: SagaContext, input: PaymentInput) {
 *   const auth = await authorizePayment(saga, input);
 *   const capture = await capturePayment(saga, { paymentId: auth.paymentId });
 *   return capture;
 * }
 *
 * // Use it in a parent workflow
 * export const orderWorkflow = createSagaWorkflow(
 *   "OrderWorkflow",
 *   async (saga, input) => {
 *     const order = await createOrder(saga, input);
 *
 *     // Nested saga - compensations are shared with parent
 *     const payment = await runNestedSaga(saga, (nestedSaga) =>
 *       processPaymentSaga(nestedSaga, { amount: input.total })
 *     );
 *
 *     // If this step fails, both order AND payment compensations run
 *     const shipping = await shipOrder(saga, { orderId: order.id });
 *
 *     return { orderId: order.id, paymentId: payment.id };
 *   }
 * );
 * ```
 */
export async function runNestedSaga<T>(
  saga: SagaContext,
  handler: (saga: SagaContext) => Promise<T>
): Promise<T> {
  // Simply pass the parent's saga context to the handler.
  // All steps executed by the handler will register their
  // compensations in the parent's compensation stack.
  return handler(saga);
}

/**
 * Create a reusable saga module that can be embedded in other workflows.
 *
 * This is a convenience wrapper for defining saga logic that will be
 * used with `runNestedSaga` or called directly. It provides better type
 * inference and makes the intent clearer.
 *
 * The difference from `createSagaWorkflow`:
 * - `createSagaModule` is just a function, not a Restate service
 * - Cannot be called via HTTP - only embedded in other workflows
 * - Always shares compensation context with parent
 *
 * @param handler - The saga module handler
 * @returns A function that can be called with a saga context
 *
 * @example
 * ```typescript
 * // Define a payment saga module
 * const paymentModule = createSagaModule(
 *   async (saga, input: { amount: number; customerId: string }) => {
 *     const auth = await authorizePayment(saga, { amount: input.amount });
 *     const capture = await capturePayment(saga, { paymentId: auth.paymentId });
 *     return { paymentId: capture.paymentId };
 *   }
 * );
 *
 * // Use in a workflow - compensations join parent's saga
 * export const checkoutWorkflow = createSagaWorkflow(
 *   "CheckoutWorkflow",
 *   async (saga, input) => {
 *     const order = await createOrder(saga, input);
 *
 *     // Execute the payment module with shared compensation context
 *     const payment = await paymentModule(saga, {
 *       amount: input.total,
 *       customerId: input.customerId,
 *     });
 *
 *     return { orderId: order.id, paymentId: payment.paymentId };
 *   }
 * );
 * ```
 */
export function createSagaModule<Input, Output>(
  handler: (saga: SagaContext, input: Input) => Promise<Output>
): (saga: SagaContext, input: Input) => Promise<Output> {
  return handler;
}
