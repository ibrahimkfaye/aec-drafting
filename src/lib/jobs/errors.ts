/** Job failures carry short codes only — never file contents or names. */
export class JobError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export function errorCode(e: unknown): string {
  return e instanceof JobError ? e.code : "unexpected_error";
}
