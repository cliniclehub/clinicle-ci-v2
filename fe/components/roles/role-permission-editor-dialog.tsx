"use client"

import { AlertTriangle, Search } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils/cn"

export type RoleEditorMode = "create" | "edit" | "view"

export type RoleEditorDraft = {
  id?: number
  key?: string
  label: string
  permissionKeys: string[]
}

export type PermissionCatalogItem = {
  key: string
  label: string
  description?: string | null
  domain: string
  resource: string
  action: string
  riskLevel: "normal" | "elevated" | "high"
}

type RolePermissionEditorDialogProps = {
  open: boolean
  mode: RoleEditorMode
  draft: RoleEditorDraft
  catalog: PermissionCatalogItem[]
  saving: boolean
  onOpenChange: (open: boolean) => void
  onDraftChange: (draft: RoleEditorDraft) => void
  onSave: () => void
}

function titleize(value: string) {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ")
}

function riskBadgeVariant(riskLevel: string) {
  if (riskLevel === "high") return "destructive"
  if (riskLevel === "elevated") return "secondary"
  return "outline"
}

function permissionMatches(
  permission: PermissionCatalogItem,
  query: string,
  domain: string,
  risk: string,
  assignedOnly: boolean,
  assignedKeys: string[]
) {
  if (assignedOnly && !assignedKeys.includes(permission.key)) return false
  if (domain !== "all" && permission.domain !== domain) return false
  if (risk !== "all" && permission.riskLevel !== risk) return false
  if (!query) return true

  const haystack = [
    permission.label,
    permission.key,
    permission.domain,
    permission.resource,
    permission.action,
    permission.description ?? "",
  ]
    .join(" ")
    .toLowerCase()
  return haystack.includes(query)
}

export function RolePermissionEditorDialog({
  open,
  mode,
  draft,
  catalog,
  saving,
  onOpenChange,
  onDraftChange,
  onSave,
}: RolePermissionEditorDialogProps) {
  const readOnly = mode === "view"
  const [permissionQuery, setPermissionQuery] = useState("")
  const [domainFilter, setDomainFilter] = useState("all")
  const [riskFilter, setRiskFilter] = useState("all")
  const [assignedOnly, setAssignedOnly] = useState(mode === "view")

  useEffect(() => {
    if (open) {
      setAssignedOnly(mode === "view")
      setPermissionQuery("")
      setDomainFilter("all")
      setRiskFilter("all")
    }
  }, [mode, open])

  const domains = useMemo(() => {
    return Array.from(new Set(catalog.map((permission) => permission.domain))).sort()
  }, [catalog])

  const filteredPermissions = useMemo(() => {
    const query = permissionQuery.trim().toLowerCase()
    return catalog
      .filter((permission) =>
        permissionMatches(
          permission,
          query,
          domainFilter,
          riskFilter,
          assignedOnly,
          draft.permissionKeys
        )
      )
      .sort((left, right) => {
        const domainCompare = left.domain.localeCompare(right.domain)
        if (domainCompare !== 0) return domainCompare
        return left.label.localeCompare(right.label)
      })
  }, [assignedOnly, catalog, domainFilter, draft.permissionKeys, permissionQuery, riskFilter])

  const visibleKeys = filteredPermissions.map((permission) => permission.key)
  const allVisibleSelected =
    visibleKeys.length > 0 && visibleKeys.every((key) => draft.permissionKeys.includes(key))
  const someVisibleSelected = visibleKeys.some((key) => draft.permissionKeys.includes(key))

  const resetFilters = (nextOpen: boolean) => {
    if (!nextOpen) {
      setPermissionQuery("")
      setDomainFilter("all")
      setRiskFilter("all")
    }
    onOpenChange(nextOpen)
  }

  const togglePermission = (permissionKey: string, checked: boolean) => {
    if (readOnly) return
    const permissionKeys = checked
      ? Array.from(new Set([...draft.permissionKeys, permissionKey]))
      : draft.permissionKeys.filter((key) => key !== permissionKey)
    onDraftChange({ ...draft, permissionKeys })
  }

  const toggleVisiblePermissions = (checked: boolean) => {
    if (readOnly) return
    const visible = new Set(visibleKeys)
    const permissionKeys = checked
      ? Array.from(new Set([...draft.permissionKeys, ...visibleKeys]))
      : draft.permissionKeys.filter((key) => !visible.has(key))
    onDraftChange({ ...draft, permissionKeys })
  }

  const title =
    mode === "create" ? "Create custom role" : mode === "edit" ? "Edit custom role" : "Role permissions"

  return (
    <Dialog open={open} onOpenChange={resetFilters}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b px-6 py-5">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {readOnly
              ? "System roles are locked. Search the catalog to inspect assigned permissions."
              : "Set the role label, then assign organization permissions from the catalog."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="role-label">Role label</Label>
              <Input
                id="role-label"
                value={draft.label}
                onChange={(event) => onDraftChange({ ...draft, label: event.target.value })}
                placeholder="e.g. User viewer + Email"
                disabled={readOnly}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-key">Role key</Label>
              <Input
                id="role-key"
                value={draft.key ?? (mode === "create" ? "(auto-generated)" : "")}
                disabled
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-sm font-semibold">Permissions</h3>
                <p className="text-xs text-muted-foreground">
                  {draft.permissionKeys.length} assigned
                  {filteredPermissions.length !== catalog.length
                    ? ` · ${filteredPermissions.length} shown`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={permissionQuery}
                    onChange={(event) => setPermissionQuery(event.target.value)}
                    placeholder="Search permissions..."
                    className="h-9 w-[220px] pl-8"
                  />
                </div>
                <Select value={domainFilter} onValueChange={setDomainFilter}>
                  <SelectTrigger className="h-9 w-[160px]">
                    <SelectValue placeholder="Domain" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All domains</SelectItem>
                    {domains.map((domain) => (
                      <SelectItem key={domain} value={domain}>
                        {titleize(domain)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={riskFilter} onValueChange={setRiskFilter}>
                  <SelectTrigger className="h-9 w-[140px]">
                    <SelectValue placeholder="Risk" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All risk</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="elevated">Elevated</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
                <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm">
                  <Checkbox
                    checked={assignedOnly}
                    onCheckedChange={(value) => setAssignedOnly(value === true)}
                  />
                  Assigned only
                </label>
              </div>
            </div>

            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className="w-12">
                      <Checkbox
                        checked={
                          allVisibleSelected
                            ? true
                            : someVisibleSelected
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={(value) => toggleVisiblePermissions(value === true)}
                        disabled={readOnly || visibleKeys.length === 0}
                        aria-label="Select visible permissions"
                      />
                    </TableHead>
                    <TableHead>Permission</TableHead>
                    <TableHead className="w-[140px]">Domain</TableHead>
                    <TableHead className="w-[140px]">Resource</TableHead>
                    <TableHead className="w-[110px]">Risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPermissions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                        No permissions match the current filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredPermissions.map((permission) => {
                      const checked = draft.permissionKeys.includes(permission.key)
                      return (
                        <TableRow
                          key={permission.key}
                          className={cn(checked && "bg-primary/5")}
                          data-state={checked ? "selected" : undefined}
                        >
                          <TableCell>
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(value) =>
                                togglePermission(permission.key, value === true)
                              }
                              disabled={readOnly}
                              aria-label={permission.label}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{permission.label}</div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {permission.description || permission.key}
                            </p>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {titleize(permission.domain)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {titleize(permission.resource)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={riskBadgeVariant(permission.riskLevel)}
                              className="gap-1 capitalize"
                            >
                              {permission.riskLevel === "high" ? (
                                <AlertTriangle className="h-3 w-3" />
                              ) : null}
                              {permission.riskLevel}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <Button variant="outline" onClick={() => resetFilters(false)} disabled={saving}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {readOnly ? null : (
            <Button onClick={onSave} disabled={saving}>
              {saving ? "Saving..." : "Save role"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
