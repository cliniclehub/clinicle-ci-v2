"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    FilterCondition,
    FilterField,
    FilterGroup,
    createNewCondition,
} from "@/lib/types/filter-schema"
import { Plus, Trash2 } from "lucide-react"
import { FilterConditionComponent } from "./filter-condition"

interface FilterGroupProps {
  group: FilterGroup
  fields: FilterField[]
  onUpdate: (group: FilterGroup) => void
  onDelete: () => void
  canDelete: boolean
  groupNumber: number
}

export function FilterGroupComponent({
  group,
  fields,
  onUpdate,
  onDelete,
  canDelete,
  groupNumber,
}: FilterGroupProps) {
  const handleAddCondition = () => {
    onUpdate({
      ...group,
      conditions: [...group.conditions, createNewCondition()],
    })
  }

  const handleUpdateCondition = (index: number, condition: FilterCondition) => {
    const newConditions = [...group.conditions]
    newConditions[index] = condition
    onUpdate({
      ...group,
      conditions: newConditions,
    })
  }

  const handleDeleteCondition = (index: number) => {
    onUpdate({
      ...group,
      conditions: group.conditions.filter((_, i) => i !== index),
    })
  }

  const handleLogicChange = (logic: 'AND' | 'OR') => {
    onUpdate({
      ...group,
      logic,
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Group {groupNumber}</span>
          <span className="text-sm text-muted-foreground">- Match</span>
          <Select value={group.logic} onValueChange={handleLogicChange}>
            <SelectTrigger className="w-24 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AND">All</SelectItem>
              <SelectItem value="OR">Any</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">of the following:</span>
        </div>
        {canDelete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="h-8 px-2"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {group.conditions.length === 0 && (
          <div className="text-center py-4 text-sm text-muted-foreground">
            No conditions added yet
          </div>
        )}
        
        {group.conditions.map((condition, index) => (
          <FilterConditionComponent
            key={condition.id || `condition-${index}`}
            condition={condition}
            fields={fields}
            onUpdate={(updated) => handleUpdateCondition(index, updated)}
            onDelete={() => handleDeleteCondition(index)}
          />
        ))}

        <Button
          variant="outline"
          size="sm"
          onClick={handleAddCondition}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Condition
        </Button>
      </CardContent>
    </Card>
  )
}