"use client"
import { ColumnDef } from "@tanstack/react-table"
import { Building2, CheckCircle, MoreHorizontal, Pencil, Trash2, UserPlus, Users, XCircle } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { toast } from "sonner"

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
import { DataTableAdvanced } from "@/components/ui/data-table-advanced"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { CreateOrgAdminDialog } from "@/components/organization/create-org-admin-dialog"
import { deleteOrganization, listOrganizations } from "@/lib/actions/organizations/organizations-platform-actions"
import { Organization } from "@/lib/types/organization-schema"
import { formatDate } from "@/lib/utils/date-time-helper"
import { handleApiErrorResponse, isServerActionAuthRedirect } from "@/lib/utils/api-error-handler"

export default function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)
  const [createOrgAdminDialogOpen, setCreateOrgAdminDialogOpen] = useState(false)
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null)

  useEffect(() => {
    fetchOrganizations()
  }, [])

  const fetchOrganizations = async () => {
    try {
      setLoading(true)
      const response = await listOrganizations({
        page: 1,
        pageSize: 100,
        sortBy: "createdAt",
        sortOrder: "desc",
      })

      if (response.status === "error") {
        if (handleApiErrorResponse(response, "Failed to fetch organizations")) {
          return
        }
        toast.error(response.message || "Failed to fetch organizations")
        return
      }

      if (response.data) {
        setOrganizations(response.data)
        setTotal(response.pagination?.totalItems || 0)
      }
    } catch (error) {
      if (isServerActionAuthRedirect(error)) {
        return
      }
      toast.error("An error occurred while fetching organizations")
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedOrgId) return

    try {
      const response = await deleteOrganization(selectedOrgId)

      if (response.status === "error") {
        if (handleApiErrorResponse(response, "Failed to delete organization")) {
          return
        }
        toast.error(response.message || "Failed to delete organization")
        return
      }

      toast.success("Organization deleted successfully")
      fetchOrganizations()
    } catch (error) {
      if (isServerActionAuthRedirect(error)) {
        return
      }
      toast.error("An error occurred while deleting the organization")
    } finally {
      setDeleteDialogOpen(false)
      setSelectedOrgId(null)
    }
  }

  const columns: ColumnDef<Organization>[] = [
    {
      accessorKey: "name",
      header: "Organization",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="font-medium">{row.original.name}</div>
            <div className="text-sm text-muted-foreground">{row.original.domain}</div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.code}</Badge>
      ),
    },
    {
      accessorKey: "orgType",
      header: "Type",
      cell: ({ row }) => row.original.orgType,
    },
    {
      accessorKey: "isActive",
      header: "Status",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {row.original.isActive ? (
            <CheckCircle className="h-4 w-4 text-green-600" />
          ) : (
            <XCircle className="h-4 w-4 text-red-600" />
          )}
          <span>{row.original.isActive ? "Active" : "Inactive"}</span>
        </div>
      ),
    },
    {
      accessorKey: "userCount",
      header: "Users",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span>{row.original.userCount || 0}</span>
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
      cell: ({ row }) => {
        const org = row.original

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
                <Link href={`/platform-organizations/edit/${org.id}`}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit organization
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/platform-users?organizationId=${org.id}`}>
                  <Users className="mr-2 h-4 w-4" />
                  View users
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setSelectedOrg(org)
                  setCreateOrgAdminDialogOpen(true)
                }}
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Create org owner
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => {
                  setSelectedOrgId(org.id)
                  setDeleteDialogOpen(true)
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete organization
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  return (
    <>
      <div className="flex-1 space-y-4 p-8 pt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-3xl font-bold tracking-tight">Organizations</h2>
          <Button asChild>
            <Link href="/platform-organizations/create">Create Organization</Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Organizations</CardTitle>
            <CardDescription>
              Manage organizations across the platform
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTableAdvanced
              columns={columns}
              data={organizations}
              searchKey="name"
              searchPlaceholder="Search organizations..."
              pageSize={20}
              pageSizeOptions={[10, 20, 30, 50]}
            />
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              organization and all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {selectedOrg && (
        <CreateOrgAdminDialog
          open={createOrgAdminDialogOpen}
          onClose={() => {
            setCreateOrgAdminDialogOpen(false)
            setSelectedOrg(null)
          }}
          organizationId={selectedOrg.id}
          organizationName={selectedOrg.name}
          onSuccess={() => {
            // Optionally refresh organizations list or show success message
            fetchOrganizations()
          }}
        />
      )}
    </>
  )
}
