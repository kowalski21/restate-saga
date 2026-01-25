/**
 * User Registration Workflow
 *
 * Demonstrates:
 * - Steps without compensation (validation)
 * - Optional compensation
 * - Global error registry for custom errors
 */

import * as restate from "@restatedev/restate-sdk";
import {
  createSagaWorkflow,
  createSagaStep,
  StepResponse,
  registerTerminalErrors,
} from "restate-saga";

// Custom error classes
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`Email ${email} is already registered`);
    this.name = "DuplicateEmailError";
  }
}

// Register errors that should trigger compensation without retry
registerTerminalErrors([ValidationError, DuplicateEmailError]);

// Step 1: Validate input (no compensation needed)
const validateInput = createSagaStep<
  { email: string; password: string },
  { valid: boolean },
  null
>({
  name: "ValidateInput",
  run: async ({ input }) => {
    if (!input.email.includes("@")) {
      throw new ValidationError("Invalid email format");
    }
    if (input.password.length < 8) {
      throw new ValidationError("Password must be at least 8 characters");
    }
    return new StepResponse({ valid: true }, null);
  },
  // No compensate - validation has no side effects
});

// Step 2: Create user account
const createUser = createSagaStep<
  { email: string; password: string },
  { userId: string },
  { userId: string }
>({
  name: "CreateUser",
  run: async ({ input }) => {
    // Check for duplicates
    if (input.email === "taken@example.com") {
      throw new DuplicateEmailError(input.email);
    }
    const userId = `user_${Date.now()}`;
    console.log(`Created user ${userId} with email ${input.email}`);
    return new StepResponse({ userId }, { userId });
  },
  compensate: async (data) => {
    console.log(`Deleted user ${data.userId}`);
  },
});

// Step 3: Send welcome email (optional compensation)
const sendWelcomeEmail = createSagaStep<
  { userId: string; email: string },
  { sent: boolean },
  { email: string }
>({
  name: "SendWelcomeEmail",
  run: async ({ input }) => {
    console.log(`Sent welcome email to ${input.email}`);
    return new StepResponse({ sent: true }, { email: input.email });
  },
  // Optional: log that we couldn't unsend the email
  compensate: async (data) => {
    console.log(`Note: Welcome email to ${data.email} was already sent`);
  },
});

// Step 4: Create initial subscription
const createSubscription = createSagaStep<
  { userId: string; plan: string },
  { subscriptionId: string },
  { subscriptionId: string }
>({
  name: "CreateSubscription",
  run: async ({ input }) => {
    if (input.plan === "INVALID") {
      return StepResponse.permanentFailure("Invalid subscription plan", {
        subscriptionId: "",
      });
    }
    const subscriptionId = `sub_${Date.now()}`;
    console.log(`Created ${input.plan} subscription for user ${input.userId}`);
    return new StepResponse({ subscriptionId }, { subscriptionId });
  },
  compensate: async (data) => {
    if (data.subscriptionId) {
      console.log(`Cancelled subscription ${data.subscriptionId}`);
    }
  },
});

// Registration workflow
export const registrationWorkflow = createSagaWorkflow(
  "RegistrationWorkflow",
  async (
    saga,
    input: {
      email: string;
      password: string;
      plan: string;
    }
  ) => {
    // Validate first (no compensation needed)
    await validateInput(saga, { email: input.email, password: input.password });

    // Create user
    const user = await createUser(saga, {
      email: input.email,
      password: input.password,
    });

    // Send welcome email
    await sendWelcomeEmail(saga, {
      userId: user.userId,
      email: input.email,
    });

    // Create subscription
    // If this fails, user creation is rolled back
    const subscription = await createSubscription(saga, {
      userId: user.userId,
      plan: input.plan,
    });

    return {
      userId: user.userId,
      subscriptionId: subscription.subscriptionId,
    };
  }
);

restate.endpoint().bind(registrationWorkflow).listen(9080);
