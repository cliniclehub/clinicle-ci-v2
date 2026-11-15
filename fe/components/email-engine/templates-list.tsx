"use client"

import { EmailPreviewDialog } from "@/components/email-engine/email-preview-dialog"
import { TiptapRichTextEditor } from "@/components/rich-text-editor/tiptap-rich-text-editor"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FormFooter } from "@/components/ui/form-footer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { createEmailTemplate, deleteEmailTemplate, getEmailTemplates, restoreEmailTemplateToDefault, updateEmailTemplate } from "@/lib/actions/email-templates/email-template-actions"
import type { EmailTemplateCreate, EmailTemplateResponse } from "@/lib/types/email-template-schema"
import { handleApiErrorResponse } from "@/lib/utils/api-error-handler"
import { createClientLogger } from "@/lib/utils/logger-client"
import { ChevronRight, Eye, Loader2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

type TemplateCategory = "system" | "general"

interface TemplateFormState {
  name: string
  templateKey: string
  subject: string
  category: TemplateCategory
  bodyHtml: string
  isActive: boolean
}

const EMPTY_FORM: TemplateFormState = {
  name: "",
  templateKey: "",
  subject: "",
  category: "general",
  bodyHtml: "",
  isActive: true,
}

const logger = createClientLogger("TemplatesList")

function toFormState(template: EmailTemplateResponse): TemplateFormState {
  return {
    name: template.name,
    templateKey: template.templateKey,
    subject: template.subject,
    category: template.category === "system" ? "system" : "general",
    bodyHtml: template.bodyHtml || "",
    isActive: template.isActive,
  }
}

function TemplateVariablesPanel({ category }: { category?: string }) {
  const categoryLabel = category?.replace("-", " ") || "this template"

  return (
    <div className="flex-shrink-0 border-t bg-muted/30 px-6 py-2">
      <Collapsible defaultOpen={false} className="group">
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
            Available template variables for {categoryLabel}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 rounded bg-muted/50 p-3 text-xs text-muted-foreground">
            <div className="mb-3">
              <p className="mb-1 text-sm font-medium">User & Organization Variables:</p>
              <div className="flex flex-wrap gap-1">
                <span className="rounded border bg-background px-2 py-1 font-mono text-xs">{"{{firstName}}"}</span>
                <span className="rounded border bg-background px-2 py-1 font-mono text-xs">{"{{lastName}}"}</span>
                <span className="rounded border bg-background px-2 py-1 font-mono text-xs">{"{{email}}"}</span>
                <span className="rounded border bg-background px-2 py-1 font-mono text-xs">{"{{fullName}}"}</span>
                <span className="rounded border bg-background px-2 py-1 font-mono text-xs">{"{{organizationName}}"}</span>
                <span className="rounded border bg-background px-2 py-1 font-mono text-xs">{"{{organizationUrl}}"}</span>
                <span className="rounded border bg-background px-2 py-1 font-mono text-xs">{"{{organizationEmail}}"}</span>
                <span className="rounded border bg-background px-2 py-1 font-mono text-xs">{"{{replyToEmail}}"}</span>
                <span className="rounded border bg-background px-2 py-1 font-mono text-xs">{"{{loginUrl}}"}</span>
              </div>
            </div>
            <div className="mb-3">
              <p className="mb-1 text-sm font-medium">Email Verification Variables:</p>
              <div className="flex flex-wrap gap-1">
                <span className="rounded border bg-background px-2 py-1 font-mono text-xs">{"{{emailVerificationCode}}"}</span>
                <span className="rounded border bg-background px-2 py-1 font-mono text-xs">{"{{emailVerificationUrl}}"}</span>
              </div>
            </div>
            <div className="mb-3">
              <p className="mb-1 text-sm font-medium">Password Reset Variables:</p>
              <div className="flex flex-wrap gap-1">
                <span className="rounded border bg-background px-2 py-1 font-mono text-xs">{"{{passwordResetCode}}"}</span>
                <span className="rounded border bg-background px-2 py-1 font-mono text-xs">{"{{passwordResetUrl}}"}</span>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Variables are automatically populated based on the email recipient and context.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

export function TemplatesList() {
  const [templates, setTemplates] = useState<EmailTemplateResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<EmailTemplateResponse | null>(null)
  const [form, setForm] = useState<TemplateFormState>(EMPTY_FORM)
  const [initialForm, setInitialForm] = useState<TemplateFormState>(EMPTY_FORM)
  const [preview, setPreview] = useState<EmailTemplateResponse | null>(null)
  const [deleting, setDeleting] = useState<EmailTemplateResponse | null>(null)
  const [restoring, setRestoring] = useState<EmailTemplateResponse | null>(null)

  const isDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initialForm),
    [form, initialForm]
  )

  const loadTemplates = useCallback(async () => {
    const methodLogger = logger.forMethod("loadTemplates")
    setLoading(true)
    try {
      const response = await getEmailTemplates(0, 200)
      if (handleApiErrorResponse(response, "Failed to load email templates")) return
      if (response.status === "success") {
        setTemplates(response.data?.templates || [])
      }
    } catch (error) {
      methodLogger.error("Failed to load email templates", error as Error)
      toast.error("Failed to load email templates")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setInitialForm(EMPTY_FORM)
    setFormOpen(true)
  }

  function openEdit(template: EmailTemplateResponse) {
    const next = toFormState(template)
    setEditing(template)
    setForm(next)
    setInitialForm(next)
    setFormOpen(true)
  }

  function handleCancel() {
    setFormOpen(false)
  }

  async function saveTemplate() {
    if (!form.name.trim() || !form.templateKey.trim() || !form.subject.trim() || !form.bodyHtml.trim()) {
      toast.error("Name, key, subject, and email body are required")
      return
    }
    if (!/^[a-z0-9_-]+$/.test(form.templateKey)) {
      toast.error("Template key may contain lowercase letters, numbers, hyphens, and underscores")
      return
    }

    const payload: EmailTemplateCreate = {
      name: form.name.trim(),
      templateKey: form.templateKey.trim(),
      subject: form.subject.trim(),
      category: form.category,
      bodyHtml: form.bodyHtml,
      isActive: form.isActive,
    }
    setSaving(true)
    try {
      const response = editing
        ? await updateEmailTemplate(editing.id, payload)
        : await createEmailTemplate(payload)
      if (handleApiErrorResponse(response, `Failed to ${editing ? "update" : "create"} template`)) {
        return
      }
      toast.success(`Template ${editing ? "updated" : "created"}`)
      setFormOpen(false)
      await loadTemplates()
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    const response = await deleteEmailTemplate(deleting.id)
    if (!handleApiErrorResponse(response, "Failed to delete template")) {
      toast.success("Template deleted")
      setDeleting(null)
      await loadTemplates()
    }
  }

  async function confirmRestore() {
    if (!restoring) return
    const response = await restoreEmailTemplateToDefault(restoring.id)
    if (!handleApiErrorResponse(response, "Failed to restore template")) {
      toast.success("Template restored to its bundled default")
      setRestoring(null)
      await loadTemplates()
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading templates
      </div>
    )
  }

  const isSystemDefault = Boolean(editing?.isSystemDefault)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Account and organization templates support variables such as <code>{"{{firstName}}"}</code>,{" "}
          <code>{"{{organizationName}}"}</code>, and <code>{"{{loginUrl}}"}</code>.
        </p>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> New template
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {templates.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                No templates are configured.
              </TableCell>
            </TableRow>
          ) : (
            templates.map((template) => (
              <TableRow key={template.id}>
                <TableCell>
                  <div className="font-medium">{template.name}</div>
                  <div className="max-w-md truncate text-xs text-muted-foreground">{template.subject}</div>
                </TableCell>
                <TableCell>
                  <code className="text-xs">{template.templateKey}</code>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{template.category || "general"}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={template.isActive ? "default" : "secondary"}>
                    {template.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Preview ${template.name}`}
                      onClick={() => setPreview(template)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${template.name}`}
                      onClick={() => openEdit(template)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {template.isSystemDefault ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Restore ${template.name}`}
                        onClick={() => setRestoring(template)}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${template.name}`}
                        onClick={() => setDeleting(template)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden p-0">
          <DialogHeader className="flex-shrink-0 px-6 pb-4 pt-6">
            <DialogTitle>{editing ? "Edit Email Template" : "Create Email Template"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the email template details."
                : "Create a new email template for your organization."}
            </DialogDescription>
            {isSystemDefault && (
              <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/40">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-blue-500" />
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                    System Default Template - You can only edit the HTML content. Other fields are locked
                    to maintain system functionality.
                  </p>
                </div>
              </div>
            )}
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto scroll-pt-4 px-6 pb-6">
            <div className="space-y-4 pb-16">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="template-name">Template Name</Label>
                  <Input
                    id="template-name"
                    placeholder="Welcome Email"
                    value={form.name}
                    disabled={Boolean(editing)}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="template-key">Template Key</Label>
                  <Input
                    id="template-key"
                    placeholder="welcome-email"
                    value={form.templateKey}
                    disabled={Boolean(editing)}
                    onChange={(event) => setForm({ ...form, templateKey: event.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    {isSystemDefault
                      ? "System template key (locked)"
                      : editing
                        ? "Template key (locked while editing)"
                        : "Lowercase letters, numbers, hyphens, and underscores"}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select
                    value={form.category}
                    disabled={Boolean(editing)}
                    onValueChange={(category: TemplateCategory) => setForm({ ...form, category })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">System</SelectItem>
                      <SelectItem value="general">General</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <div className="flex h-10 items-center space-x-2">
                    <Switch
                      checked={form.isActive}
                      disabled={isSystemDefault}
                      onCheckedChange={(isActive) => setForm({ ...form, isActive })}
                    />
                    <Label>{form.isActive ? "Active" : "Inactive"}</Label>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="template-subject">Subject Line</Label>
                <Input
                  id="template-subject"
                  placeholder="Welcome to our platform!"
                  value={form.subject}
                  disabled={isSystemDefault}
                  onChange={(event) => setForm({ ...form, subject: event.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Email Body</Label>
                <div className="min-h-0 rounded-md border">
                  <TiptapRichTextEditor
                    key={editing?.id ?? "new-template"}
                    initialContent={form.bodyHtml || ""}
                    onChange={(bodyHtml) => setForm((prev) => ({ ...prev, bodyHtml }))}
                    placeholder="Start writing your email content..."
                    minHeight="320px"
                    maxHeight="520px"
                  />
                </div>
              </div>
            </div>
          </div>

          <TemplateVariablesPanel category={form.category} />

          {editing && isSystemDefault && (
            <div className="flex-shrink-0 border-t bg-muted/30 px-6 py-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setFormOpen(false)
                  setRestoring(editing)
                }}
                disabled={saving}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Restore to Default
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Reset this template to the system default template. Your email body content will be replaced.
              </p>
            </div>
          )}

          <FormFooter
            onSave={() => void saveTemplate()}
            onCancel={handleCancel}
            isSaving={saving}
            isDirty={isDirty}
            saveLabel={editing ? "Update Template" : "Create Template"}
            sticky={false}
            className="flex-shrink-0"
          />
        </DialogContent>
      </Dialog>

      <EmailPreviewDialog
        open={Boolean(preview)}
        onOpenChange={(open) => !open && setPreview(null)}
        emailData={
          preview
            ? {
                id: preview.id,
                subject: preview.subject,
                bodyHtml: preview.bodyHtml,
                bodyText: preview.bodyText,
                fromName: preview.fromName || "Organization",
                fromEmail: preview.fromEmail || "notifications@example.com",
                replyTo: preview.replyTo,
                status: preview.isActive ? "active" : "inactive",
                createdAt: preview.createdAt,
                updatedAt: preview.updatedAt,
                templateKey: preview.templateKey,
              }
            : null
        }
      />

      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>This permanently deletes “{deleting?.name}”.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(restoring)} onOpenChange={(open) => !open && setRestoring(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore bundled template?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces the current content of “{restoring?.name}” with the bundled default.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmRestore()}>Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
