"use client"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { COUNTRIES_SORTED, type CountryRecord } from "@/lib/constants/countries"
import { cn } from "@/lib/utils/cn"
import { Check, ChevronsUpDown } from "lucide-react"
import { useMemo, useRef, useState } from "react"

export type CountrySelectValueMode = "iso" | "name"

function optionValue(mode: CountrySelectValueMode, c: CountryRecord): string {
  return mode === "iso" ? c.code : c.name
}

export interface CountrySelectProps {
  value: string
  onValueChange: (value: string) => void
  mode: CountrySelectValueMode
  /** Full country list by default; pass a smaller list (e.g. continents) to reuse this control. */
  options?: readonly CountryRecord[]
  placeholder?: string
  /** Placeholder for the type-to-filter field inside the popover */
  searchPlaceholder?: string
  /** Accessible name for the command list (cmdk) */
  commandLabel?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
  id?: string
  "aria-label"?: string
}

export function CountrySelect({
  value,
  onValueChange,
  mode,
  options,
  placeholder = "Select country",
  searchPlaceholder = "Type to filter…",
  commandLabel = "Countries",
  disabled,
  className,
  triggerClassName,
  id,
  "aria-label": ariaLabel,
}: CountrySelectProps) {
  const [open, setOpen] = useState(false)
  const [filterInstance, setFilterInstance] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const list = options ?? COUNTRIES_SORTED

  const selected = useMemo(
    () => list.find((c) => optionValue(mode, c) === value),
    [value, mode, list]
  )

  const displayLabel = selected?.name ?? (value ? value : null)

  const emptyLabel = commandLabel === "Countries" ? "No country found." : "No match."

  return (
    <Popover
      modal={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setFilterInstance((k) => k + 1)
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outlineNeutral"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel ?? placeholder}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", triggerClassName)}
        >
          <span className="truncate text-left">
            {displayLabel ?? placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0", className)}
        align="start"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          requestAnimationFrame(() => searchInputRef.current?.focus())
        }}
      >
        <Command
          key={filterInstance}
          label={commandLabel}
          loop
          shouldFilter
        >
          <CommandInput
            ref={searchInputRef}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
          <CommandList className="max-h-[min(50vh,320px)]">
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {list.map((c) => {
                const v = optionValue(mode, c)
                const searchValue = `${c.name} ${c.code}`
                return (
                  <CommandItem
                    key={c.code}
                    value={searchValue}
                    keywords={[c.code, c.name, searchValue]}
                    onSelect={() => {
                      onValueChange(v)
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        value === v ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                      <span>{c.name}</span>
                      {mode === "iso" ? (
                        <span className="text-xs text-muted-foreground sm:ml-auto">
                          {c.code}
                        </span>
                      ) : null}
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
