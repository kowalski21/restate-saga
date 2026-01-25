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

- `workflowClient(ctx, definition)` - Create a typed workflow client
- `workflowSendClient(ctx, definition)` - Create a fire-and-forget workflow client
- `objectClient(ctx, definition, key)` - Create a typed object client

### Nested Sagas

- `runNestedSaga(saga, handler)` - Run inline saga logic with shared compensation
- `createSagaModule(handler)` - Create a reusable saga module

## License

MIT
