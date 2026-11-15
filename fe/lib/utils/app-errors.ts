/* ---- */
/* Application Error Classes - Enhanced with API Error Parsing            */
/* ---- */

// Accept details as object only
export type ValidationDetails = Record<string, string> | undefined;

export class AppError extends Error {
  public readonly isAppError = true;
  public readonly statusCode: number;
  public readonly errorType: string;
  public readonly validationDetails?: ValidationDetails;
  public readonly apiResponse?: any;

  constructor(
    message: string = "An application error occurred.",
    statusCode: number = 500,
    errorType: string = "AppError",
    validationDetails?: ValidationDetails,
    apiResponse?: any
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorType = errorType;
    this.validationDetails = validationDetails;
    this.apiResponse = apiResponse;
  }

  // Helper for both array/object validation details
  getAllValidationErrors(): Array<{ field: string; message: string }> {
    if (!this.validationDetails) return [];
    return Object.entries(this.validationDetails).map(([field, message]) => ({
      field,
      message: String(message)
    }));
  }

  static fromApiResponse(apiResponse: any): AppError {
    const { message, error } = apiResponse || {};
    const statusCode = error?.code || 500;
    const errorType = error?.type || 'UnknownError';
    const details = error?.details;

    switch (errorType.toLowerCase()) {
      case 'validationerror':
      case 'validation':
        return new ValidationError(message, statusCode, details, apiResponse);
      case 'notfound':
      case 'not_found':
        return new NotFoundError(message, statusCode, apiResponse);
      case 'conflict':
      case 'duplicate':
        return new ConflictError(message, statusCode, apiResponse);
      case 'unauthorized':
      case 'authorization':
        return new AuthorizationError(message, statusCode, apiResponse);
      case 'unauthenticated':
      case 'authentication':
        return new AuthenticationError(message, statusCode, apiResponse);
      case 'ratelimit':
      case 'rate_limit':
        return new RateLimitError(message, statusCode, apiResponse);
      case 'serviceunavailable':
      case 'service_unavailable':
        return new ServiceUnavailableError(message, statusCode, apiResponse);
      case 'badrequest':
      case 'bad_request':
        return new BadRequestError(message, statusCode, apiResponse);
      case 'paymentrequired':
      case 'payment_required':
        return new PaymentRequiredError(message, statusCode, apiResponse);
      case 'resourceexpired':
      case 'resource_expired':
        return new ResourceExpiredError(message, statusCode, apiResponse);
      default:
        return new AppError(message, statusCode, errorType, undefined, apiResponse);
    }
  }
}

// Only ValidationError accepts validationDetails
export class ValidationError extends AppError {
  constructor(
    message: string = "Validation error. Please check your input and try again.",
    statusCode: number = 422,
    validationDetails?: ValidationDetails,
    apiResponse?: any
  ) {
    super(message, statusCode, "ValidationError", validationDetails, apiResponse);
  }
}

// All other error classes do NOT accept validationDetails
export class NotFoundError extends AppError {
  constructor(
    message: string = "The requested resource was not found.",
    statusCode: number = 404,
    apiResponse?: any
  ) {
    super(message, statusCode, "NotFoundError", undefined, apiResponse);
  }
}

export class ConflictError extends AppError {
  constructor(
    message: string = "This resource already exists, or data not unique. Please try a different value.",
    statusCode: number = 409,
    apiResponse?: any
  ) {
    super(message, statusCode, "ConflictError", undefined, apiResponse);
  }
}

export class AuthorizationError extends AppError {
  constructor(
    message: string = "You don't have permission to perform this action.",
    statusCode: number = 403,
    apiResponse?: any
  ) {
    super(message, statusCode, "AuthorizationError", undefined, apiResponse);
  }
}

export class AuthenticationError extends AppError {
  constructor(
    message: string = "You are not authenticated. Please log in to continue.",
    statusCode: number = 401,
    apiResponse?: any
  ) {
    super(message, statusCode, "AuthenticationError", undefined, apiResponse);
  }
}

export class RateLimitError extends AppError {
  constructor(
    message: string = "Too many requests. Please wait a moment and try again.",
    statusCode: number = 429,
    apiResponse?: any
  ) {
    super(message, statusCode, "RateLimitError", undefined, apiResponse);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(
    message: string = "Service temporarily unavailable. Please try again later.",
    statusCode: number = 503,
    apiResponse?: any
  ) {
    super(message, statusCode, "ServiceUnavailableError", undefined, apiResponse);
  }
}

export class BadRequestError extends AppError {
  constructor(
    message: string = "Invalid request. Please check your input and try again.",
    statusCode: number = 400,
    apiResponse?: any
  ) {
    super(message, statusCode, "BadRequestError", undefined, apiResponse);
  }
}

export class PaymentRequiredError extends AppError {
  constructor(
    message: string = "Payment required. Please upgrade your plan to continue.",
    statusCode: number = 402,
    apiResponse?: any
  ) {
    super(message, statusCode, "PaymentRequiredError", undefined, apiResponse);
  }
}

export class ResourceExpiredError extends AppError {
  constructor(
    message: string = "This resource has expired and is no longer available.",
    statusCode: number = 410,
    apiResponse?: any
  ) {
    super(message, statusCode, "ResourceExpiredError", undefined, apiResponse);
  }
}

export class NetworkError extends AppError {
  constructor(
    message: string = "Network error. Please check your connection and try again.",
    originalError?: Error
  ) {
    super(message, 0, "NetworkError");
    this.cause = originalError;
  }
}

// Type Guards
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError || (error as any)?.isAppError === true;
}

export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

export function isAuthenticationError(error: unknown): error is AuthenticationError {
  return error instanceof AuthenticationError;
}

export function isAuthorizationError(error: unknown): error is AuthorizationError {
  return error instanceof AuthorizationError;
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
} 
