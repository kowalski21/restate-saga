# @kowalski21/restate-saga

Saga pattern implementation for [Restate](https://restate.dev/) durable workflows with automatic compensation.

## Features

- **Automatic compensation** - When a step fails, all previous steps are automatically rolled back in reverse order
- **Flexible step types** - Choose between hybrid (`createSagaStep`) or strict (`createSagaStepStrict`) compensation modes
- **Global error registry** - Register error classes that should always trigger compensation
- **Composable workflows** - Embed workflows within workflows using `runAsStep`
- **Virtual Object support** - Saga pattern for stateful keyed entities
- **Dependency Injection** - Container-aware workflows with Awilix for per-request contexts (Directus, etc.)
- **Type-safe** - Full TypeScript support with type inference helpers

## Installation

```bash
npm install @kowalski21/restate-saga
```

**Peer dependency:** Requires `@restatedev/restate-sdk` ^1.10.0

## Quick Start

```typescript
import {
  createSagaWorkflow,
  createSagaStep,
  StepResponse,
} from "@kowalski21/restate-saga";

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
import { registerTerminalErrors } from "@kowalski21/restate-saga";

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
import { createSagaStep, StepResponse, serviceClient } from "@kowalski21/restate-saga";
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
import { objectClient } from "@kowalski21/restate-saga";
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
import { workflowClient } from "@kowalski21/restate-saga";
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
import { serviceSendClient, workflowSendClient, objectSendClient } from "@kowalski21/restate-saga";

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
import { createSagaVirtualObject } from "@kowalski21/restate-saga";

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
import { createSagaWorkflow, InferServiceType } from "@kowalski21/restate-saga";

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

## Container-Aware Workflows (Dependency Injection)

For applications like Directus where services need per-request context (accountability, schema), use the container-aware workflow pattern with Awilix.

### Basic Container Workflow

```typescript
import { createContainer, asValue } from "awilix";
import {
  createContainerWorkflow,
  createContainerStep,
  StepResponse,
} from "@kowalski21/restate-saga";

// 1. Define your services type
interface AppServices {
  ordersService: ItemsService;
  inventoryService: ItemsService;
  database: Knex;
}

// 2. Create container-aware steps
const createOrder = createContainerStep<AppServices>()({
  name: "CreateOrder",
  run: async (saga, input: { userId: string; items: any[] }) => {
    // saga.services is typed and available
    const orderId = await saga.services.ordersService.createOne({
      user: input.userId,
      items: input.items,
    });
    return new StepResponse({ orderId }, { orderId });
  },
  compensate: async (saga, data) => {
    // saga.services available in compensation too
    if ("orderId" in data) {
      await saga.services.ordersService.deleteOne(data.orderId);
    }
  },
});

// 3. Create and configure container
const container = createContainer<AppServices>();
container.register({
  ordersService: asValue(new ItemsService("orders", context)),
  inventoryService: asValue(new ItemsService("inventory", context)),
  database: asValue(knex),
});

// 4. Create workflow with container
const orderWorkflow = createContainerWorkflow(
  container,
  "OrderWorkflow",
  async (saga, input: { userId: string; items: any[] }) => {
    const order = await createOrder(saga, input);
    return { orderId: order.orderId };
  }
);

// 5. Register with Restate
restate.endpoint().bind(orderWorkflow).listen();
```

### Factory Pattern (Per-Request Containers)

For Directus where each request has different accountability/schema, use the factory pattern:

```typescript
import {
  defineContainerWorkflow,
  defineContainerRestateWorkflow,
  createContainerStep,
  StepResponse,
} from "@kowalski21/restate-saga";

// Define your services type
interface DirectusServices {
  ordersService: ItemsService;
  customersService: ItemsService;
  paymentsService: ItemsService;
}

// Define steps (reusable across all requests)
const createOrder = createContainerStep<DirectusServices>()({
  name: "CreateOrder",
  run: async (saga, input: { customerId: string; items: any[] }) => {
    const order = await saga.services.ordersService.createOne({
      customer: input.customerId,
      items: input.items,
      status: "pending",
    });
    return new StepResponse({ orderId: order.id }, { orderId: order.id });
  },
  compensate: async (saga, data) => {
    if ("orderId" in data) {
      await saga.services.ordersService.deleteOne(data.orderId);
    }
  },
});

const processPayment = createContainerStep<DirectusServices>()({
  name: "ProcessPayment",
  run: async (saga, input: { orderId: string; amount: number }) => {
    const payment = await saga.services.paymentsService.createOne({
      order: input.orderId,
      amount: input.amount,
      status: "completed",
    });
    return new StepResponse({ paymentId: payment.id }, { paymentId: payment.id });
  },
  compensate: async (saga, data) => {
    if ("paymentId" in data) {
      await saga.services.paymentsService.updateOne(data.paymentId, {
        status: "refunded",
      });
    }
  },
});

// Define workflow factory (no container bound yet)
const createOrderWorkflow = defineContainerWorkflow<DirectusServices>()(
  "OrderWorkflow",
  async (saga, input: { customerId: string; items: any[]; amount: number }) => {
    const order = await createOrder(saga, {
      customerId: input.customerId,
      items: input.items,
    });

    const payment = await processPayment(saga, {
      orderId: order.orderId,
      amount: input.amount,
    });

    return { orderId: order.orderId, paymentId: payment.paymentId };
  }
);

// In Directus endpoint - create with request-specific container
export default defineEndpoint((router, context) => {
  router.post("/orders", async (req, res) => {
    const { accountability, schema } = req;

    // Create container with request-specific services
    const container = createContainer<DirectusServices>();
    container.register({
      ordersService: asValue(new ItemsService("orders", { schema, accountability, knex: context.database })),
      customersService: asValue(new ItemsService("customers", { schema, accountability, knex: context.database })),
      paymentsService: asValue(new ItemsService("payments", { schema, accountability, knex: context.database })),
    });

    // Create workflow instance with this container
    const workflow = createOrderWorkflow(container);

    // Register with Restate
    restate.endpoint().bind(workflow).listen(9080);

    // Or invoke via Restate client
    const client = restate.connect({ url: "http://localhost:8080" });
    const result = await client.serviceClient(workflow).run(req.body);

    res.json(result);
  });
});
```

### Nested Container Workflows

When using `runAsStep`, nested workflows inherit the parent's saga context (including services):

```typescript
// Define payment workflow factory
const createPaymentWorkflow = defineContainerWorkflow<DirectusServices>()(
  "PaymentWorkflow",
  async (saga, input: { orderId: string; amount: number }) => {
    const payment = await processPayment(saga, input);
    return { paymentId: payment.paymentId };
  }
);

// Define order workflow that nests payment
const createOrderWorkflow = defineContainerWorkflow<DirectusServices>()(
  "OrderWorkflow",
  async (saga, input) => {
    const order = await createOrder(saga, input);

    // Get payment workflow instance (must be created with same container)
    // Note: paymentWorkflow must be in scope - see setup below
    const payment = await paymentWorkflow.runAsStep(saga, {
      orderId: order.orderId,
      amount: input.amount,
    });

    return { orderId: order.orderId, paymentId: payment.paymentId };
  }
);

// Setup: create both workflows with same container
router.post("/orders", async (req, res) => {
  const container = createRequestContainer(req);

  // Create both with same container
  const paymentWorkflow = createPaymentWorkflow(container);
  const orderWorkflow = createOrderWorkflow(container);

  // Register both
  restate.endpoint()
    .bind(orderWorkflow)
    .bind(paymentWorkflow)
    .listen(9080);
});
```

**Important:** When using `runAsStep`, the nested workflow uses the parent's saga context. The container used to create the nested workflow only matters when invoked directly via Restate.

### Type Inference Helpers

Extract types from container workflows for use with clients:

```typescript
import {
  InferContainerServiceType,
  InferContainerCradle,
  InferContainerInput,
  InferContainerOutput,
  InferContainerWorkflow,
} from "@kowalski21/restate-saga";

const orderWorkflow = createContainerWorkflow(container, "OrderWorkflow", handler);

// Individual type extraction
type OrderService = InferContainerServiceType<typeof orderWorkflow>;
type OrderCradle = InferContainerCradle<typeof orderWorkflow>;
type OrderInput = InferContainerInput<typeof orderWorkflow>;
type OrderOutput = InferContainerOutput<typeof orderWorkflow>;

// Or get all at once
type Order = InferContainerWorkflow<typeof orderWorkflow>;
// Order.Name       = "OrderWorkflow"
// Order.Input      = { customerId: string; items: any[]; amount: number }
// Order.Output     = { orderId: string; paymentId: string }
// Order.Cradle     = DirectusServices
// Order.ServiceType = restate.ServiceDefinition<"OrderWorkflow", ...>

// Use with Restate client
const result = await client
  .serviceClient<OrderService>({ name: "OrderWorkflow" })
  .run(input);
```

### Restate Workflows (Long-Running)

For long-running workflows with signals and queries:

```typescript
const createLongRunningWorkflow = defineContainerRestateWorkflow<DirectusServices>()(
  "ApprovalWorkflow",
  async (saga, ctx, input: { orderId: string }) => {
    const order = await createOrder(saga, input);

    // Wait for approval signal (durable promise)
    const approved = await ctx.promise<boolean>("approval");

    if (!approved) {
      throw new restate.TerminalError("Order rejected");
    }

    const shipment = await createShipment(saga, { orderId: order.orderId });
    return { orderId: order.orderId, shipmentId: shipment.id };
  },
  {
    // Additional handlers (signals/queries)
    approve: async (ctx, input: { approved: boolean }) => {
      ctx.resolvePromise("approval", input.approved);
    },
    getStatus: async (ctx) => {
      return ctx.promise<string>("status");
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

- `InferServiceType<T>` - Extract service type for use with external clients
- `serviceClient(ctx, definition)` - Create a typed client for Restate services
- `serviceSendClient(ctx, definition)` - Create a fire-and-forget client for Restate services
- `workflowClient(ctx, definition)` - Create a typed client for saga workflows
- `workflowSendClient(ctx, definition)` - Create a fire-and-forget client for saga workflows
- `objectClient(ctx, definition, key)` - Create a typed client for Virtual Objects
- `objectSendClient(ctx, definition, key)` - Create a fire-and-forget client for Virtual Objects

### Container / Dependency Injection (Awilix)

- `createContainerStep<TCradle>()` - Create a step with DI support
- `createContainerStepStrict<TCradle>()` - Create a strict step with DI support
- `createContainerWorkflow(container, name, handler, options?)` - Create a workflow with container
- `createContainerRestateWorkflow(container, name, run, handlers?, options?)` - Create a Restate Workflow with container
- `defineContainerWorkflow<TCradle>()` - Factory pattern for per-request containers
- `defineContainerRestateWorkflow<TCradle>()` - Factory pattern for per-request Restate Workflows

### Container Type Helpers

- `InferContainerServiceType<T>` - Extract Restate service type for clients
- `InferContainerCradle<T>` - Extract the services (TCradle) type
- `InferContainerInput<T>` - Extract workflow input type
- `InferContainerOutput<T>` - Extract workflow output type
- `InferContainerName<T>` - Extract workflow name literal
- `InferContainerWorkflow<T>` - Extract all types as an object

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
| [07-container-workflow.ts](./examples/07-container-workflow.ts) | Container-aware workflows with Awilix DI |
| [08-directus-factory.ts](./examples/08-directus-factory.ts) | Factory pattern for Directus per-request containers |

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
