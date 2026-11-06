export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export const TIMEOUT_MS = 15_000;
