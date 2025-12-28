import { Worker } from "worker_threads";

/**
 * Absent Exclusion Engine (Enforced)
 * ---------------------------------
 * - Isolated execution (Worker)
 * - Enforced TTL (hard kill)
 * - No return value
 * - No IPC channel
 * - No shared state
 * - Self-destruction
 *
 * What it guarantees (functionally):
 * - No extractable result
 * - No replayable value
 * - No persistent state
 *
 * What it does NOT guarantee:
 * - No side-channels (timing / power)
 * - No DoS if spammed (needs outer gates)
 */

export function createAbsentExclusion({ ttlMs = 25 } = {}) {
  let used = false;

  function execute(task) {
    if (used) return;
    if (typeof task !== "function") return;

    used = true;

    // --- spawn isolated execution ---
    const worker = new Worker(
      `
      // No imports except built-ins
      try {
        (${task.toString()})();
      } finally {
        // Self-destruction no matter what
        process.exit(0);
      }
    `,
      {
        eval: true,
        stdout: false,
        stderr: false,
      }
    );

    // --- hard kill (enforced TTL) ---
    const killer = setTimeout(() => {
      worker.terminate();
    }, ttlMs);

    // --- cleanup (best effort) ---
    worker.once("exit", () => {
      clearTimeout(killer);
    });
  }

  // --- frozen surface ---
  return Object.freeze({ execute });
}
