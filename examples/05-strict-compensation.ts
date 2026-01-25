/**
 * Strict vs Hybrid Compensation Modes
 *
 * Demonstrates:
 * - createSagaStep (hybrid) - compensation registered BEFORE execution
 * - createSagaStepStrict - compensation registered AFTER success
 * - When to use each mode
 */

import * as restate from "@restatedev/restate-sdk";
import {
  createSagaWorkflow,
  createSagaStep,
  createSagaStepStrict,
  StepResponse,
} from "../src/index.js";

/**
 * HYBRID MODE (createSagaStep)
 *
 * Compensation is registered BEFORE the step runs.
 * Use when:
 * - The step might partially complete before failing
 * - You want to compensate even if the step throws midway
 * - The compensation doesn't require data from successful completion
 */

const reserveSeatsHybrid = createSagaStep<
  { eventId: string; count: number },
  { reservationId: string },
  { eventId: string; count: number }
>({
  name: "ReserveSeatsHybrid",
  run: async ({ input }) => {
    // Compensation data is known upfront (before we call external API)
    // If this step fails partway through, we still want to try releasing

    // Simulate API call that might fail
    const reservationId = `res_${Date.now()}`;
    console.log(`Reserving ${input.count} seats for event ${input.eventId}`);

    // Even if something fails after this point, compensation will run
    return new StepResponse({ reservationId }, input);
  },
  compensate: async (data, { failed }) => {
    // `failed` tells us if the step threw an error
    console.log(
      `Releasing seats for event ${data.eventId} (step failed: ${failed})`
    );
  },
});

/**
 * STRICT MODE (createSagaStepStrict)
 *
 * Compensation is registered AFTER the step succeeds.
 * Use when:
 * - Compensation requires data that only exists after success
 * - You only want to compensate fully completed operations
 * - The step is atomic (all-or-nothing with external service)
 */

const createBookingStrict = createSagaStepStrict<
  { customerId: string; eventId: string; seats: number },
  { bookingId: string; confirmationCode: string },
  { bookingId: string }
>({
  name: "CreateBookingStrict",
  run: async ({ input }) => {
    // The bookingId only exists after successful creation
    // We can't compensate something that was never created
    const bookingId = `book_${Date.now()}`;
    const confirmationCode = `CONF_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    console.log(`Created booking ${bookingId} with code ${confirmationCode}`);

    // Only register compensation if we successfully created the booking
    return new StepResponse(
      { bookingId, confirmationCode },
      { bookingId } // This data is only available after success
    );
  },
  compensate: async (data) => {
    // This only runs if the booking was actually created
    console.log(`Cancelling booking ${data.bookingId}`);
  },
});

/**
 * PRACTICAL COMPARISON
 *
 * Consider a payment processing scenario:
 */

// Hybrid: Use when you might need to void a pending authorization
const authorizeCardHybrid = createSagaStep<
  { cardToken: string; amount: number },
  { authId: string },
  { cardToken: string; amount: number }
>({
  name: "AuthorizeCardHybrid",
  run: async ({ input }) => {
    // We know the card token upfront, so if authorization partially fails,
    // we can still try to clean up any pending holds
    const authId = `auth_${Date.now()}`;
    return new StepResponse({ authId }, input);
  },
  compensate: async (data, { failed }) => {
    if (failed) {
      console.log(`Cleaning up failed auth attempt for amount ${data.amount}`);
    } else {
      console.log(`Voiding authorization for amount ${data.amount}`);
    }
  },
});

// Strict: Use when capture requires the auth ID
const capturePaymentStrict = createSagaStepStrict<
  { authId: string; amount: number },
  { captureId: string },
  { captureId: string; amount: number }
>({
  name: "CapturePaymentStrict",
  run: async ({ input }) => {
    // captureId only exists after successful capture
    const captureId = `cap_${Date.now()}`;
    console.log(`Captured payment ${captureId}`);
    return new StepResponse({ captureId }, { captureId, amount: input.amount });
  },
  compensate: async (data) => {
    // Only refund if we actually captured
    console.log(`Refunding capture ${data.captureId} for ${data.amount}`);
  },
});

// Workflow using both modes
export const bookingWorkflow = createSagaWorkflow(
  "BookingWorkflow",
  async (
    saga,
    input: {
      customerId: string;
      eventId: string;
      seats: number;
      cardToken: string;
      amount: number;
    }
  ) => {
    // Hybrid: reserve seats (might partially complete)
    await reserveSeatsHybrid(saga, {
      eventId: input.eventId,
      count: input.seats,
    });

    // Strict: create booking (all-or-nothing)
    const booking = await createBookingStrict(saga, {
      customerId: input.customerId,
      eventId: input.eventId,
      seats: input.seats,
    });

    // Hybrid: authorize card (might leave pending hold)
    const auth = await authorizeCardHybrid(saga, {
      cardToken: input.cardToken,
      amount: input.amount,
    });

    // Strict: capture payment (needs auth ID)
    const capture = await capturePaymentStrict(saga, {
      authId: auth.authId,
      amount: input.amount,
    });

    return {
      bookingId: booking.bookingId,
      confirmationCode: booking.confirmationCode,
      paymentId: capture.captureId,
    };
  }
);

restate.endpoint().bind(bookingWorkflow).listen(9080);
