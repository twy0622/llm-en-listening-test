export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = "error",
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function badRequest(message: string, details?: unknown): ApiError {
  return new ApiError(400, message, "validation_error", details);
}

export function unauthorized(message = "Authentication required"): ApiError {
  return new ApiError(401, message, "unauthorized");
}

export function forbidden(message = "Not allowed"): ApiError {
  return new ApiError(403, message, "forbidden");
}

export function notFound(message = "Not found"): ApiError {
  return new ApiError(404, message, "not_found");
}

export function conflict(message: string): ApiError {
  return new ApiError(409, message, "conflict");
}

export function tooMany(message = "Too many requests"): ApiError {
  return new ApiError(429, message, "rate_limited");
}
