import type { ApiResponse } from "@/lib/types/api-response-schema"

export function pickErrorDetails(
  responseData: Record<string, unknown>
): Record<string, unknown> | undefined {
  const raw = responseData.details
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  const detail = responseData.detail
  if (detail != null && typeof detail === "object" && !Array.isArray(detail)) {
    return detail as Record<string, unknown>
  }
  return undefined
}

function errorMessageFromEnvelope(responseData: Record<string, unknown>): string {
  if (typeof responseData.message === "string" && responseData.message) {
    return responseData.message
  }
  if (typeof responseData.detail === "string" && responseData.detail) {
    return responseData.detail
  }
  return "Request failed"
}

/** HTTP 2xx body that declares a business-level failure (success:false or status:error). */
export function isHttpOkErrorEnvelope(responseData: Record<string, unknown>): boolean {
  return responseData.success === false || responseData.status === "error"
}

export function parseHttpOkErrorEnvelope<T>(
  responseData: Record<string, unknown>,
  httpStatus: number,
  getErrorType: (status: number) => string
): ApiResponse<T> {
  const detailsErr = pickErrorDetails(responseData)
  const code =
    typeof responseData.code === "number"
      ? responseData.code
      : httpStatus
  return {
    status: "error",
    code,
    type:
      (typeof responseData.type === "string" && responseData.type) ||
      getErrorType(httpStatus),
    message: errorMessageFromEnvelope(responseData),
    description:
      typeof responseData.description === "string"
        ? responseData.description
        : "",
    timestamp:
      (typeof responseData.timestamp === "string" && responseData.timestamp) ||
      new Date().toISOString(),
    ...(detailsErr ? { details: detailsErr } : {}),
  }
}
