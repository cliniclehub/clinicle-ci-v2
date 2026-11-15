"use server"

import { ApiResponse } from "@/lib/types/api-response-schema"
import {
  Organization,
  OrganizationBasicInfo,
  OrganizationBranding,
  OrganizationContact,
  OrganizationForm,
  OrganizationLandingPage,
  OrganizationLegal,
  OrganizationUpdatePayload,
} from "@/lib/types/organization-schema"
import {
  ORG_SETTINGS_MANAGE,
  PLATFORM_ORGANIZATIONS_READ,
  PLATFORM_ORGANIZATIONS_WRITE,
} from "@/lib/types/permission-schema"
import { User } from "@/lib/types/user-schema"
import { apiCaller } from "@/lib/utils/api-caller-helper"

// List organizations for dropdown (Platform-level - Super Admin only)
export async function listOrganizationsDropdown(): Promise<ApiResponse<{ id: string; name: string; code: string }[]>> {
  const response = await apiCaller.get<{ id: string; name: string; code: string }[]>(
    "/organizations/dropdown",
    { requireAuth: true, requirePermission: PLATFORM_ORGANIZATIONS_READ }
  )
  return response
}

// List organizations with pagination and filters (Platform-level - Super Admin only)
export async function listOrganizations(params: {
  page?: number
  pageSize?: number
  search?: string
  isActive?: boolean
  orgType?: string
  sortBy?: string
  sortOrder?: "asc" | "desc"
}): Promise<ApiResponse<Organization[]>> {
    // Convert camelCase to snake_case for backend
    const backendParams: Record<string, any> = {}
    if (params.page !== undefined) backendParams.page = params.page
    if (params.pageSize !== undefined) backendParams.page_size = params.pageSize
    if (params.search !== undefined) backendParams.search = params.search
    if (params.isActive !== undefined) backendParams.is_active = params.isActive
    if (params.orgType !== undefined) backendParams.org_type = params.orgType
    if (params.sortBy !== undefined) backendParams.sort_by = params.sortBy
    if (params.sortOrder !== undefined) backendParams.sort_order = params.sortOrder

    const endpoint = apiCaller.createEndpoint("/organizations/", backendParams);

    const response = await apiCaller.get<Organization[]>(endpoint, {
      requireAuth: true,
      requirePermission: PLATFORM_ORGANIZATIONS_READ
    });

    return response;
}

// Get single organization (Platform-level - Super Admin only)
export async function getOrganization(organization_id: string): Promise<ApiResponse<Organization>> {
    const response = await apiCaller.get<Organization>(`/organizations/${organization_id}`, {
      requireAuth: true,
      requirePermission: PLATFORM_ORGANIZATIONS_READ
    })
    return response
}

// Create organization (Platform-level - Super Admin only)
export async function createOrganization(data: OrganizationForm): Promise<ApiResponse<Organization>> {
    const response = await apiCaller.post<Organization>("/organizations/", data, {
      requireAuth: true,
      requirePermission: PLATFORM_ORGANIZATIONS_READ
    })
    return response
}

// Update organization (Platform-level - Super Admin only)
export async function updateOrganization(
  id: string,
  data: OrganizationUpdatePayload
): Promise<ApiResponse<Organization>> {
    const response = await apiCaller.patch<Organization>(`/organizations/${id}`, data, {
      requireAuth: true,
      requirePermission: PLATFORM_ORGANIZATIONS_READ
    })
    return response
}

// Section-specific update functions
export async function updateOrganizationBasicInfo(
  id: string,
  data: Omit<OrganizationBasicInfo, "domainKind">
): Promise<ApiResponse<Organization>> {
  return updateOrganization(id, data)
}

export async function updateOrganizationBranding(
  id: string,
  data: OrganizationBranding
): Promise<ApiResponse<Organization>> {
  return updateOrganization(id, data)
}

export async function updateOrganizationLegal(
  id: string,
  data: OrganizationLegal
): Promise<ApiResponse<Organization>> {
  return updateOrganization(id, data)
}

export async function updateOrganizationContact(
  id: string,
  data: OrganizationContact
): Promise<ApiResponse<Organization>> {
  return updateOrganization(id, data)
}

// Delete organization (Platform-level - Super Admin only)
export async function deleteOrganization(id: string): Promise<ApiResponse<void>> {
    const response = await apiCaller.delete<void>(`/organizations/${id}`, {
      requireAuth: true,
      requirePermission: PLATFORM_ORGANIZATIONS_WRITE
    })
    return response
}

export async function updateOrganizationBrandingPlatform(
  id: string,
  data: OrganizationBranding
): Promise<ApiResponse<Organization>> { 
  return updateOrganization(id, data)
}

export async function updateOrganizationLandingPagePlatform(
  id: string,
  data: OrganizationLandingPage
): Promise<ApiResponse<Organization>> {
  return updateOrganization(id, data)
}

// Get organization users (Platform-level - Super Admin only)
export async function getOrganizationUsers(
  organizationId: string,
  params: {
    page?: number
    pageSize?: number
    search?: string
    role?: string
  }
): Promise<ApiResponse<User[]>> {
    const endpoint = apiCaller.createEndpoint(`/organizations/${organizationId}/users`, params);

    const response = await apiCaller.get<User[]>(endpoint, {
      requireAuth: true,
      requirePermission: PLATFORM_ORGANIZATIONS_READ
    });

    return response;
}

// Add user to organization (Platform-level - Super Admin only)
export async function addUserToOrganization(
  organizationId: string,
  userId: string,
  roleKeys: string[]
): Promise<ApiResponse<void>> {
    const response = await apiCaller.post<void>(
      `/organizations/${organizationId}/users/${userId}`,
      { role_keys: roleKeys },
      { requireAuth: true, requirePermission: PLATFORM_ORGANIZATIONS_READ }
    )
    return response
}

// Remove user from organization (Platform-level - Super Admin only)
export async function removeUserFromOrganization(
  organizationId: string,
  userId: string
): Promise<ApiResponse<void>> {
    const response = await apiCaller.delete<void>(
      `/organizations/${organizationId}/users/${userId}`,
      { requireAuth: true, requirePermission: PLATFORM_ORGANIZATIONS_WRITE }
    )
    return response
}

//--------------------------------
// Verify Domain DNS Configuration (Super Admin Only)
//--------------------------------
export interface DomainVerificationResult {
  domain: string
  verified: boolean
  cname_target: string | null
  expected_target: string
  message: string
}

export async function verifyDomainDNS(domain: string, domainType: "organization" | "platform" = "organization"): Promise<ApiResponse<DomainVerificationResult>> {
  const endpoint = apiCaller.createEndpoint("/organizations/verify-domain-dns", { domain, domain_type: domainType })
  const response = await apiCaller.get<DomainVerificationResult>(
    endpoint,
    {
      requireAuth: true,
      requirePermission: [ORG_SETTINGS_MANAGE, PLATFORM_ORGANIZATIONS_WRITE],
    }
  )
  return response
}

//--------------------------------
// Add Domain to Render (Super Admin Only)
//--------------------------------
export interface AddDomainToRenderResult {
  domain: string
  render_response: any
  message: string
}

export async function addDomainToRender(domain: string): Promise<ApiResponse<AddDomainToRenderResult>> {
  const response = await apiCaller.post<AddDomainToRenderResult>(
    "/organizations/add-domain-to-render",
    { domain },
    {
      requireAuth: true,
      requirePermission: [ORG_SETTINGS_MANAGE, PLATFORM_ORGANIZATIONS_WRITE],
    }
  )
  return response
}

//--------------------------------
// Add Domain to Namecheap (Super Admin Only)
//--------------------------------
export interface AddDomainToNamecheapResult {
  status: "exists" | "created"
  domain: string
  message: string
  current_target?: string
  target?: string
  set_hosts_result?: {
    is_success: boolean
  }
}

export async function addDomainToNamecheap(domain: string): Promise<ApiResponse<AddDomainToNamecheapResult>> {
  const response = await apiCaller.post<AddDomainToNamecheapResult>(
    "/organizations/add-domain-to-namecheap",
    { domain },
    {
      requireAuth: true,
      requirePermission: PLATFORM_ORGANIZATIONS_WRITE
    }
  )
  return response
}
