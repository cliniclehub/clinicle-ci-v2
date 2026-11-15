"use client"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FilterCondition, FilterField, OPERATOR_LABELS } from "@/lib/types/filter-schema"
import { AlertCircle, CheckCircle, X } from "lucide-react"
import { FilterValueInput } from "./filter-value-input"

interface FilterConditionProps {
  condition: FilterCondition
  fields: FilterField[]
  onUpdate: (condition: FilterCondition) => void
  onDelete: () => void
}

export function FilterConditionComponent({
  condition,
  fields,
  onUpdate,
  onDelete,
}: FilterConditionProps) {
  const selectedField = fields.find((f) => f.field === condition.field)
  const availableOperators = selectedField?.operators || []

  const handleFieldChange = (fieldName: string) => {
    const newField = fields.find((f) => f.field === fieldName)
    if (newField) {
      // Reset operator and value when field changes
      onUpdate({
        ...condition,
        field: fieldName,
        operator: newField.operators[0] || 'equals',
        value: '',
        valueTo: undefined,
      })
    }
  }

  const handleOperatorChange = (operator: any) => {
    onUpdate({
      ...condition,
      operator,
      value: condition.value,
      valueTo: undefined, // Reset valueTo when operator changes
    })
  }

  const handleValueChange = (value: any, valueTo?: any) => {
    onUpdate({
      ...condition,
      value,
      valueTo,
    })
  }

  const isComplete = condition.field && condition.operator && (condition.value !== undefined && condition.value !== '')

  return (
    <div className={`flex items-start gap-2 p-2 rounded-md border ${
      isComplete ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'
    }`}>
      {/* Field selector */}
      <Select value={condition.field} onValueChange={handleFieldChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Select field..." />
        </SelectTrigger>
        <SelectContent>
          {fields.map((field) => (
            <SelectItem key={field.id} value={field.field}>
              {field.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Operator selector */}
      {selectedField && (
        <Select value={condition.operator} onValueChange={handleOperatorChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availableOperators.map((operator) => (
              <SelectItem key={operator} value={operator}>
                {OPERATOR_LABELS[operator]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Value input */}
      {selectedField && (
        <div className="flex-1">
          <FilterValueInput
            field={selectedField}
            operator={condition.operator}
            value={condition.value}
            valueTo={condition.valueTo}
            onChange={handleValueChange}
          />
        </div>
      )}

      {/* Completion indicator */}
      <div className="flex items-center">
        {isComplete ? (
          <CheckCircle className="h-4 w-4 text-green-600" />
        ) : (
          <AlertCircle className="h-4 w-4 text-orange-600" />
        )}
      </div>

      {/* Delete button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        className="h-9 w-9"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}