// API Response and Request Types

// Pagination interface for list responses
export interface PaginationInfo {
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

// Success response interface
export interface ApiSuccessResponse<T> {
  status: "success";
  message: string;
  data: T;
  timestamp: string;
  pagination: PaginationInfo | null;
}

// Error response interface
export interface ApiErrorResponse {
  status: "error";
  code: number;
  type: string;
  message: string;
  description: string;
  details?: Record<string, any>;
  timestamp: string;
}

// Union type for all API responses
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// Request options interface
export interface ApiRequestOptions extends RequestInit {
  baseUrl?: string;
  endpoint: string;
  requireAuth?: boolean;
  /** Attach Bearer token when present without requiring login */
  attachAuthIfAvailable?: boolean;
  requireRole?: string | string[];
  /** Require one permission (string) or any of several (array). */
  requirePermission?: string | string[];
  /** Override LOG_HTTP_* for this call. Omit to inherit env defaults. */
  logRequest?: boolean;
  /** Override LOG_HTTP_* for this call. Omit to inherit env defaults. */
  logResponse?: boolean;
}

