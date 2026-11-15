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
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRIES,
  type PhoneCountry,
} from "@/lib/constants/phone-countries"
import { normalizeNationalPhoneDigits } from "@/lib/utils/phone-validation"
import { cn } from "@/lib/utils/cn"
import { Check, ChevronsUpDown } from "lucide-react"
import { type CountryCode } from "libphonenumber-js"
import { useMemo, useRef, useState } from "react"

export interface PhoneInputProps {
  /** Selected country (ISO 3166-1 alpha-2). Independent from the number field. */
  country: CountryCode
  onCountryChange: (country: CountryCode) => void
  /** National number digits only — no country code. */
  nationalNumber: string
  onNationalNumberChange: (nationalNumber: string) => void
  disabled?: boolean
  id?: string
  inputId?: string
  placeholder?: string
  className?: string
  "aria-label"?: string
}

export function PhoneInput({
  country,
  onCountryChange,
  nationalNumber,
  onNationalNumberChange,
  disabled,
  id,
  inputId,
  placeholder = "Phone number",
  className,
  "aria-label": ariaLabel,
}: PhoneInputProps) {
  const [open, setOpen] = useState(false)
  const [filterInstance, setFilterInstance] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const selectedCountry = useMemo(
    () => PHONE_COUNTRIES.find((c) => c.iso === country),
    [country]
  )

  const handleCountrySelect = (selected: PhoneCountry) => {
    onCountryChange(selected.iso)
    setOpen(false)
  }

  const handleNationalChange = (raw: string) => {
    onNationalNumberChange(normalizeNationalPhoneDigits(raw, country))
  }

  return (
    <div className={cn("flex gap-2", className)}>
      <Popover
        modal={false}
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) setFilterInstance((k) => k + 1)
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outlineNeutral"
            role="combobox"
            aria-expanded={open}
            aria-label="Country code"
            disabled={disabled}
            className="w-[7.5rem] shrink-0 justify-between px-2 font-normal"
          >
            <span className="flex items-center gap-1.5 truncate">
              <span className="text-base leading-none" aria-hidden>
                {selectedCountry?.flag ?? "🌐"}
              </span>
              <span className="text-sm tabular-nums">
                +{selectedCountry?.callingCode ?? ""}
              </span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[min(100vw-2rem,320px)] p-0"
          align="start"
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            requestAnimationFrame(() => searchInputRef.current?.focus())
          }}
        >
          <Command key={filterInstance} label="Country codes" loop shouldFilter>
            <CommandInput
              ref={searchInputRef}
              placeholder="Search country…"
              aria-label="Search country"
            />
            <CommandList className="max-h-[min(50vh,280px)]">
              <CommandEmpty>No country found.</CommandEmpty>
              <CommandGroup>
                {PHONE_COUNTRIES.map((phoneCountry) => (
                  <CommandItem
                    key={phoneCountry.iso}
                    value={`${phoneCountry.name} ${phoneCountry.iso} +${phoneCountry.callingCode}`}
                    keywords={[
                      phoneCountry.iso,
                      phoneCountry.name,
                      phoneCountry.callingCode,
                      `+${phoneCountry.callingCode}`,
                    ]}
                    onSelect={() => handleCountrySelect(phoneCountry)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        country === phoneCountry.iso ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="mr-2 text-base leading-none" aria-hidden>
                      {phoneCountry.flag}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                      <span className="truncate">{phoneCountry.name}</span>
                      <span className="text-xs text-muted-foreground sm:ml-auto tabular-nums">
                        +{phoneCountry.callingCode}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Input
        id={inputId}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        placeholder={placeholder}
        value={nationalNumber}
        onChange={(e) => handleNationalChange(e.target.value)}
        disabled={disabled}
        aria-label={ariaLabel ?? "Phone number"}
        aria-describedby={inputId ? `${inputId}-hint` : undefined}
        className="flex-1 text-base"
      />
    </div>
  )
}

export { DEFAULT_PHONE_COUNTRY }
