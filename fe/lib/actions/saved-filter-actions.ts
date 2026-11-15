"use server"

import { SavedFilter, SavedFilterCreate, SavedFilterUpdate } from "@/lib/types/filter-schema";
import { ORG_USERS_READ, PLATFORM_USERS_READ } from "@/lib/types/permission-schema";
import { apiCaller } from "@/lib/utils/api-caller-helper";
import { createServerLogger } from "@/lib/utils/logger-server";
import { revalidatePath } from "next/cache";

const logger = createServerLogger("SavedFilterActions")

export async function createSavedFilter(filterData: SavedFilterCreate): Promise<{ status: string; data?: SavedFilter; message?: string }> {
  const methodLogger = logger.forMethod("createSavedFilter")
  try {
    // Convert camelCase to snake_case for backend
    const backendData = {
      name: filterData.name,
      description: filterData.description,
      page_type: filterData.pageType,
      filter_config: filterData.filterConfig,
      is_default: filterData.isDefault,
    }
    
    const response = await apiCaller.post<SavedFilter>("/filters/", backendData, {
      requireAuth: true,
      requirePermission: [ORG_USERS_READ, PLATFORM_USERS_READ]
    })

    if (response.status === "success") {
      revalidatePath("/")
      return { status: "success", data: response.data }
    } else {
      return { status: "error", message: response.message || "Failed to create saved filter" }
    }
  } catch (error) {
    methodLogger.error("Error creating saved filter", error as Error)
    return { status: "error", message: "Failed to create saved filter" }
  }
}

export async function getSavedFilters(pageType?: string): Promise<{ status: string; data?: SavedFilter[]; message?: string }> {
  const methodLogger = logger.forMethod("getSavedFilters")
  try {
    const params = pageType ? { page_type: pageType } : {}
    const endpoint = apiCaller.createEndpoint("/filters/", params)
    
    const response = await apiCaller.get<SavedFilter[]>(endpoint, {
      requireAuth: true,
      requirePermission: [ORG_USERS_READ, PLATFORM_USERS_READ]
    })

    if (response.status === "success") {
      methodLogger.debug('Backend response for saved filters', response) // Debug: log the full response
      methodLogger.debug('Saved filters data', response.data) // Debug: log the data
      if (response.data && response.data.length > 0) {
        methodLogger.debug('First filter config', response.data[0]?.filterConfig) // Debug: log first filter config
        methodLogger.debug('First filter config type', typeof response.data[0]?.filterConfig) // Debug: log type
      }
      return { status: "success", data: response.data }
    } else {
      return { status: "error", message: response.message || "Failed to fetch saved filters" }
    }
  } catch (error) {
    methodLogger.error("Error fetching saved filters", error as Error)
    return { status: "error", message: "Failed to fetch saved filters" }
  }
}

export async function updateSavedFilter(filterId: number, filterData: SavedFilterUpdate): Promise<{ status: string; data?: SavedFilter; message?: string }> {
  const methodLogger = logger.forMethod("updateSavedFilter")
  try {
    // Convert camelCase to snake_case for backend
    const backendData: any = {}
    if (filterData.name !== undefined) backendData.name = filterData.name
    if (filterData.description !== undefined) backendData.description = filterData.description
    if (filterData.filterConfig !== undefined) backendData.filter_config = filterData.filterConfig
    if (filterData.isDefault !== undefined) backendData.is_default = filterData.isDefault
    
    const response = await apiCaller.put<SavedFilter>(`/filters/${filterId}`, backendData, {
      requireAuth: true,
      requirePermission: [ORG_USERS_READ, PLATFORM_USERS_READ]
    })

    if (response.status === "success") {
      revalidatePath("/")
      return { status: "success", data: response.data }
    } else {
      return { status: "error", message: response.message || "Failed to update saved filter" }
    }
  } catch (error) {
    methodLogger.error("Error updating saved filter", error as Error)
    return { status: "error", message: "Failed to update saved filter" }
  }
}

export async function deleteSavedFilter(filterId: number): Promise<{ status: string; message?: string }> {
  const methodLogger = logger.forMethod("deleteSavedFilter")
  try {
    const response = await apiCaller.delete(`/filters/${filterId}`, {
      requireAuth: true,
      requirePermission: [ORG_USERS_READ, PLATFORM_USERS_READ]
    })

    if (response.status === "success") {
      revalidatePath("/")
      return { status: "success" }
    } else {
      return { status: "error", message: response.message || "Failed to delete saved filter" }
    }
  } catch (error) {
    methodLogger.error("Error deleting saved filter", error as Error)
    return { status: "error", message: "Failed to delete saved filter" }
  }
}

export async function getDefaultFilter(pageType: string): Promise<{ status: string; data?: SavedFilter; message?: string }> {
  const methodLogger = logger.forMethod("getDefaultFilter")
  try {
    const response = await apiCaller.get<SavedFilter>(`/filters/default/${pageType}`, {
      requireAuth: true,
      requirePermission: [ORG_USERS_READ, PLATFORM_USERS_READ]
    })

    if (response.status === "success") {
      return { status: "success", data: response.data }
    } else {
      // Handle 404 specifically for no default filter
      if (response.code === 404) {
        return { status: "error", message: "No default filter found" }
      }
      return { status: "error", message: response.message || "Failed to fetch default filter" }
    }
  } catch (error) {
    methodLogger.error("Error fetching default filter", error as Error)
    return { status: "error", message: "Failed to fetch default filter" }
  }
} 