import { describe, expect, it } from "vitest"

import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  BadRequestError,
  ConflictError,
  NetworkError,
  NotFoundError,
  PaymentRequiredError,
  RateLimitError,
  ResourceExpiredError,
  ServiceUnavailableError,
  ValidationError,
  isAppError,
  isAuthenticationError,
  isAuthorizationError,
  isNetworkError,
  isValidationError,
} from "@/lib/utils/app-errors"

describe("app-errors", () => {
  it("maps API error types to subclasses", () => {
    expect(AppError.fromApiResponse({ message: "v", error: { type: "ValidationError", code: 422, details: { a: "b" } } })).toBeInstanceOf(ValidationError)
    expect(AppError.fromApiResponse({ message: "n", error: { type: "NotFound", code: 404 } })).toBeInstanceOf(NotFoundError)
    expect(AppError.fromApiResponse({ message: "c", error: { type: "conflict" } })).toBeInstanceOf(ConflictError)
    expect(AppError.fromApiResponse({ message: "a", error: { type: "unauthorized" } })).toBeInstanceOf(AuthorizationError)
    expect(AppError.fromApiResponse({ message: "u", error: { type: "unauthenticated" } })).toBeInstanceOf(AuthenticationError)
    expect(AppError.fromApiResponse({ message: "r", error: { type: "rate_limit" } })).toBeInstanceOf(RateLimitError)
    expect(AppError.fromApiResponse({ message: "s", error: { type: "service_unavailable" } })).toBeInstanceOf(ServiceUnavailableError)
    expect(AppError.fromApiResponse({ message: "b", error: { type: "bad_request" } })).toBeInstanceOf(BadRequestError)
    expect(AppError.fromApiResponse({ message: "p", error: { type: "payment_required" } })).toBeInstanceOf(PaymentRequiredError)
    expect(AppError.fromApiResponse({ message: "e", error: { type: "resource_expired" } })).toBeInstanceOf(ResourceExpiredError)
    expect(AppError.fromApiResponse({ message: "x", error: { type: "Other", code: 500 } })).toBeInstanceOf(AppError)
  })

  it("exposes validation details and type guards", () => {
    const err = new ValidationError("bad", 422, { email: "required" })
    expect(err.getAllValidationErrors()).toEqual([{ field: "email", message: "required" }])
    expect(isAppError(err)).toBe(true)
    expect(isValidationError(err)).toBe(true)
    expect(isAuthenticationError(new AuthenticationError())).toBe(true)
    expect(isAuthorizationError(new AuthorizationError())).toBe(true)
    expect(isNetworkError(new NetworkError())).toBe(true)
    expect(new AppError().getAllValidationErrors()).toEqual([])
  })
})
