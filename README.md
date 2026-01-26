# restate-saga

Saga pattern implementation for [Restate](https://restate.dev/) durable workflows with automatic compensation.

## Features

- **Automatic compensation** - When a step fails, all previous steps are automatically rolled back in reverse order
- **Flexible step types** - Choose between hybrid (`createSagaStep`) or strict (`createSagaStepStrict`) compensation modes
- **Global error registry** - Register error classes that should always trigger compensation
- **Composable workflows** - Embed workflows within workflows using `runAsStep`
- **Virtual Object support** - Saga pattern for stateful keyed entities
- **Type-safe** - Full TypeScript support with type inference

## Installation

```bash
npm install restate-saga
```

**Peer dependency:** Requires `@restatedev/restate-sdk` ^1.10.0

## Quick Start

```typescript
import {
  createSagaWorkflow,
  createSagaStep,
  StepResponse,
} from "restate-saga";

// Define a step with compensation
const reserveInventory = createSagaStep({
  name: "ReserveInventory",
  run: async ({ input }) => {
    const reservation = await inventoryService.reserve(input.productId, input.quantity);
    return new StepResponse(
      { reservationId: reservation.id },  // Output
      { reservationId: reservation.id }   // Compensation data
    );
  },
  compensate: async (data) => {
    await inventoryService.release(data.reservationId);
  },
});

// Define another step
const chargePayment = createSagaStep({
  name: "ChargePayment",
  run: async ({ input }) => {
    const payment = await paymentService.charge(input.amount);
    return new StepResponse(
      { paymentId: payment.id },
      { paymentId: payment.id, amount: input.amount }
    );
  },
  compensate: async (data) => {
    await paymentService.refund(data.paymentId, data.amount);
  },
});

// Create the workflow
export const checkoutWorkflow = createSagaWorkflow(
  "CheckoutWorkflow",
  async (saga, input: { productId: string; quantity: number; amount: number }) => {
    // If chargePayment fails, reserveInventory.compensate() runs automatically
    const inventory = await reserveInventory(saga, input);
    const payment = await chargePayment(saga, { amount: input.amount });

    return { reservationId: inventory.reservationId, paymentId: payment.paymentId };
  }
);
```

## Core Concepts

### Saga Pattern

The saga pattern manages distributed transactions where each step has a corresponding compensation (undo) action. If a later step fails, all earlier compensations run in reverse order.

```
Step 1 → Step 2 → Step 3 (fails!)
                    ↓
         Compensate 2 ← Compensate 1
```

### Step Types

#### `createSagaStep` (Hybrid)

Registers compensation **before** execution. Compensation runs even if the step fails partway through.

```typescript
const step = createSagaStep({
  name: "CreateOrder",
  run: async ({ input }) => {
    // Compensation is already registered at this point
    const order = await orderService.create(input);
    return new StepResponse(output, compensationData);
  },
  compensate: async (data, { failed }) => {
    // `failed` tells you if the step threw an error
    await orderService.cancel(data.orderId);
  },
});
```

#### `createSagaStepStrict` (Medusa-style)

Registers compensation **after** success. Use when compensation requires data that only exists after completion.

```typescript
const step = createSagaStepStrict({
  name: "CreateOrder",
  run: async ({ input }) => {
    const order = await orderService.create(input);
    return new StepResponse(
      { orderId: order.id },
      { orderId: order.id }  // Only available after success
    );
  },
  compensate: async (data) => {
    await orderService.cancel(data.orderId);
  },
});
```

### Steps Without Compensation

For validation, read-only operations, or idempotent actions, omit the `compensate` function:

```typescript
const validateInput = createSagaStep({
  name: "ValidateInput",
  run: async ({ input }) => {
    if (!input.email) {
      return StepResponse.permanentFailure("Email required", null);
    }
    return new StepResponse({ valid: true }, null);
  },
  // No compensate - validation has no side effects
});
```

### Global Error Registry

Register error classes that should always trigger compensation without retrying:

```typescript
import { registerTerminalErrors } from "restate-saga";

class ValidationError extends Error {}
class NotFoundError extends Error {}

registerTerminalErrors([ValidationError, NotFoundError]);

// Now any step that throws these will trigger compensation
const myStep = createSagaStep({
  name: "MyStep",
  run: async ({ input }) => {
    throw new ValidationError("Invalid input"); // → Triggers compensation
  },
});
```

### Composing Workflows

Use `runAsStep` to embed a workflow within another, sharing the compensation context:

```typescript
const paymentWorkflow = createSagaWorkflow("PaymentWorkflow", async (saga, input) => {
  const auth = await authorizePayment(saga, input);
  const capture = await capturePayment(saga, { authId: auth.id });
  return { paymentId: capture.id };
});

const orderWorkflow = createSagaWorkflow("OrderWorkflow", async (saga, input) => {
  const order = await createOrder(saga, input);

  // Payment workflow's compensations join this saga
  const payment = await paymentWorkflow.runAsStep(saga, { amount: order.total });

  // If shipping fails, both order AND payment are compensated
  const shipment = await createShipment(saga, { orderId: order.id });

  return { orderId: order.id, paymentId: payment.paymentId };
});
```

### Calling Restate Services

Saga workflows can call other Restate services, Virtual Objects, and workflows using the typed client helpers.

#### Calling a Restate Service

Use `serviceClient` to call regular Restate services from within a saga step:

```typescript
import { createSagaStep, StepResponse, serviceClient } from "restate-saga";
import { inventoryService } from "./services/inventory.js";

const checkAndReserve = createSagaStep({
  name: "CheckAndReserve",
  run: async ({ ctx, input }) => {
    // Call an external Restate service
    const inventory = serviceClient(ctx, inventoryService);
    const stock = await inventory.checkStock({ productId: input.productId });

    if (stock.available < input.quantity) {
      return StepResponse.permanentFailure("Insufficient stock", null);
    }

    const reservation = await inventory.reserve({
      productId: input.productId,
      quantity: input.quantity,
    });

    return new StepResponse(
      { reservationId: reservation.id },
      { reservationId: reservation.id }
    );
  },
  compensate: async (data) => {
    // Compensation logic...
  },
});
```

#### Calling a Virtual Object

Use `objectClient` to call keyed Virtual Objects:

```typescript
import { objectClient } from "restate-saga";
import { walletObject } from "./objects/wallet.js";

const debitWallet = createSagaStep({
  name: "DebitWallet",
  run: async ({ ctx, input }) => {
    // Call a Virtual Object by key
    const wallet = objectClient(ctx, walletObject, input.userId);
    const result = await wallet.debit({ amount: input.amount });

    return new StepResponse(
      { transactionId: result.transactionId },
      { userId: input.userId, amount: input.amount }
    );
  },
  compensate: async (data) => {
    // Refund on failure...
  },
});
```

#### Remote Workflow Calls vs runAsStep

There are two ways to call another saga workflow:

| Method | Compensation | Use When |
|--------|--------------|----------|
| `workflowClient` | Independent - child handles its own rollback | Workflows should succeed/fail independently |
| `runAsStep` | Shared - child's compensations join parent | All-or-nothing transaction across workflows |

**Remote call (independent compensation):**

```typescript
import { workflowClient } from "restate-saga";
import { notificationWorkflow } from "./workflows/notification.js";

const orderWorkflow = createSagaWorkflow("OrderWorkflow", async (saga, input) => {
  const order = await createOrder(saga, input);

  // Remote call - if notification fails, it handles its own compensation
  // Order workflow continues or fails independently
  const notifyClient = workflowClient(saga.ctx, notificationWorkflow);
  await notifyClient.run({ userId: input.userId, message: "Order created" });

  return { orderId: order.id };
});
```

**Embedded call (shared compensation):**

```typescript
import { paymentWorkflow } from "./workflows/payment.js";

const orderWorkflow = createSagaWorkflow("OrderWorkflow", async (saga, input) => {
  const order = await createOrder(saga, input);

  // Embedded - payment compensations join this saga's stack
  // If shipping fails later, payment is also rolled back
  const payment = await paymentWorkflow.runAsStep(saga, { amount: order.total });

  const shipment = await createShipment(saga, { orderId: order.id });

  return { orderId: order.id, paymentId: payment.paymentId };
});
```

#### Fire-and-Forget Calls

Use send clients for async calls that don't wait for completion:

```typescript
import { serviceSendClient, workflowSendClient, objectSendClient } from "restate-saga";

const completeOrder = createSagaStep({
  name: "CompleteOrder",
  run: async ({ ctx, input }) => {
    // Fire-and-forget: send email notification
    const emailService = serviceSendClient(ctx, emailService);
    await emailService.send({ to: input.email, template: "order-complete" });

    // Fire-and-forget: trigger analytics workflow
    const analytics = workflowSendClient(ctx, analyticsWorkflow);
    await analytics.run({ event: "order_completed", orderId: input.orderId });

    // Fire-and-forget: update user stats object
    const userStats = objectSendClient(ctx, userStatsObject, input.userId);
    await userStats.incrementOrderCount();

    return new StepResponse({ completed: true }, null);
  },
});
```

### Virtual Objects

Create stateful entities with saga support:

```typescript
import { createSagaVirtualObject } from "restate-saga";

const wallet = createSagaVirtualObject(
  "Wallet",
  {
    // Exclusive handlers with saga support
    transfer: async (saga, ctx, input) => {
      const debit = await debitAccount(saga, { amount: input.amount });
      const credit = await creditAccount(saga, { toAccount: input.to, amount: input.amount });
      return { success: true };
    },
  },
  {
    // Shared handlers (read-only, no saga)
    getBalance: async (ctx) => {
      return await ctx.get("balance") || 0;
    },
  }
);
```

## External Client Usage

Use `InferServiceType` to create a type-safe client with `@restatedev/restate-sdk-clients`.

See [01-basic-checkout.ts](./examples/01-basic-checkout.ts) for a complete example.

```typescript
// examples/01-basic-checkout.ts
import { createSagaWorkflow, InferServiceType } from "restate-saga";

export const checkoutWorkflow = createSagaWorkflow(
  "CheckoutWorkflow",
  async (saga, input: { productId: string; quantity: number; amount: number; ... }) => {
    const inventory = await reserveInventory(saga, { ... });
    const payment = await chargePayment(saga, { ... });
    const shipment = await createShipment(saga, { ... });
    return { reservationId, paymentId, trackingNumber };
  }
);

// Export the type for external clients
export type CheckoutWorkflow = InferServiceType<typeof checkoutWorkflow>;
```

```typescript
// client.ts
import * as clients from "@restatedev/restate-sdk-clients";
import type { CheckoutWorkflow } from "./examples/01-basic-checkout.js";

const restateClient = clients.connect({ url: "http://localhost:8080" });

// Type-safe client usage - name is constrained to "CheckoutWorkflow"
const result = await restateClient
  .serviceClient<CheckoutWorkflow>({ name: "CheckoutWorkflow" })
  .run({ productId: "89", quantity: 34, amount: 40 });

// TypeScript error if you use the wrong name:
// .serviceClient<CheckoutWorkflow>({ name: "WrongName" })
// Error: Type '"WrongName"' is not assignable to type '"CheckoutWorkflow"'
```

## API Reference

### Steps

- `createSagaStep(opts)` - Create a step with hybrid compensation
- `createSagaStepStrict(opts)` - Create a step with strict compensation
- `StepResponse` - Response class for step results
- `StepResponse.permanentFailure(message, data)` - Create a failure response

### Workflows

- `createSagaWorkflow(name, handler, options?)` - Create a saga workflow service
- `createSagaRestateWorkflow(name, run, handlers?, options?)` - Create a Restate Workflow with saga support

### Virtual Objects

- `createSagaVirtualObject(name, handlers, sharedHandlers?, options?)` - Create a Virtual Object with saga support

### Error Registry

- `registerTerminalErrors(errorClasses)` - Register error classes as terminal
- `unregisterTerminalErrors(errorClasses)` - Unregister error classes
- `clearTerminalErrors()` - Clear all registered errors
- `setGlobalErrorMapper(mapper)` - Set a custom error mapper

### Client Helpers

- `InferServiceType<T>` - Extract service type for use with external clients
- `serviceClient(ctx, definition)` - Create a typed client for Restate services
- `serviceSendClient(ctx, definition)` - Create a fire-and-forget client for Restate services
- `workflowClient(ctx, definition)` - Create a typed client for saga workflows
- `workflowSendClient(ctx, definition)` - Create a fire-and-forget client for saga workflows
- `objectClient(ctx, definition, key)` - Create a typed client for Virtual Objects
- `objectSendClient(ctx, definition, key)` - Create a fire-and-forget client for Virtual Objects

### Nested Sagas

- `runNestedSaga(saga, handler)` - Run inline saga logic with shared compensation
- `createSagaModule(handler)` - Create a reusable saga module

## Examples

See the [`examples/`](./examples) directory for complete working examples:

| Example | Description |
|---------|-------------|
| [01-basic-checkout.ts](./examples/01-basic-checkout.ts) | Simple e-commerce checkout with multi-step compensation and `InferServiceType` usage |
| [02-user-registration.ts](./examples/02-user-registration.ts) | Registration flow with validation and optional compensation |
| [03-composed-workflows.ts](./examples/03-composed-workflows.ts) | Workflow composition using `runAsStep` |
| [04-virtual-object.ts](./examples/04-virtual-object.ts) | Stateful wallet entity with saga support |
| [05-strict-compensation.ts](./examples/05-strict-compensation.ts) | Hybrid vs strict compensation modes |
| [06-error-handling.ts](./examples/06-error-handling.ts) | Error registry, mappers, and handling strategies |

To run an example:

```bash
# Start Restate server
restate-server

# Run the example
npx ts-node examples/01-basic-checkout.ts

# Register with Restate
restate deployments register http://localhost:9080

# Invoke the workflow
curl -X POST http://localhost:8080/CheckoutWorkflow/run \
  -H "Content-Type: application/json" \
  -d '{"productId": "SKU123", "quantity": 2, "amount": 99.99, "currency": "USD", "address": "123 Main St"}'
```

## License

MIT
