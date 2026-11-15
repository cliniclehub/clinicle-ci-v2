// Types based on backend schema
export interface RegisterRequest {
    email: string
    password: string
    firstName: string
    lastName: string
    orgDomain: string
    phoneNumber?: string
  }
  
  export interface EmailVerificationRequest {
    email: string
    code: string
    orgDomain: string
  }
  
  export interface LoginRequest {
    email: string
    password: string
    orgDomain: string
    deviceInfo?: {
      browser?: string
      os?: string
      device?: string
    }
  }
  
  export interface ForgotPasswordRequest {
    email: string
    orgDomain: string
  }
  
  export interface ResetPasswordRequest {
    email: string
    code: string
    newPassword: string
    orgDomain: string
  }
  
  export interface ChangePasswordRequest {
    oldPassword: string
    newPassword: string
  }
  
  export interface TokenResponse {
    accessToken: string
    refreshToken: string
    tokenType: string
    expiresIn: number
    refreshExpiresIn: number
  }

  // TokenData is the data that is stored in the token
  //todo: add the data that is stored in the token
  export interface TokenData {

      sub: string,
      email: string,
      orgId: string,
      orgDomain: string,
      roles: string[],
      permissions?: string[],
      exp: number,
      iat: number,
      sessionId: string
    
  }

  // Unified UserTokenInfo interface (matches backend UserTokenInfo)
  export interface UserTokenInfo {
    id: string
    email: string
    firstName: string
    lastName: string
    organizationId: string
    organizationName: string
    organizationDomain: string
    roles: string[]
    permissions?: string[]
    emailVerified: boolean
    emailVerifiedAt?: string
    mustChangePassword: boolean
    locked: boolean
    sessionId?: string
    createdAt?: string
    updatedAt?: string
  }
  


export interface LoginResponse {
  tokens: TokenResponse
  user: UserTokenInfo
}


export interface SessionInfo {
  id: number
  deviceInfo: {
    browser?: string
    os?: string
    device?: string
    userAgent?: string
    /** @deprecated Not stored for new logins (GDPR). Do not display. */
    ipAddress?: string
    hostname?: string
    /** City from GeoIP at login time (no IP stored) */
    loginCity?: string
    loginCountry?: string
    /** Snake_case from API; prefer loginCity/loginCountry when available */
    login_city?: string
    login_country?: string
  }
  createdAt: string
  lastUsedAt?: string
  isCurrent: boolean
  expiresAt?: string // or Date, depending on your backend
  revoked?: boolean
}



export interface UserSessionsResponse {
  sessions: SessionInfo[]
  total: number
}

export interface LoginHistoryInfo {
  id: string
  email: string
  /** @deprecated Not stored for new logins (GDPR); kept for legacy records only. Do not display. */
  ipAddress?: string
  loginCity?: string
  loginCountry?: string
  loginContinent?: string
  userAgent?: string
  success: boolean
  attemptedAt: string
  deviceInfo?: Record<string, any>
  organizationName?: string
}

export interface UserLoginHistoryResponse {
  loginHistory: LoginHistoryInfo[]
  total: number
  successfulLogins: number
  failedLogins: number
  periodDays: number
}

export interface LoginStatistics {
  totalAttempts: number
  successfulLogins: number
  failedLogins: number
  successRate: number
  uniqueIps: number
  lastSuccessfulLogin?: string
  periodDays: number
}