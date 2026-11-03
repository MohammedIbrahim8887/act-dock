/**
 * Browser shim for electrobun/view
 * Used when running the Vite frontend in development.
 */
export class Electroview {
  static defineRPC<T>(_config: unknown) {
    return {} as T;
  }
  rpc = {
    request: {
      service: async () => ({
        ok: false as const,
        error: {
          code: "NOT_DESKTOP",
          message: "Electrobun bridge not available",
        },
      }),
    },
  };
}
