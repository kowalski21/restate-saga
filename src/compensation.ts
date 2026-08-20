/**
 * Executes every registered compensation in reverse registration order.
 *
 * The stack is cleared before execution so a retry or accidental reuse cannot
 * execute the same compensation callbacks twice. Every callback is attempted;
 * failures are aggregated and rethrown after the whole stack has been drained.
 */
export async function runCompensations(
  compensations: Array<() => Promise<void>>
): Promise<void> {
  const pending = compensations.splice(0).reverse();
  const errors: unknown[] = [];

  for (const compensate of pending) {
    try {
      await compensate();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, "One or more saga compensations failed");
  }
}
