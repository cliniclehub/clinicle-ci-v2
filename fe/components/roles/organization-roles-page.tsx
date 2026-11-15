"use client"

import {
  AlertTriangle,
  Eye,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import {
  RolePermissionEditorDialog,
  type PermissionCatalogItem,
  type RoleEditorDraft,
  type RoleEditorMode,
} from "@/components/roles/role-permission-editor-dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
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
import {
  createCustomRole,
  deleteCustomRole,
  listManagedRoles,
  listOrgPermissions,
  updateCustomRole,
  type RoleDto,
} from "@/lib/actions/roles/roles-org-actions"
import {
  ORG_PERMISSION_CATALOG,
  toPermissionCatalogItem,
} from "@/lib/types/permission-schema"
import { handleApiErrorResponse } from "@/lib/utils/api-error-handler"
import { formatDateTime } from "@/lib/utils/date-time-helper"

const EMPTY_DRAFT: RoleEditorDraft = {
  label: "",
  permissionKeys: [],
}

type TypeFilter = "all" | "system" | "custom"

function roleMatchesSearch(role: RoleDto, query: string) {
  if (!query) return true
  const haystack = [role.label, role.key, ...(role.permissions || [])].join(" ").toLowerCase()
  return haystack.includes(query)
}

function formatUpdatedAt(value?: string | null) {
  if (!value) return "—"
  return formatDateTime(value)
}

export function OrganizationRolesPage() {
  const [roles, setRoles] = useState<RoleDto[]>([])
  const [catalog, setCatalog] = useState<PermissionCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all")
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<RoleEditorMode>("create")
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [riskDialogOpen, setRiskDialogOpen] = useState(false)
  const [roleToDelete, setRoleToDelete] = useState<RoleDto | null>(null)
  const [draft, setDraft] = useState<RoleEditorDraft>(EMPTY_DRAFT)

  const highRiskPermissions = useMemo(
    () => catalog.filter((permission) => permission.riskLevel === "high"),
    [catalog]
  )
  const selectedHighRiskKeys = draft.permissionKeys.filter((key) =>
    highRiskPermissions.some((permission) => permission.key === key)
  )

  const filteredRoles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return roles.filter((role) => {
      if (!roleMatchesSearch(role, query)) return false
      if (typeFilter === "system" && !role.isSystem) return false
      if (typeFilter === "custom" && role.isSystem) return false
      return true
    })
  }, [roles, searchQuery, typeFilter])

  const loadData = async () => {
    setLoading(true)
    try {
      const [rolesResponse, catalogResponse] = await Promise.all([
        listManagedRoles(),
        listOrgPermissions(),
      ])

      if (handleApiErrorResponse(rolesResponse, "Failed to load roles")) return
      if (handleApiErrorResponse(catalogResponse, "Failed to load permissions")) return

      if (rolesResponse.status === "success") setRoles(rolesResponse.data || [])
      if (catalogResponse.status === "success") {
        const items = (catalogResponse.data || []).map(toPermissionCatalogItem)
        setCatalog(
          items.length
            ? items
            : ORG_PERMISSION_CATALOG.map((item) =>
                toPermissionCatalogItem({ ...item, scope: "org" })
              )
        )
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const openCreateDialog = () => {
    setDraft(EMPTY_DRAFT)
    setEditorMode("create")
    setEditorOpen(true)
  }

  const openViewDialog = (role: RoleDto) => {
    setDraft({
      id: role.id,
      key: role.key,
      label: role.label,
      permissionKeys: role.permissions || [],
    })
    setEditorMode("view")
    setEditorOpen(true)
  }

  const openEditDialog = (role: RoleDto) => {
    if (role.isSystem) {
      openViewDialog(role)
      return
    }
    setDraft({
      id: role.id,
      key: role.key,
      label: role.label,
      permissionKeys: role.permissions || [],
    })
    setEditorMode("edit")
    setEditorOpen(true)
  }

  const confirmDelete = (role: RoleDto) => {
    if (role.isSystem) return
    setRoleToDelete(role)
    setDeleteDialogOpen(true)
  }

  const saveDraft = async (confirmedHighRisk = false) => {
    const label = draft.label.trim()
    if (!label) {
      toast.error("Role label is required")
      return
    }
    if (selectedHighRiskKeys.length > 0 && !confirmedHighRisk) {
      setRiskDialogOpen(true)
      return
    }

    setSaving(true)
    try {
      const response = draft.id
        ? await updateCustomRole(draft.id, {
            label,
            permissions: draft.permissionKeys,
          })
        : await createCustomRole({
            label,
            permissions: draft.permissionKeys,
          })

      if (handleApiErrorResponse(response, "Failed to save role")) return
      toast.success(draft.id ? "Role updated" : "Role created")
      setEditorOpen(false)
      setRiskDialogOpen(false)
      await loadData()
    } finally {
      setSaving(false)
    }
  }

  const deleteSelectedRole = async () => {
    if (!roleToDelete || roleToDelete.isSystem) return
    setSaving(true)
    try {
      const response = await deleteCustomRole(roleToDelete.id)
      if (handleApiErrorResponse(response, "Failed to delete role")) return
      toast.success("Role deleted")
      setDeleteDialogOpen(false)
      setRoleToDelete(null)
      await loadData()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Roles & Permissions</h2>
          <p className="mt-1 max-w-3xl text-muted-foreground">
            Browse organization roles. System roles are fixed; create custom roles from the org
            permission catalog.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void loadData()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            New role
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search roles..."
            className="pl-8"
          />
        </div>
        <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as TypeFilter)}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead>Role</TableHead>
              <TableHead className="w-[180px]">Key</TableHead>
              <TableHead className="w-[110px]">Type</TableHead>
              <TableHead className="w-[130px]">Permissions</TableHead>
              <TableHead className="w-[180px]">Updated</TableHead>
              <TableHead className="w-[70px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  Loading roles...
                </TableCell>
              </TableRow>
            ) : filteredRoles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  {roles.length === 0
                    ? "No roles are available."
                    : "No roles match the current filters."}
                </TableCell>
              </TableRow>
            ) : (
              filteredRoles.map((role) => (
                <ContextMenu key={role.id}>
                  <ContextMenuTrigger asChild>
                    <TableRow className="cursor-default">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{role.label}</span>
                          {role.isSystem ? (
                            <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {role.key}
                      </TableCell>
                      <TableCell>
                        <Badge variant={role.isSystem ? "outline" : "default"}>
                          {role.isSystem ? "System" : "Custom"}
                        </Badge>
                      </TableCell>
                      <TableCell>{(role.permissions || []).length}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatUpdatedAt(role.updatedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Actions for ${role.label}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openViewDialog(role)}>
                              <Eye className="h-4 w-4" />
                              View permissions
                            </DropdownMenuItem>
                            {role.isSystem ? null : (
                              <DropdownMenuItem onClick={() => openEditDialog(role)}>
                                <Pencil className="h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                            )}
                            {role.isSystem ? null : (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => confirmDelete(role)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={() => openViewDialog(role)}>
                      <Eye className="h-4 w-4" />
                      View permissions
                    </ContextMenuItem>
                    {role.isSystem ? null : (
                      <ContextMenuItem onSelect={() => openEditDialog(role)}>
                        <Pencil className="h-4 w-4" />
                        Edit
                      </ContextMenuItem>
                    )}
                    {role.isSystem ? null : (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => confirmDelete(role)}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <RolePermissionEditorDialog
        open={editorOpen}
        mode={editorMode}
        draft={draft}
        catalog={catalog}
        saving={saving}
        onOpenChange={setEditorOpen}
        onDraftChange={setDraft}
        onSave={() => void saveDraft()}
      />

      <AlertDialog open={riskDialogOpen} onOpenChange={setRiskDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              High-risk permissions selected
            </AlertDialogTitle>
            <AlertDialogDescription>
              This role includes high-risk permissions: {selectedHighRiskKeys.join(", ")}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Review</AlertDialogCancel>
            <AlertDialogAction onClick={() => void saveDraft(true)} disabled={saving}>
              Save anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete custom role</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the role. Users who already have it should be reviewed from
              the users screen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteSelectedRole()} disabled={saving}>
              Delete role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
