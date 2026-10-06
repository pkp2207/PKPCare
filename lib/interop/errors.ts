/** Thrown by every adapter stub. Nothing in lib/interop performs network I/O. */
export class InteropNotImplementedError extends Error {
  constructor(adapter: string, operation: string) {
    super(`${adapter}.${operation} is NOT IMPLEMENTED (vendor credentials and onboarding required)`);
    this.name = "InteropNotImplementedError";
  }
}
