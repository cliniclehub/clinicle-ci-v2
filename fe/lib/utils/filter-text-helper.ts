import { FilterState, FilterCondition, FilterGroup, OPERATOR_LABELS, FilterField } from "@/lib/types/filter-schema"

/**
 * Converts a filter condition to readable text
 */
function conditionToText(
  condition: FilterCondition,
  filterFields: FilterField[]
): string {
  const field = filterFields.find(f => f.field === condition.field)
  const fieldLabel = field?.label || condition.field

  // Get operator label
  const operatorLabel = OPERATOR_LABELS[condition.operator] || condition.operator

  // Format value based on field type
  let valueText = ""
  if (condition.operator === "between") {
    // For between, show both values
    valueText = `${formatValue(condition.value, field)} and ${formatValue(condition.valueTo, field)}`
  } else if (condition.operator === "in" || condition.operator === "not_in") {
    // For in/not_in, show array values
    const values = Array.isArray(condition.value) ? condition.value : [condition.value]
    valueText = values.map(v => formatValue(v, field)).join(", ")
  } else if (condition.operator === "is_null" || condition.operator === "is_not_null") {
    // For null checks, no value needed
    valueText = ""
  } else {
    valueText = formatValue(condition.value, field)
  }

  // Build the text
  if (valueText) {
    return `${fieldLabel} ${operatorLabel} ${valueText}`
  } else {
    return `${fieldLabel} ${operatorLabel}`
  }
}

/**
 * Formats a value for display based on field type
 */
function formatValue(value: any, field?: FilterField): string {
  if (value === null || value === undefined) {
    return "null"
  }

  // If field has options, try to find the label
  if (field?.options) {
    const option = field.options.find(opt => opt.value === value || String(opt.value) === String(value))
    if (option) {
      return option.label
    }
  }

  // Format dates
  if (field?.type === "date" && typeof value === "string") {
    try {
      const date = new Date(value)
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString()
      }
    } catch (e) {
      // Fall through to default formatting
    }
  }

  // Format booleans
  if (typeof value === "boolean") {
    return value ? "Yes" : "No"
  }

  // Default: return as string
  return String(value)
}

/**
 * Converts filter state to readable text summary
 */
export function filterStateToText(
  filterState: FilterState,
  filterFields: FilterField[]
): string {
  if (!filterState || !filterState.groups || filterState.groups.length === 0) {
    return ""
  }

  // Filter out empty groups and invalid conditions
  const validGroups = filterState.groups
    .map(group => ({
      ...group,
      conditions: group.conditions.filter(condition => 
        condition.field && 
        condition.operator && 
        (condition.value !== undefined && condition.value !== '') &&
        (condition.operator !== 'between' || (condition.valueTo !== undefined && condition.valueTo !== ''))
      )
    }))
    .filter(group => group.conditions.length > 0)

  if (validGroups.length === 0) {
    return ""
  }

  // Convert each group to text
  const groupTexts = validGroups.map(group => {
    const conditionTexts = group.conditions.map(condition => 
      conditionToText(condition, filterFields)
    )
    
    // Join conditions within group
    const groupLogic = group.logic === "OR" ? " OR " : " AND "
    return `(${conditionTexts.join(groupLogic)})`
  })

  // Join groups
  const groupLogic = filterState.groupLogic === "OR" ? " OR " : " AND "
  return groupTexts.join(groupLogic)
}

