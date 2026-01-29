# @kowalski21/restate-saga - AI Agent Skills Guide

> Reference guide for AI coding agents to correctly implement the saga pattern with Restate durable workflows.

## Overview

This library implements the **Saga pattern** for distributed transactions using Restate's durable execution. Key concepts:

- **Saga**: A sequence of steps where each step can have a compensation (rollback) action
- **Compensation**: Undo logic that runs in reverse order when a step fails with `TerminalError`
- **Step**: A single operation with optional compensation
- **TerminalError**: A non-retryable error that triggers the compensation chain

---

## Quick Decision Tree

### Which Workflow Creator?

```
Do you need dependency injection (Awilix container)?
├─ NO → Use `createSagaWorkflow`
└─ YES → Do you need per-request containers (e.g., Directus)?
         ├─ NO → Use `createContainerWorkflow`
         └─ YES → Use `defineContainerWorkflow` (factory pattern)
```

### Which Step Creator?

```
When should compensation run?
├─ Even if step partially fails → Use `createSagaStep` (hybrid)
└─ Only if step fully succeeds → Use `createSagaStepStrict` (strict)
```

### Which Type Inference Helper?

| Created With | Use This Type Helper |
|--------------|---------------------|
| `createSagaWorkflow` | `InferServiceType<typeof workflow>` |
| `createContainerWorkflow` | `InferContainerServiceType<typeof workflow>` |
| `defineContainerWorkflow` | `InferFactoryServiceType<typeof factory>` |

---

## Pattern 1: Simple Saga Workflow (No DI)

Use when you don't need dependency injection.

### Step Definition

```typescript
import { createSagaStep, StepResponse } from "@kowalski21/restate-saga";

// Step WITH compensation
const createOrder = createSagaStep({
  name: "CreateOrder",
  run: async ({ ctx, input }: { ctx: any; input: { userId: string; items: any[] } }) => {
    const orderId = `order_${Date.now()}`;
    // ... create order in database
    return new StepResponse(
      { orderId },           // Output - returned to caller
      { orderId }            // Compensation data - passed to compensate()
    );
  },
  compensate: async (data, { failed }) => {
    // data is CompensationData if step succeeded, or Input if step threw
    if ("orderId" in data) {
      // ... delete order from database
    }
  },
});

// Step WITHOUT compensation (validation, read-only)
const validateInput = createSagaStep({
  name: "ValidateInput",
  run: async ({ input }: { input: { email: string } }) => {
    if (!input.email) {
      return StepResponse.permanentFailure("Email required", null);
    }
    return new StepResponse({ valid: true }, null);
  },
  // No compensate - nothing to undo
});
```

### Workflow Definition

```typescript
import { createSagaWorkflow, InferServiceType } from "@kowalski21/restate-saga";

export const checkoutWorkflow = createSagaWorkflow(
  "CheckoutWorkflow",
  async (saga, input: { userId: string; items: any[] }) => {
    // Steps execute in order
    await validateInput(saga, { email: input.userId });
    const order = await createOrder(saga, input);
    const payment = await processPayment(saga, { orderId: order.orderId });

    // If processPayment throws TerminalError:
    // 1. createOrder.compensate() runs
    // 2. validateInput has no compensate, skipped

    return { orderId: order.orderId, paymentId: payment.paymentId };
  }
);

// Export type for client usage
export type CheckoutWorkflow = InferServiceType<typeof checkoutWorkflow>;
```

### Client Usage

```typescript
import * as clients from "@restatedev/restate-sdk-clients";
import type { CheckoutWorkflow } from "./workflows/checkout";

const restateClient = clients.connect({ url: "http://localhost:8080" });

const result = await restateClient
  .serviceClient<CheckoutWorkflow>({ name: "CheckoutWorkflow" })
  .run({ userId: "user_123", items: [{ id: "item_1", qty: 2 }] });
```

---

## Pattern 2: Container Workflow (Direct DI)

Use when you have a single container instance (not per-request).

### Container Setup

```typescript
import { createContainer, asValue, asClass } from "awilix";

interface AppServices {
  database: Database;
  ordersService: OrdersService;
  paymentsService: PaymentsService;
}

const container = createContainer<AppServices>();
container.register({
  database: asValue(new Database()),
  ordersService: asClass(OrdersService).singleton(),
  paymentsService: asClass(PaymentsService).singleton(),
});
```

### Step Definition

```typescript
import { createContainerStep, StepResponse } from "@kowalski21/restate-saga";

const createOrder = createContainerStep<AppServices>()({
  name: "CreateOrder",
  run: async (saga, input: { userId: string; items: any[] }) => {
    // Access services via saga.services
    const orderId = await saga.services.ordersService.create({
      user: input.userId,
      items: input.items,
    });
    return new StepResponse({ orderId }, { orderId });
  },
  compensate: async (saga, data) => {
    // saga.services available in compensate too
    if ("orderId" in data) {
      await saga.services.ordersService.delete(data.orderId);
    }
  },
});
```

### Workflow Definition

```typescript
import { createContainerWorkflow, InferContainerServiceType } from "@kowalski21/restate-saga";

export const orderWorkflow = createContainerWorkflow(
  container,              // Pass container directly
  "OrderWorkflow",
  async (saga, input: { userId: string; items: any[] }) => {
    // saga.services is available
    const order = await createOrder(saga, input);
    return { orderId: order.orderId };
  }
);

// Export type for client usage
export type OrderWorkflow = InferContainerServiceType<typeof orderWorkflow>;
```

---

## Pattern 3: Factory Workflow (Per-Request DI)

Use when you need different container instances per request (e.g., Directus with per-request accountability).

### Step Definition (Same as Pattern 2)

```typescript
import { createContainerStep, StepResponse } from "@kowalski21/restate-saga";

const createOrder = createContainerStep<AppServices>()({
  name: "CreateOrder",
  run: async (saga, input) => {
    const orderId = await saga.services.ordersService.create(input);
    return new StepResponse({ orderId }, { orderId });
  },
  compensate: async (saga, data) => {
    if ("orderId" in data) {
      await saga.services.ordersService.delete(data.orderId);
    }
  },
});
```

### Workflow Factory Definition

```typescript
import { defineContainerWorkflow, InferFactoryServiceType } from "@kowalski21/restate-saga";

// Define workflow as a factory (no container yet)
export const createOrderWorkflow = defineContainerWorkflow<AppServices>()(
  "OrderWorkflow",
  async (saga, input: { userId: string; items: any[] }) => {
    const order = await createOrder(saga, input);
    return { orderId: order.orderId };
  }
);

// Export type for client usage - USE InferFactoryServiceType!
export type OrderWorkflow = InferFactoryServiceType<typeof createOrderWorkflow>;
```

### Instantiation (e.g., in Directus endpoint)

```typescript
import { createOrderWorkflow } from "./workflows/order";
import * as restate from "@restatedev/restate-sdk";

// In your endpoint handler
router.post("/restate", (req, res) => {
  // Create per-request container
  const container = createRequestContainer(req);

  // Instantiate workflow with this request's container
  const orderWorkflow = createOrderWorkflow(container);

  // Bind to Restate
  const handler = restate.endpoint().bind(orderWorkflow).handler();
  handler(req, res);
});
```

---

## Pattern 4: Hybrid vs Strict Steps

### Hybrid Step (`createSagaStep`)

Compensation is registered **BEFORE** execution. Runs even if step throws.

```typescript
const reserveInventory = createSagaStep({
  name: "ReserveInventory",
  run: async ({ input }) => {
    const reservation = await inventory.reserve(input.productId, input.qty);
    // If this line throws AFTER reserve(), compensation still runs
    await someOtherOperation();
    return new StepResponse({ reservationId: reservation.id }, { reservationId: reservation.id });
  },
  compensate: async (data) => {
    // Runs even if run() threw after reserve()
    if ("reservationId" in data) {
      await inventory.release(data.reservationId);
    } else {
      // data is the original input (step threw before returning)
      await inventory.releaseByProduct(data.productId);
    }
  },
});
```

### Strict Step (`createSagaStepStrict`)

Compensation is registered **AFTER** success. Only runs if step completed.

```typescript
const createOrder = createSagaStepStrict({
  name: "CreateOrder",
  run: async ({ input }) => {
    const order = await orderService.create(input);
    return new StepResponse({ orderId: order.id }, { orderId: order.id });
  },
  compensate: async (data) => {
    // Only runs if run() completed successfully
    // data is always CompensationData (never Input)
    await orderService.delete(data.orderId);
  },
});
```

### When to Use Which

| Scenario | Use |
|----------|-----|
| Step might partially complete (e.g., API call succeeded, local processing failed) | Hybrid |
| Step is atomic (all-or-nothing) | Strict |
| Compensation needs data only available after success | Strict |
| Need to undo even on partial failure | Hybrid |

---

## Pattern 5: Permanent Failure with Compensation Data

Use `StepResponse.permanentFailure()` when a step fails but needs to provide compensation data.

```typescript
const processPayment = createSagaStep({
  name: "ProcessPayment",
  run: async ({ input }) => {
    // Step 1: Authorize
    const auth = await paymentGateway.authorize(input.amount);

    // Step 2: Capture (might fail)
    const capture = await paymentGateway.capture(auth.id);
    if (!capture.success) {
      // Fail but provide auth ID so compensation can void it
      return StepResponse.permanentFailure(
        "Payment capture failed",
        { authorizationId: auth.id }  // Passed to compensate()
      );
    }

    return new StepResponse(
      { paymentId: capture.id },
      { paymentId: capture.id }
    );
  },
  compensate: async (data) => {
    if ("authorizationId" in data) {
      // Void the authorization
      await paymentGateway.voidAuth(data.authorizationId);
    } else if ("paymentId" in data) {
      // Refund the payment
      await paymentGateway.refund(data.paymentId);
    }
  },
});
```

---

## Pattern 6: Error Handling

### Register Terminal Errors Globally

```typescript
import { registerTerminalErrors } from "@kowalski21/restate-saga";

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

// Register at app startup
registerTerminalErrors([ValidationError, NotFoundError]);

// Now any step that throws these triggers compensation (no retry)
```

### Global Error Mapper

```typescript
import { setGlobalErrorMapper } from "@kowalski21/restate-saga";
import * as restate from "@restatedev/restate-sdk";

setGlobalErrorMapper((err) => {
  // Map HTTP 4xx to terminal
  if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
    return new restate.TerminalError(err.message);
  }
  return undefined; // Retry other errors
});
```

### Step-Level Error Mapper

```typescript
const myStep = createSagaStep({
  name: "MyStep",
  options: {
    asTerminalError: (err) => {
      if (err instanceof CustomError) {
        return new restate.TerminalError(err.message);
      }
      return undefined;
    },
  },
  run: async ({ input }) => { /* ... */ },
});
```

---

## Pattern 7: Workflow Composition

### Using `runAsStep` (Embedded Workflow)

Child workflow's compensations join parent's stack.

```typescript
import { createSagaWorkflow } from "@kowalski21/restate-saga";

const paymentWorkflow = createSagaWorkflow(
  "PaymentWorkflow",
  async (saga, input: { amount: number }) => {
    const auth = await authorizePayment(saga, input);
    const capture = await capturePayment(saga, { authId: auth.id });
    return { paymentId: capture.id };
  }
);

const orderWorkflow = createSagaWorkflow(
  "OrderWorkflow",
  async (saga, input) => {
    const order = await createOrder(saga, input);

    // Embed payment workflow - compensations join parent
    const payment = await paymentWorkflow.runAsStep(saga, { amount: input.total });

    // If shipping fails, BOTH order AND payment compensations run
    const shipping = await shipOrder(saga, { orderId: order.id });

    return { orderId: order.id, paymentId: payment.paymentId };
  }
);
```

### Using `createSagaModule` (Reusable Logic)

For logic shared across workflows without creating a separate service.

```typescript
import { createSagaModule } from "@kowalski21/restate-saga";

const paymentModule = createSagaModule(
  async (saga, input: { amount: number; customerId: string }) => {
    const auth = await authorizePayment(saga, input);
    const capture = await capturePayment(saga, { authId: auth.id });
    return { paymentId: capture.id };
  }
);

// Use in any workflow
const checkoutWorkflow = createSagaWorkflow(
  "CheckoutWorkflow",
  async (saga, input) => {
    const order = await createOrder(saga, input);
    const payment = await paymentModule(saga, { amount: input.total, customerId: input.userId });
    return { orderId: order.id, paymentId: payment.paymentId };
  }
);
```

---

## Pattern 8: Retry Policies

### Step-Level Retry

```typescript
const myStep = createSagaStep({
  name: "MyStep",
  options: {
    retry: {
      maxRetryAttempts: 3,
      initialRetryInterval: { seconds: 1 },
      retryIntervalFactor: 2,        // Exponential backoff
      maxRetryInterval: { seconds: 30 },
    },
    compensationRetry: {
      maxRetryAttempts: 5,           // More retries for compensation
    },
  },
  run: async ({ input }) => { /* ... */ },
  compensate: async (data) => { /* ... */ },
});
```

### Workflow-Level Retry

```typescript
const myWorkflow = createSagaWorkflow(
  "MyWorkflow",
  handler,
  {
    retryPolicy: {
      maxAttempts: 10,
      initialInterval: { seconds: 1 },
      exponentiationFactor: 2,
      maxInterval: { minutes: 5 },
    },
    inactivityTimeout: { minutes: 30 },
  }
);
```

---

## Common Mistakes

### Mistake 1: Wrong Type Inference Helper

```typescript
// WRONG - Using InferContainerWorkflow with factory
const factory = defineContainerWorkflow<Services>()("Name", handler);
type Wrong = InferContainerWorkflow<typeof factory>; // All fields are `never`

// CORRECT - Use InferFactoryServiceType
type Correct = InferFactoryServiceType<typeof factory>;
```

### Mistake 2: Using Container Step in Simple Workflow

```typescript
// WRONG - Container step requires ContainerSagaContext
const containerStep = createContainerStep<Services>()({ ... });
const simpleWorkflow = createSagaWorkflow("Name", async (saga, input) => {
  await containerStep(saga, input); // TypeScript error: missing services
});

// CORRECT - Use simple step OR container workflow
const simpleStep = createSagaStep({ ... });
const simpleWorkflow = createSagaWorkflow("Name", async (saga, input) => {
  await simpleStep(saga, input); // Works
});
```

### Mistake 3: Forgetting to Export Type

```typescript
// WRONG - No type export, clients can't use typed calls
export const orderWorkflow = createSagaWorkflow("OrderWorkflow", handler);

// CORRECT - Export both workflow and type
export const orderWorkflow = createSagaWorkflow("OrderWorkflow", handler);
export type OrderWorkflow = InferServiceType<typeof orderWorkflow>;
```

### Mistake 4: Not Handling Partial Failure

```typescript
// WRONG - If API call succeeds but local processing fails, no compensation data
const badStep = createSagaStep({
  name: "Bad",
  run: async ({ input }) => {
    const result = await externalApi.create(input); // Succeeds
    processLocally(result); // Throws!
    return new StepResponse(result, result);
  },
  compensate: async (data) => {
    // data is Input (not result), can't undo API call properly
  },
});

// CORRECT - Return early or use strict step
const goodStep = createSagaStepStrict({
  name: "Good",
  run: async ({ input }) => {
    const result = await externalApi.create(input);
    processLocally(result);
    return new StepResponse(result, { id: result.id });
  },
  compensate: async (data) => {
    await externalApi.delete(data.id); // Always has the ID
  },
});
```

---

## Complete Example: E-Commerce Checkout

```typescript
// types.ts
interface CheckoutInput {
  userId: string;
  items: Array<{ productId: string; quantity: number }>;
  paymentMethod: string;
}

interface CheckoutOutput {
  orderId: string;
  paymentId: string;
  shipmentId: string;
}

// steps/validate-cart.ts
import { createSagaStep, StepResponse } from "@kowalski21/restate-saga";

export const validateCart = createSagaStep({
  name: "ValidateCart",
  run: async ({ input }: { input: CheckoutInput }) => {
    if (input.items.length === 0) {
      return StepResponse.permanentFailure("Cart is empty", null);
    }
    return new StepResponse({ valid: true }, null);
  },
});

// steps/reserve-inventory.ts
export const reserveInventory = createSagaStep({
  name: "ReserveInventory",
  run: async ({ input }: { input: { items: Array<{ productId: string; quantity: number }> } }) => {
    const reservationId = await inventoryService.reserve(input.items);
    return new StepResponse({ reservationId }, { reservationId });
  },
  compensate: async (data) => {
    if ("reservationId" in data) {
      await inventoryService.release(data.reservationId);
    }
  },
});

// steps/create-order.ts
export const createOrder = createSagaStepStrict({
  name: "CreateOrder",
  run: async ({ input }: { input: { userId: string; items: any[] } }) => {
    const order = await orderService.create(input);
    return new StepResponse({ orderId: order.id }, { orderId: order.id });
  },
  compensate: async (data) => {
    await orderService.cancel(data.orderId);
  },
});

// steps/process-payment.ts
export const processPayment = createSagaStep({
  name: "ProcessPayment",
  options: {
    retry: { maxRetryAttempts: 3, initialRetryInterval: { seconds: 2 } },
  },
  run: async ({ input }: { input: { orderId: string; amount: number; method: string } }) => {
    const payment = await paymentService.charge(input);
    return new StepResponse({ paymentId: payment.id }, { paymentId: payment.id });
  },
  compensate: async (data) => {
    if ("paymentId" in data) {
      await paymentService.refund(data.paymentId);
    }
  },
});

// steps/create-shipment.ts
export const createShipment = createSagaStepStrict({
  name: "CreateShipment",
  run: async ({ input }: { input: { orderId: string } }) => {
    const shipment = await shippingService.create(input.orderId);
    return new StepResponse({ shipmentId: shipment.id }, { shipmentId: shipment.id });
  },
  compensate: async (data) => {
    await shippingService.cancel(data.shipmentId);
  },
});

// workflows/checkout.ts
import { createSagaWorkflow, InferServiceType } from "@kowalski21/restate-saga";

export const checkoutWorkflow = createSagaWorkflow(
  "CheckoutWorkflow",
  async (saga, input: CheckoutInput): Promise<CheckoutOutput> => {
    // 1. Validate (no compensation needed)
    await validateCart(saga, input);

    // 2. Reserve inventory (compensation: release)
    const inventory = await reserveInventory(saga, { items: input.items });

    // 3. Create order (compensation: cancel)
    const order = await createOrder(saga, { userId: input.userId, items: input.items });

    // 4. Process payment (compensation: refund)
    const payment = await processPayment(saga, {
      orderId: order.orderId,
      amount: calculateTotal(input.items),
      method: input.paymentMethod,
    });

    // 5. Create shipment (compensation: cancel)
    const shipment = await createShipment(saga, { orderId: order.orderId });

    return {
      orderId: order.orderId,
      paymentId: payment.paymentId,
      shipmentId: shipment.shipmentId,
    };
  },
  {
    retryPolicy: { maxAttempts: 5 },
    inactivityTimeout: { minutes: 15 },
  }
);

export type CheckoutWorkflow = InferServiceType<typeof checkoutWorkflow>;

// main.ts - Restate server setup
import * as restate from "@restatedev/restate-sdk";
import { checkoutWorkflow } from "./workflows/checkout";

restate.endpoint().bind(checkoutWorkflow).listen(9080);
```

---

## Type Reference

| Type | Purpose |
|------|---------|
| `SagaContext` | Context for simple workflows |
| `ContainerSagaContext<TCradle>` | Context with DI services |
| `StepResponse<Output, CompensationData>` | Step return value |
| `InferServiceType<T>` | Extract service type from simple workflow |
| `InferContainerServiceType<T>` | Extract service type from container workflow |
| `InferFactoryServiceType<T>` | Extract service type from factory workflow |
| `InferFactoryInput<T>` | Extract input type from factory |
| `InferFactoryOutput<T>` | Extract output type from factory |
| `InferFactory<T>` | Extract all types from factory |
