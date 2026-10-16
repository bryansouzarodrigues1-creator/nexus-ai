// A stalled inference must not hold an HTTP chat request open forever.
// Passing AbortSignal attempts cancellation; Promise.race is the final bound.
export async function withDeadline(run, milliseconds = 8000, label = "operação") {
  const duration = Math.max(200, Math.min(60000, Number(milliseconds) || 8000));
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => run(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          const error = new Error("Tempo limite excedido em " + label + ".");
          error.code = "NEXUS_TIMEOUT";
          reject(error);
        }, duration);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
