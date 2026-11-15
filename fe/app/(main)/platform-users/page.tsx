"use client"

import { handleApiErrorResponse, isServerActionAuthRedirect } from "@/lib/utils/api-error-handler"
import { createClientLogger } from "@/lib/utils/logger-client"
import { ColumnDef } from "@tanstack/react-table"
import {
  Building2,
  CheckCircle,
  Filter,
  Mail,
  MoreHorizontal,
  Pencil,
  Shield,
  Trash2,
  User,
  X,
  XCircle,
} from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { AdvancedFilterDialog } from "@/components/filters/advanced-filter-dialog"
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTableServerSide } from "@/components/ui/data-table-server-side"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { ChangePasswordDialog } from "@/components/users/change-password-dialog"
import { UnifiedEmailDialog } from "@/components/users/unified-email-dialog"
import { USER_FILTER_FIELDS } from "@/components/users/user-filter-fields"
import { listOrganizationsDropdown } from "@/lib/actions/organizations/organizations-platform-actions"
import { deleteUser, listUsers } from "@/lib/actions/users/users-platform-actions"
import {
  countActiveConditions,
  FilterField,
  FilterState,
} from "@/lib/types/filter-schema"
import { UserTableRow, isOAuthOnlyAccount } from "@/lib/types/user-schema"
import { formatDate } from "@/lib/utils/date-time-helper"
import { filterStateToText } from "@/lib/utils/filter-text-helper"

const logger = createClientLogger("UsersPlatformPage")

const AVAILABLE_ROLES = [
  { key: "super_admin", label: "Super Admin", color: "destructive" as const },
  { key: "org_owner", label: "Org Owner", color: "default" as const },
  { key: "org_admin", label: "Org Admin", color: "default" as const },
  { key: "user", label: "User", color: "outline" as const },
]

const EMPTY_FILTER_STATE: FilterState = { groups: [], groupLogic: "AND" }

export default function UsersPlatformPage() {
  const searchParams = useSearchParams()
  const organizationFilterId = searchParams.get("organizationId")

  const [users, setUsers] = useState<UserTableRow[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [search, setSearch] = useState("")
  const [sortBy, setSortBy] = useState("firstName")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc")
  const [total, setTotal] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<UserTableRow | null>(null)
  const [passwordTarget, setPasswordTarget] = useState<UserTableRow | null>(null)
  const [emailTarget, setEmailTarget] = useState<UserTableRow | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [filterState, setFilterState] = useState<FilterState>(EMPTY_FILTER_STATE)
  const [showFilterDialog, setShowFilterDialog] = useState(false)
  const [filterFields, setFilterFields] = useState<FilterField[]>(USER_FILTER_FIELDS)

  const activeFilterCount = countActiveConditions(filterState)
  const hasActiveFilters = activeFilterCount > 0

  useEffect(() => {
    const orgId = searchParams.get("organizationId")
    if (!orgId) return
    setFilterState({
      groups: [
        {
          id: `org-filter-group-${orgId}`,
          conditions: [
            {
              id: `org-filter-${orgId}`,
              field: "organizationId",
              operator: "equals",
              value: orgId,
            },
          ],
          logic: "AND",
        },
      ],
      groupLogic: "AND",
    })
  }, [searchParams])

  useEffect(() => {
    const loadOrganizations = async () => {
      try {
        const response = await listOrganizationsDropdown()
        if (response.status !== "success" || !response.data) return
        const organizationOptions = response.data.map((org) => ({
          label: org.name,
          value: org.id,
        }))
        setFilterFields((fields) =>
          fields.map((field) =>
            field.id === "organizationId"
              ? { ...field, options: organizationOptions }
              : field
          )
        )
      } catch (error) {
        logger.error("Failed to fetch organizations for filter", error as Error)
      }
    }
    void loadOrganizations()
  }, [])

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const response = await listUsers({
        page,
        pageSize,
        search,
        organizationId: organizationFilterId || undefined,
        sortBy,
        sortOrder,
        filters: filterState.groups.length > 0 ? filterState : undefined,
      })
      if (response.status === "error") {
        if (isServerActionAuthRedirect(response)) return
        handleApiErrorResponse(response)
        return
      }
      const rows = (response.data || []) as UserTableRow[]
      setUsers(rows)
      setTotal(response.pagination?.totalItems ?? rows.length)
    } catch (error) {
      logger.error("Failed to load users", error as Error)
      toast.error("Failed to load users")
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, search, organizationFilterId, sortBy, sortOrder, filterState])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  const handleApplyFilters = (filters: FilterState) => {
    setFilterState(filters)
    setPage(1)
  }

  const handleClearFilters = () => {
    setFilterState(EMPTY_FILTER_STATE)
    setPage(1)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      const response = await deleteUser(deleteTarget.id)
      if (response.status === "error") {
        handleApiErrorResponse(response)
        return
      }
      toast.success("User deleted")
      setDeleteTarget(null)
      void loadUsers()
    } catch (error) {
      logger.error("Failed to delete user", error as Error)
      toast.error("Failed to delete user")
    } finally {
      setIsDeleting(false)
    }
  }

  const columns: ColumnDef<UserTableRow>[] = [
    {
      accessorKey: "email",
      header: "User",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">
            {row.original.firstName} {row.original.lastName}
          </div>
          <div className="text-sm text-muted-foreground flex items-center gap-1">
            <Mail className="h-3 w-3" />
            {row.original.email}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "organizationName",
      header: "Organization",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <span>{row.original.organizationName || "No Organization"}</span>
        </div>
      ),
    },
    {
      accessorKey: "roles",
      header: "Roles",
      cell: ({ row }) => {
        const roles = row.original.roles ?? []
        if (roles.length === 0) {
          return <span className="text-muted-foreground">No roles assigned</span>
        }

        const firstRole = roles[0]
        const remainingRoles = roles.slice(1)
        const firstRoleInfo = AVAILABLE_ROLES.find((role) => role.key === firstRole)

        if (remainingRoles.length === 0) {
          return (
            <Badge variant={firstRoleInfo?.color || "secondary"}>
              <Shield className="h-3 w-3 mr-1" />
              {firstRoleInfo?.label || firstRole}
            </Badge>
          )
        }

        return (
          <HoverCard>
            <HoverCardTrigger asChild>
              <div className="flex items-center gap-1 cursor-pointer">
                <Badge variant={firstRoleInfo?.color || "secondary"}>
                  <Shield className="h-3 w-3 mr-1" />
                  {firstRoleInfo?.label || firstRole}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  +{remainingRoles.length}
                </Badge>
              </div>
            </HoverCardTrigger>
            <HoverCardContent className="w-auto">
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">All Roles</h4>
                <div className="flex flex-wrap gap-1">
                  {roles.map((role) => {
                    const roleInfo = AVAILABLE_ROLES.find((item) => item.key === role)
                    return (
                      <Badge key={role} variant={roleInfo?.color || "secondary"}>
                        <Shield className="h-3 w-3 mr-1" />
                        {roleInfo?.label || role}
                      </Badge>
                    )
                  })}
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
        )
      },
    },
    {
      accessorKey: "locked",
      header: "Status",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {!row.original.locked ? (
            <>
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span>Active</span>
            </>
          ) : (
            <>
              <XCircle className="h-4 w-4 text-red-600" />
              <span>Locked</span>
            </>
          )}
        </div>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const user = row.original
        const oauthOnly = isOAuthOnlyAccount(user)
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href={`/platform-users/edit/${user.id}`}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit user
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={oauthOnly}
                title={
                  oauthOnly
                    ? "This user signs in with a linked provider. Password cannot be changed."
                    : undefined
                }
                onClick={() => {
                  if (oauthOnly) return
                  setPasswordTarget(user)
                }}
              >
                <Shield className="mr-2 h-4 w-4" />
                Change Password
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEmailTarget(user)}>
                <Mail className="mr-2 h-4 w-4" />
                Send Email
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setDeleteTarget(user)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete user
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Users</h2>
          {organizationFilterId && (
            <p className="text-sm text-muted-foreground mt-1">Filtered by organization</p>
          )}
          {hasActiveFilters && !organizationFilterId && (
            <p className="text-sm text-muted-foreground mt-1">
              {activeFilterCount} filter{activeFilterCount !== 1 ? "s" : ""} applied
            </p>
          )}
        </div>
        <Button asChild>
          <Link href="/platform-users/create">
            <User className="mr-2 h-4 w-4" />
            Create User
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
          <CardDescription>Manage users across all organizations</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTableServerSide
            columns={columns}
            data={users}
            searchKey="email"
            searchPlaceholder="Search by name or email..."
            isLoading={loading}
            currentPage={page}
            pageSize={pageSize}
            totalItems={total}
            sortColumn={sortBy}
            sortDirection={sortOrder}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(1)
            }}
            onSearchChange={(value) => {
              setSearch(value)
              setPage(1)
            }}
            onFilterChange={() => {}}
            onSortChange={(columnId, direction) => {
              if (direction) {
                setSortBy(columnId)
                setSortOrder(direction)
              }
            }}
            filterSummary={
              hasActiveFilters ? filterStateToText(filterState, filterFields) : undefined
            }
            toolbarActions={
              <>
                <Button
                  variant={hasActiveFilters ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowFilterDialog(true)}
                >
                  <Filter className="h-4 w-4 mr-2" />
                  Filters
                  {hasActiveFilters && (
                    <Badge variant="secondary" className="ml-2">
                      {activeFilterCount}
                    </Badge>
                  )}
                </Button>
                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearFilters}
                    title="Clear all filters"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </>
            }
          />
        </CardContent>
      </Card>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete{" "}
              {deleteTarget?.email} and remove them from their organization.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ChangePasswordDialog
        open={Boolean(passwordTarget)}
        onClose={() => setPasswordTarget(null)}
        userId={passwordTarget?.id || ""}
        userName={
          passwordTarget
            ? `${passwordTarget.firstName} ${passwordTarget.lastName}`.trim()
            : ""
        }
        isCurrentUser={false}
        requireCurrentPassword={false}
      />

      <UnifiedEmailDialog
        open={Boolean(emailTarget)}
        onClose={() => setEmailTarget(null)}
        toEmail={emailTarget?.email || ""}
        userId={emailTarget?.id}
        users={users}
      />

      <AdvancedFilterDialog
        open={showFilterDialog}
        onClose={() => setShowFilterDialog(false)}
        onApply={handleApplyFilters}
        currentFilters={filterState}
        fields={filterFields}
        pageType="users"
      />
    </div>
  )
}
