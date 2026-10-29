export class ApiError extends Error {
  constructor(
    public status: number,
    public kind: string,
    message: string,
    public exposeMessage = false,
  ) {
    super(message);
  }
}
export function missing(message = "Resource not found"): never {
  throw new ApiError(404, "not-found", message);
}
