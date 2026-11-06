/**
 * Runs every closer in order, even if an earlier one fails (sync or async).
 * Returns the process exit code: 0 if all succeeded, 1 otherwise.
 */
export async function closeAll(closers: (() => unknown)[], log: (message: string) => void): Promise<number> {
  let code = 0;
  for (const close of closers) {
    try {
      await close();
    } catch (err) {
      code = 1;
      log(`shutdown: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return code;
}
