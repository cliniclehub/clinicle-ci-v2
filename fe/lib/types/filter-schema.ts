export type FilterOperator = 
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'greater_than_or_equal'
  | 'less_than_or_equal'
  | 'in'
  | 'not_in'
  | 'has_any'  // Same as 'in' for multiselect - user has any of the selected values
  | 'is_null'
  | 'is_not_null'
  | 'between'

export type FieldType = 'text' | 'number' | 'date' | 'boolean' | 'select' | 'multiselect'

export interface FilterField {
  id: string
  label: string
  field: string
  type: FieldType
  operators: FilterOperator[]
  options?: { label: string; value: any }[]
  /** Custom message when options are empty (for multiselect) */
  emptyPlaceholder?: string
}

export interface FilterCondition {
  id: string
  field: string
  operator: FilterOperator
  value: any
  valueTo?: any // For between operator
}

export interface FilterGroup {
  id: string
  conditions: FilterCondition[]
  logic: 'AND' | 'OR'
}

export interface FilterState {
  groups: FilterGroup[]
  groupLogic: 'AND' | 'OR'
}

// Saved Filter Types
export interface SavedFilter {
  id: number
  name: string
  description?: string
  pageType: string
  filterConfig: FilterState  // Direct object, not string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface SavedFilterCreate {
  name: string
  description?: string
  pageType: string
  filterConfig: FilterState  // Direct object, not string
  isDefault: boolean
}

export interface SavedFilterUpdate {
  name?: string
  description?: string
  filterConfig?: FilterState  // Direct object, not string
  isDefault?: boolean
}

// Operator labels for UI
export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  equals: 'is',
  not_equals: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  greater_than: 'is greater than',
  less_than: 'is less than',
  greater_than_or_equal: 'is greater than or equal to',
  less_than_or_equal: 'is less than or equal to',
  in: 'is in',
  not_in: 'is not in',
  has_any: 'has any of',
  is_null: 'is empty',
  is_not_null: 'is not empty',
  between: 'is between'
}

// Helper to create new entities
export function createNewCondition(field?: string): FilterCondition {
  return {
    id: `condition-${Date.now()}-${Math.random()}`,
    field: field || '',
    operator: 'equals',
    value: ''
  }
}

export function createNewGroup(): FilterGroup {
  return {
    id: `group-${Date.now()}-${Math.random()}`,
    conditions: [],
    logic: 'AND'
  }
}

// Encode filters for URL
export function encodeFilters(filterState: FilterState): string {
  if (!filterState || !filterState.groups) {
    return JSON.stringify({ groups: [], groupLogic: 'AND' })
  }

  const apiFilters = {
    groups: filterState.groups
      .filter(group => group && group.conditions) // Filter out invalid groups
      .map(group => ({
        conditions: (group.conditions || [])
          .filter(condition => isValidCondition(condition)) // Only include valid conditions
          .map(condition => ({
            field: condition.field,
            operator: condition.operator,
            value: condition.value,
            valueTo: condition.valueTo
          })),
        logic: group.logic || 'AND'
      }))
      .filter(group => group.conditions.length > 0), // Filter out empty groups
    groupLogic: filterState.groupLogic || 'AND'
  }
  
  return JSON.stringify(apiFilters)
}

// Count all conditions (including incomplete ones)
export function countActiveConditions(filterState: FilterState): number {
  if (!filterState || !filterState.groups) {
    return 0
  }
  
  return filterState.groups.reduce((sum, group) => {
    if (!group || !group.conditions) {
      return sum
    }
    return sum + group.conditions.length
  }, 0)
}

// Count only valid/complete conditions
export function countValidConditions(filterState: FilterState | undefined): number {
  if (!filterState || !filterState.groups) {
    return 0
  }
  
  return filterState.groups.reduce((sum, group) => 
    sum + group.conditions.filter(condition => 
      condition.field && 
      condition.operator && 
      (condition.value !== undefined && condition.value !== '') &&
      // For 'between' operator, also check valueTo
      (condition.operator !== 'between' || (condition.valueTo !== undefined && condition.valueTo !== ''))
    ).length, 0
  )
}

// Check if a condition is valid/complete
export function isValidCondition(condition: FilterCondition): boolean {
  return !!(
    condition.field && 
    condition.operator && 
    (condition.value !== undefined && condition.value !== '') &&
    // For 'between' operator, also check valueTo
    (condition.operator !== 'between' || (condition.valueTo !== undefined && condition.valueTo !== ''))
  )
}