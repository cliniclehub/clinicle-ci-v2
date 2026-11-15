"use client"

import { Calendar } from "@/components/ui/calendar"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import { FilterField, FilterOperator } from "@/lib/types/filter-schema"
import { cn } from "@/lib/utils/cn"
import { format } from "date-fns"
import { CalendarIcon, Check, Search, X } from "lucide-react"
import { Button } from "../ui/button"
import { useState, useMemo } from "react"
import { Badge } from "@/components/ui/badge"

interface FilterValueInputProps {
  field: FilterField
  operator: FilterOperator
  value: any
  valueTo?: any
  onChange: (value: any, valueTo?: any) => void
}

export function FilterValueInput({
  field,
  operator,
  value,
  valueTo,
  onChange,
}: FilterValueInputProps) {
  // Don't render value input for null/not null operators
  if (operator === 'is_null' || operator === 'is_not_null') {
    return null
  }

  // Handle different field types
  switch (field.type) {
    case 'text':
      return (
        <Input
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter value..."
          className="w-full"
        />
      )

    case 'number':
      if (operator === 'between') {
        return (
          <div className="flex gap-2 items-center">
            <Input
              type="number"
              value={value || ''}
              onChange={(e) => onChange(e.target.valueAsNumber || 0, valueTo)}
              placeholder="From"
              className="w-full"
            />
            <span className="text-sm">and</span>
            <Input
              type="number"
              value={valueTo || ''}
              onChange={(e) => onChange(value, e.target.valueAsNumber || 0)}
              placeholder="To"
              className="w-full"
            />
          </div>
        )
      }
      return (
        <Input
          type="number"
          value={value || ''}
          onChange={(e) => onChange(e.target.valueAsNumber || 0)}
          placeholder="Enter number..."
          className="w-full"
        />
      )

    case 'date':
      if (operator === 'between') {
        return (
          <div className="flex gap-2 items-center">
            <DatePicker
              value={value}
              onChange={(date) => onChange(date, valueTo)}
              placeholder="From date"
            />
            <span className="text-sm">and</span>
            <DatePicker
              value={valueTo}
              onChange={(date) => onChange(value, date)}
              placeholder="To date"
            />
          </div>
        )
      }
      return (
        <DatePicker
          value={value}
          onChange={onChange}
          placeholder="Select date"
        />
      )

    case 'boolean':
      if (!field.options) return null
      return (
        <Select value={String(value)} onValueChange={(v) => onChange(v === 'true')}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={String(option.value)} value={String(option.value)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )

    case 'select':
      if (!field.options) return null
      return (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )

    case 'multiselect':
      if (!field.options) return null
      return <SearchableMultiselect 
        options={field.options} 
        value={Array.isArray(value) ? value : []} 
        onChange={onChange}
        placeholder={`Search ${field.label?.toLowerCase() || 'options'}...`}
        emptyPlaceholder={field.emptyPlaceholder}
      />

    default:
      return null
  }
}

// Searchable multiselect component
function SearchableMultiselect({
  options,
  value,
  onChange,
  placeholder,
  emptyPlaceholder,
}: {
  options: Array<{ label: string; value: any }>
  value: any[]
  onChange: (value: any[]) => void
  placeholder: string
  emptyPlaceholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  // Filter options based on search query
  const filteredOptions = useMemo(() => {
    if (!searchQuery) return options
    const query = searchQuery.toLowerCase()
    return options.filter((option) =>
      option.label.toLowerCase().includes(query)
    )
  }, [options, searchQuery])

  // Get selected options for display
  const selectedOptions = useMemo(() => {
    return options.filter((option) => value.includes(option.value))
  }, [options, value])

  const handleSelect = (optionValue: any) => {
    const currentValues = Array.isArray(value) ? value : []
    if (currentValues.includes(optionValue)) {
      onChange(currentValues.filter((v) => v !== optionValue))
    } else {
      onChange([...currentValues, optionValue])
    }
  }

  const handleRemove = (optionValue: any) => {
    const currentValues = Array.isArray(value) ? value : []
    onChange(currentValues.filter((v) => v !== optionValue))
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between bg-background hover:bg-accent"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className={cn(
                "text-sm truncate",
                selectedOptions.length > 0 
                  ? "text-foreground font-medium" 
                  : "text-muted-foreground"
              )}>
                {selectedOptions.length > 0
                  ? `${selectedOptions.length} selected`
                  : placeholder}
              </span>
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent 
          className="w-[400px] p-0" 
          align="start"
          onWheel={(e) => {
            // Allow wheel events to propagate to the CommandList
            e.stopPropagation()
          }}
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={placeholder}
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList className="max-h-[300px]">
              <CommandEmpty>
                {options.length === 0 && emptyPlaceholder
                  ? emptyPlaceholder
                  : 'No results found.'}
              </CommandEmpty>
              <CommandGroup>
                {filteredOptions.map((option) => {
                  const isSelected = value.includes(option.value)
                  return (
                    <CommandItem
                      key={option.value}
                      value={option.label}
                      onSelect={() => handleSelect(option.value)}
                      className="cursor-pointer"
                    >
                      <div className="flex items-center gap-2 flex-1">
                        <div
                          className={cn(
                            "flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                            isSelected
                              ? "bg-primary text-primary-foreground"
                              : "opacity-50 [&_svg]:invisible"
                          )}
                        >
                          <Check className="h-4 w-4" />
                        </div>
                        <span className="text-sm">{option.label}</span>
                      </div>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Display selected items as badges */}
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedOptions.map((option) => (
            <Badge
              key={option.value}
              variant="secondary"
              className="text-xs bg-muted/70 text-foreground border border-border/70"
            >
              {option.label}
              <button
                onClick={() => handleRemove(option.value)}
                className="ml-2 rounded-full outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

// Date picker component
function DatePicker({
  value,
  onChange,
  placeholder,
}: {
  value: any
  onChange: (date: any) => void
  placeholder: string
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal",
            !value && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value ? format(new Date(value), "PPP") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={value ? new Date(value) : undefined}
          onSelect={(date) => onChange(date?.toISOString())}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  )
}