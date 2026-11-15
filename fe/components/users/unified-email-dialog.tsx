import { TiptapRichTextEditor } from "@/components/rich-text-editor/tiptap-rich-text-editor"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DirtyFormDialog } from "@/components/ui/dirty-form-dialog"
import { FormFooter } from "@/components/ui/form-footer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { sendEmail } from "@/lib/actions/email-engine/email-engine-actions"
import { getEmailTemplates } from "@/lib/actions/email-templates/email-template-actions"
import { getMyOrganization, getPublicOrganizationData } from "@/lib/actions/organizations/organizations-org-actions"
import { useAuth } from "@/lib/contexts/auth-context"
import type { EmailTemplateResponse } from "@/lib/types/email-template-schema"
import { handleApiErrorResponse } from "@/lib/utils/api-error-handler"
import { zodResolver } from "@hookform/resolvers/zod"
import { ChevronRight, FileText, Loader2 } from "lucide-react"
import React, { useEffect, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

// Zod schema for email form validation
const emailFormSchema = z.object({
  templateId: z.string().optional(),
  subject: z.string().min(1, "Subject is required"),
  content: z.string().min(1, "Content is required"),
  sendToMe: z.boolean().default(false),
  useMyEmailAsReplyTo: z.boolean().default(false),
  replyTo: z.string().email("Invalid email address").optional().or(z.literal(""))
})

type EmailFormData = z.infer<typeof emailFormSchema>

export interface UnifiedEmailDialogProps {
  open: boolean
  onClose: () => void
  toEmail: string
  userId?: string
  selectedUserIds?: string[]
  users?: any[]
}

export const UnifiedEmailDialog: React.FC<UnifiedEmailDialogProps> = ({ 
  open, 
  onClose, 
  toEmail, 
  userId,
  selectedUserIds = [],
  users = []
}) => {
  const { user: currentUser } = useAuth()
  
  // Determine if we're dealing with multiple users
  const isMultipleUsers = selectedUserIds.length > 0
  
  // Form setup with React Hook Form
  const form = useForm<EmailFormData>({
    resolver: zodResolver(emailFormSchema),
    defaultValues: {
      templateId: "",
      subject: "",
      content: "",
      sendToMe: false,
      useMyEmailAsReplyTo: false,
      replyTo: ""
    }
  })
  
  const { formState: { isDirty } } = form
  
  // Template state
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplateResponse | null>(null)
  const [templateData, setTemplateData] = useState<Record<string, unknown>>({})
  const [availableTemplates, setAvailableTemplates] = useState<EmailTemplateResponse[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  
  // Organization state for reply-to default
  const [organizationReplyTo, setOrganizationReplyTo] = useState<string>("")
  const [loadingOrgData, setLoadingOrgData] = useState(false)
  
  // Common state
  const [isLoading, setIsLoading] = useState(false)
  const [isSendingTest, setIsSendingTest] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [showDirtyDialog, setShowDirtyDialog] = useState(false)

  // Memoize selectedUsers to prevent infinite re-renders
  const selectedUsers = React.useMemo(() => {
    const filtered = users.filter(user => selectedUserIds.includes(user.id))
    
    
    return filtered
  }, [users, selectedUserIds])

  const loadTemplates = React.useCallback(async () => {
    setTemplatesLoading(true)
    try {
      const response = await getEmailTemplates(0, 100, true, 'general')
      
      if (handleApiErrorResponse(response, "Failed to load templates")) {
        return
      }
      
      if (response.status === "success" && response.data?.templates) {
        setAvailableTemplates(response.data.templates)
      }
    } catch (error) {
      toast.error("Failed to load email templates")
    } finally {
      setTemplatesLoading(false)
    }
  }, [])


  // Load organization data to get default reply-to address
  const loadOrganizationData = React.useCallback(async () => {
    setLoadingOrgData(true)
    try {
      // Try getMyOrganization first (for org_admin) - this includes adminEmail
      let response = await getMyOrganization()
      
      // If that fails (user is not org_admin), try public endpoint
      if (response.status !== "success" || !response.data?.adminEmail) {
        response = await getPublicOrganizationData()
      }
      
      if (response.status === "success" && response.data) {
        const adminEmail = response.data.adminEmail
        if (adminEmail) {
          setOrganizationReplyTo(adminEmail)
          // Set the default reply-to in form when organization data loads
          // Use a small delay to ensure form is ready
          setTimeout(() => {
            form.setValue('replyTo', adminEmail, { shouldDirty: false })
          }, 50)
        }
      }
    } catch (error) {
      // Silently fail - user can still enter reply-to manually
    } finally {
      setLoadingOrgData(false)
    }
  }, [form])

  // Update form when organization reply-to is loaded (only when not using my email)
  useEffect(() => {
    if (organizationReplyTo && open && !form.getValues('useMyEmailAsReplyTo')) {
      const timer = setTimeout(() => {
        const currentValue = form.getValues('replyTo')
        if (!currentValue || currentValue !== organizationReplyTo) {
          form.setValue('replyTo', organizationReplyTo, { shouldDirty: false })
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [organizationReplyTo, open, form])

  // Load templates and organization data when dialog opens
  useEffect(() => {
    if (open) {
      // Reset form first to ensure clean state
      form.reset({
        templateId: "",
        subject: "",
        content: "",
        sendToMe: false,
        useMyEmailAsReplyTo: false,
        replyTo: "" // Will be populated by loadOrganizationData
      })
      loadTemplates()
      loadOrganizationData()
      // Initialize template data as empty - backend will populate user data from email addresses
      setTemplateData({})
    }
  }, [open, toEmail, userId, selectedUserIds.length, loadTemplates, loadOrganizationData, form])

  const handleTemplateChange = (templateId: string) => {
    form.setValue('templateId', templateId, { shouldDirty: true })
    
    const template = availableTemplates.find(t => t.id === templateId)
    setSelectedTemplate(template || null)
    
    if (template) {
      // Load template content into form for user to edit
      // Note: We send templateKey as undefined since user can modify content
      form.setValue('subject', template.subject || "", { shouldDirty: true })
      form.setValue('content', template.bodyHtml || "", { shouldDirty: true })
      
      // Clear template data - backend will populate user data from email addresses
      setTemplateData({})
    }
  }

  const handleSend = async (data: EmailFormData) => {
    // Validate that we have users to send to
    if (isMultipleUsers && selectedUserIds.length === 0) {
      toast.error("No users selected")
      return
    }

    if (!isMultipleUsers && !userId) {
      toast.error("User ID is required to send email")
      return
    }

    setIsSending(true)
    try {
      // Unified approach: Always work with an array of recipient emails
      let targetEmails: string[] = []
      
      if (isMultipleUsers) {
        targetEmails = selectedUsers.map(user => user.email).filter(Boolean)
      } else {
        // Prefer the users list when provided, otherwise use toEmail
        const user = users.find(u => u.id === userId)
        if (user?.email) {
          targetEmails = [user.email]
        } else if (toEmail) {
          targetEmails = [toEmail]
        } else {
          toast.error("User email is required to send email")
          return
        }
      }

      if (targetEmails.length === 0) {
        toast.error("No recipient email found")
        return
      }
      
      
      // Prepare template data - only send email content, backend will look up user data from email addresses
      const finalTemplateData = {
        subject: data.subject,
        bodyHtml: data.content
      }

      // Add current user to recipients if "Send to me" is checked
      let finalTargetEmails = [...targetEmails] // Create a copy to avoid mutating original
      if (data.sendToMe && currentUser?.email) {
        finalTargetEmails.push(currentUser.email)
      }

      const userCount = finalTargetEmails.length
      
      // Use the new sendEmail action for all cases
      
      const response = await sendEmail(
        finalTargetEmails,
        undefined, // templateKey - undefined since user can modify content
        {
          ...finalTemplateData,
          subject: data.subject,
          bodyHtml: data.content
        },
        undefined, // customVariables
        undefined, // fromName
        undefined, // fromEmail
        (data.useMyEmailAsReplyTo ? currentUser?.email : data.replyTo?.trim()) || undefined, // replyTo
        undefined, // ccEmails
        undefined, // bccEmails
        5 // priority
      )

      if (handleApiErrorResponse(response, "Failed to send email")) {
        return
      }

      if (response.status === "success") {
        const message = data.sendToMe && currentUser?.email 
          ? `Email sent to ${userCount} user${userCount !== 1 ? 's' : ''} (including you)`
          : `Email sent to ${userCount} user${userCount !== 1 ? 's' : ''}`
        toast.success(message)
        resetForm()
        onClose()
      }
    } catch (error) {
      toast.error("An error occurred while sending the email")
    } finally {
      setIsSending(false)
    }
  }

  const handleSendTest = async () => {
    const data = form.getValues()
    
    if (!data.subject.trim() || !data.content.trim()) {
      toast.error("Please fill in both subject and content")
      return
    }

    //
    setIsSendingTest(true)
    try {
      // Backend will look up user data from email address
      const response = await sendEmail(
        [currentUser?.email || 'admin@example.com'],
        undefined, // templateKey - undefined since user can modify content
        {
          subject: `[TEST] ${data.subject}`,
          bodyHtml: data.content
        },
        undefined, // customVariables
        undefined, // fromName
        undefined, // fromEmail
        (data.useMyEmailAsReplyTo ? currentUser?.email : data.replyTo?.trim()) || undefined, // replyTo
        undefined, // ccEmails
        undefined, // bccEmails
        5 // priority
      )

      if (handleApiErrorResponse(response, "Failed to send test email")) {
        return
      }

      if (response.status === "success") {
        toast.success("Test email sent to your email address")
      }
    } catch (error) {
      toast.error("An error occurred while sending the test email")
    } finally {
      setIsSendingTest(false)
    }
  }

  const resetForm = React.useCallback(() => {
    form.reset({
      templateId: "",
      subject: "",
      content: "",
      sendToMe: false,
      useMyEmailAsReplyTo: false,
      replyTo: organizationReplyTo || "" // Reset to organization default if available
    })
    setSelectedTemplate(null)
    setIsSendingTest(false)
    setIsSending(false)
    // Clear template data - backend will populate user data from email addresses
    setTemplateData({})
  }, [form, organizationReplyTo])

  const handleCancel = () => {
    if (isDirty) {
      setShowDirtyDialog(true)
    } else {
      handleClose()
    }
  }

  const handleConfirmCancel = () => {
    form.reset()
    setShowDirtyDialog(false)
    handleClose()
  }

  const handleDismissCancel = () => {
    setShowDirtyDialog(false)
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>
            Send Email
          </DialogTitle>
          <DialogDescription>
            {isMultipleUsers 
              ? `Send an email to ${selectedUserIds.length} selected user${selectedUserIds.length !== 1 ? 's' : ''}. Choose a template or write custom content.`
              : `Send an email to ${toEmail}. Choose a template or write custom content.`
            }
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6">
          <div className="space-y-6">
            {/* Template Selection */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Choose Template (Optional)</Label>
           <Select 
              value={form.watch('templateId') || ""} 
              onValueChange={handleTemplateChange}
              disabled={templatesLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={templatesLoading ? "Loading templates..." : "Choose a template"} />
              </SelectTrigger>
              <SelectContent>
                {templatesLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    <span className="text-sm text-muted-foreground">Loading templates...</span>
                  </div>
                ) : (
                  <>
                    {availableTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4" />
                          <div className="flex flex-col">
                            <span className="font-medium">{template.name}</span>
                            <span className="text-xs text-muted-foreground">{template.templateKey}</span>
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                    {availableTemplates.length === 0 && !templatesLoading && (
                      <div className="flex items-center justify-center py-4">
                        <span className="text-sm text-muted-foreground">No general templates available. Create templates in the Email Templates section.</span>
                      </div>
                    )}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>


          {/* Template Variables */}
          {selectedTemplate && selectedTemplate.availableFields && selectedTemplate.availableFields.length > 0 && (
            <div className="space-y-2">
              <Label className="block text-sm font-medium">Template Variables</Label>
              <div className="grid grid-cols-2 gap-2">
                {selectedTemplate.availableFields.map((field) => (
                  <div key={field.field} className="space-y-1">
                    <Label htmlFor={field.field} className="text-xs">
                      {field.field}{field.required ? ' *' : ''}:
                    </Label>
                    <Input
                      id={field.field}
                      value={templateData[field.field] as string || ""}
                      onChange={(e) => setTemplateData(prev => ({
                        ...prev,
                        [field.field]: e.target.value
                      }))}
                      placeholder={field.example || field.description}
                      className="text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recipients Display */}
          {isMultipleUsers ? (
            <div>
              <Label className="block text-sm font-medium mb-1">Recipients ({selectedUserIds.length} users)</Label>
              <div className="bg-muted p-3 rounded-md max-h-32 overflow-y-auto">
                <div className="text-sm text-muted-foreground">
                  {selectedUsers.map(user => (
                    <div key={user.id} className="flex items-center gap-2 mb-1">
                      <span>• {user.firstName} {user.lastName} ({user.email})</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <Label className="block text-sm font-medium mb-1">To</Label>
              <Input value={toEmail} disabled aria-label="To email" />
            </div>
          )}

          {/* Subject */}
          <div>
            <Label className="block text-sm font-medium mb-1">Subject *</Label>
            <Input 
              {...form.register('subject')}
              placeholder="Email subject" 
            />
            {form.formState.errors.subject && (
              <p className="text-sm text-destructive mt-1">{form.formState.errors.subject.message}</p>
            )}
          </div>

          {/* Reply-To */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Reply-To Address</Label>
              <div className="flex items-center gap-2">
                <Label htmlFor="use-my-email-reply" className="text-xs text-muted-foreground cursor-pointer">
                  Use my email
                </Label>
                <Switch
                  id="use-my-email-reply"
                  checked={form.watch('useMyEmailAsReplyTo')}
                  onCheckedChange={(checked) => {
                    form.setValue('useMyEmailAsReplyTo', checked, { shouldDirty: true })
                    if (checked) {
                      form.setValue('replyTo', currentUser?.email || '', { shouldDirty: true })
                    } else {
                      form.setValue('replyTo', organizationReplyTo || '', { shouldDirty: true })
                    }
                  }}
                />
              </div>
            </div>
            <Controller
              name="replyTo"
              control={form.control}
              render={({ field }) => (
                <Input 
                  {...field}
                  type="email"
                  placeholder={organizationReplyTo || "reply-to@example.com"}
                  disabled={form.watch('useMyEmailAsReplyTo')}
                  className={form.watch('useMyEmailAsReplyTo') ? "bg-muted" : ""}
                />
              )}
            />
            {form.formState.errors.replyTo && (
              <p className="text-sm text-destructive mt-1">{form.formState.errors.replyTo.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {form.watch('useMyEmailAsReplyTo')
                ? "Replies will go to your email address."
                : "Defaults to organization reply-to address. You can override it if needed."}
            </p>
          </div>

          {/* Content Editor */}
          <div>
            <Label className="block text-sm font-medium mb-1">Content *</Label>
            <TiptapRichTextEditor 
              initialContent={form.watch('content') || ""} 
              onChange={(content) => form.setValue('content', content, { shouldDirty: true })} 
            />
            {form.formState.errors.content && (
              <p className="text-sm text-destructive mt-1">{form.formState.errors.content.message}</p>
            )}
          </div>

          {/* Available Variables Info - Collapsible */}
          <Collapsible defaultOpen={false} className="group">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-foreground">
                <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                Available template variables for general templates
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="text-xs text-muted-foreground bg-muted rounded p-3 mt-2">
                {/* User Variables */}
                <div className="mb-3">
                  <p className="font-medium text-sm mb-1">User Variables:</p>
                  <div className="flex flex-wrap gap-1">
                    <span className="font-mono bg-background px-2 py-1 rounded border text-xs">{'{{firstName}}'}</span>
                    <span className="font-mono bg-background px-2 py-1 rounded border text-xs">{'{{lastName}}'}</span>
                    <span className="font-mono bg-background px-2 py-1 rounded border text-xs">{'{{email}}'}</span>
                    <span className="font-mono bg-background px-2 py-1 rounded border text-xs">{'{{userId}}'}</span>
                    <span className="font-mono bg-background px-2 py-1 rounded border text-xs">{'{{fullName}}'}</span>
                  </div>
                </div>

                {/* Organization Variables */}
                <div className="mb-3">
                  <p className="font-medium text-sm mb-1">Organization Variables:</p>
                  <div className="flex flex-wrap gap-1">
                    <span className="font-mono bg-background px-2 py-1 rounded border text-xs">{'{{organizationName}}'}</span>
                    <span className="font-mono bg-background px-2 py-1 rounded border text-xs">{'{{organizationDomain}}'}</span>
                    <span className="font-mono bg-background px-2 py-1 rounded border text-xs">{'{{organizationUrl}}'}</span>
                    <span className="font-mono bg-background px-2 py-1 rounded border text-xs">{'{{organizationEmail}}'}</span>
                    <span className="font-mono bg-background px-2 py-1 rounded border text-xs">{'{{replyToEmail}}'}</span>
                    <span className="font-mono bg-background px-2 py-1 rounded border text-xs">{'{{loginUrl}}'}</span>
                  </div>
                  <p className="text-xs mt-1 text-muted-foreground">
                    replyToEmail resolves to the configured organization reply-to address.
                  </p>
                </div>

                <p className="text-xs text-muted-foreground mt-2">
                  Variables are automatically populated based on the email recipient and context.
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Send to Me Option and Test Button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Checkbox 
                checked={form.watch('sendToMe')} 
                onCheckedChange={v => form.setValue('sendToMe', !!v, { shouldDirty: true })} 
                id="send-to-me" 
              />
              <label htmlFor="send-to-me" className="text-sm">
                Send this email to me as well
              </label>
            </div>
            
            <Button 
              variant="secondary" 
              onClick={handleSendTest}
              disabled={isSendingTest || isSending || !form.watch('subject')?.trim() || !form.watch('content')?.trim()}
            >
              {isSendingTest && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send Test
            </Button>
          </div>
          </div>
        </div>

        <div className="bg-background px-6 py-4 mt-auto">
          <FormFooter
            onSave={() => form.handleSubmit(handleSend)()}
            onCancel={handleCancel}
            isSaving={isSending}
            isDirty={isDirty}
            saveLabel={isMultipleUsers ? `Send to ${selectedUserIds.length} User${selectedUserIds.length !== 1 ? 's' : ''}` : 'Send'}
          />
        </div>
      </DialogContent>
      
      <DirtyFormDialog
        open={showDirtyDialog}
        onConfirm={handleConfirmCancel}
        onCancel={handleDismissCancel}
      />
    </Dialog>
  )
}
