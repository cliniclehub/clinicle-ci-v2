"use client"

import { Bell, Mail, Smartphone } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DirtyFormDialog } from "@/components/ui/dirty-form-dialog"
import { FormFooter } from "@/components/ui/form-footer"
import { FormSection } from "@/components/ui/form-section"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationRuleDefinition,
  NotificationSettings,
} from "@/lib/types/notification-schema"
import {
  defaultOffsetMinutesPlaceholder,
  NOTIFICATION_OFFSET_MINUTES_HELPER,
  parseValidatedSingleOffsetInput,
  singleOffsetToDisplayText,
} from "@/lib/utils/notification-offset-display"
import { createClientLogger } from "@/lib/utils/logger-client"

const logger = createClientLogger("NotificationSettingsEditor")
const RULE_ORDER: string[] = []

interface NotificationSettingsEditorProps {
  title: string
  description?: string
  rules: NotificationRuleDefinition[]
  settings?: NotificationSettings | null
  orgSettings?: NotificationSettings | null
  showInheritance?: boolean
  variant?: "standalone" | "section"
  formSectionId?: string
  isSaving?: boolean
  onSave: (settings: NotificationSettings) => Promise<void> | void
  onDirtyChange?: (isDirty: boolean) => void
  onCancel?: () => void
}

function normalizeSettings(settings?: NotificationSettings | null): NotificationSettings {
  return {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...(settings || {}),
    rules: settings?.rules || {},
  }
}

function buildOffsetTexts(
  rules: NotificationRuleDefinition[],
  settings: NotificationSettings
): Record<string, string> {
  const texts: Record<string, string> = {}
  for (const rule of rules) {
    const override = settings.rules[rule.ruleKey] || {}
    const offsets = override.offsetsMinutes ?? rule.defaultOffsetsMinutes
    texts[rule.ruleKey] = singleOffsetToDisplayText(offsets)
  }
  return texts
}

function sortRules(rules: NotificationRuleDefinition[]): NotificationRuleDefinition[] {
  return [...rules].sort((a, b) => {
    const aIndex = RULE_ORDER.indexOf(a.ruleKey)
    const bIndex = RULE_ORDER.indexOf(b.ruleKey)
    if (aIndex === -1 && bIndex === -1) return a.displayName.localeCompare(b.displayName)
    if (aIndex === -1) return 1
    if (bIndex === -1) return -1
    return aIndex - bIndex
  })
}

function resolveRuleDisplayState(
  rule: NotificationRuleDefinition,
  settings: NotificationSettings
): { enabled: boolean; offsetText: string } {
  const override = settings.rules[rule.ruleKey] || {}
  const ruleEnabled = settings.enabled && (override.enabled ?? true)
  const offsets = override.offsetsMinutes ?? rule.defaultOffsetsMinutes
  return {
    enabled: ruleEnabled,
    offsetText: singleOffsetToDisplayText(offsets),
  }
}

function NotificationSettingsRulesTable({
  rules,
  settings,
  readOnly = false,
  offsetTexts,
  onOffsetTextChange,
  onOffsetTextCommit,
  onRuleEnabledChange,
  onMasterEnabledChange,
}: {
  rules: NotificationRuleDefinition[]
  settings: NotificationSettings
  readOnly?: boolean
  offsetTexts?: Record<string, string>
  onOffsetTextChange?: (ruleKey: string, text: string) => void
  onOffsetTextCommit?: (ruleKey: string, text: string, ruleEnabled: boolean) => void
  onRuleEnabledChange?: (ruleKey: string, enabled: boolean) => void
  onMasterEnabledChange?: (enabled: boolean) => void
}) {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex items-center justify-between gap-4 rounded-md border p-4">
          <div className="space-y-1">
            <Label
              htmlFor={readOnly ? undefined : "notifications-enabled"}
              className="flex items-center gap-2"
            >
              <Mail className="h-4 w-4" />
              Email notifications
            </Label>
            <p className="text-sm text-muted-foreground">
              {readOnly
                ? "Organization master control for reminder emails."
                : "Master control for all reminder emails."}
            </p>
          </div>
          {readOnly ? (
            <span className="text-sm font-medium">{settings.enabled ? "On" : "Off"}</span>
          ) : (
            <Switch
              id="notifications-enabled"
              checked={settings.enabled}
              onCheckedChange={(enabled) => onMasterEnabledChange?.(enabled)}
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 p-4">
          <div className="space-y-1">
            <Label className="flex items-center gap-2 text-muted-foreground">
              <Smartphone className="h-4 w-4" />
              Push notifications
            </Label>
            <p className="text-sm text-muted-foreground">Phone notifications are not enabled yet.</p>
          </div>
          <span className="text-sm text-muted-foreground">Off</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <div className="grid min-w-[760px] grid-cols-[minmax(0,1fr)_92px_92px_minmax(180px,280px)] border-b bg-muted/40 px-4 py-3 text-sm font-medium">
          <div>Reminder</div>
          <div className="flex items-center justify-center gap-2">
            <Mail className="h-4 w-4" />
            Email
          </div>
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Smartphone className="h-4 w-4" />
            Push
          </div>
          <div>Minutes before</div>
        </div>

        {rules.length === 0 ? (
          <div className="px-4 py-8 text-sm text-muted-foreground">
            No business notification rules yet. Transactional emails are configured under Email
            Manager.
          </div>
        ) : (
          sortRules(rules).map((rule) => {
            const display = resolveRuleDisplayState(rule, settings)
            const override = settings.rules[rule.ruleKey] || {}
            const ruleCheckboxEnabled =
              settings.enabled && (override.enabled ?? true)
            const offsetText = offsetTexts?.[rule.ruleKey] ?? display.offsetText

            return (
              <div
                key={rule.ruleKey}
                className="grid min-w-[760px] grid-cols-[minmax(0,1fr)_92px_92px_minmax(180px,280px)] items-center border-b px-4 py-4 last:border-b-0"
              >
                <div className="space-y-1 pr-4">
                  <Label htmlFor={readOnly ? undefined : `${rule.ruleKey}-enabled`}>
                    {rule.displayName}
                  </Label>
                  {rule.description && (
                    <p className="text-sm text-muted-foreground">{rule.description}</p>
                  )}
                </div>
                <div className="flex justify-center">
                  {readOnly ? (
                    <span className="text-sm">{display.enabled ? "On" : "Off"}</span>
                  ) : (
                    <Checkbox
                      id={`${rule.ruleKey}-enabled`}
                      checked={ruleCheckboxEnabled}
                      disabled={!settings.enabled}
                      onCheckedChange={(nextEnabled) =>
                        onRuleEnabledChange?.(rule.ruleKey, nextEnabled === true)
                      }
                      aria-label={`${rule.displayName} email`}
                    />
                  )}
                </div>
                <div className="flex justify-center">
                  {readOnly ? (
                    <span className="text-sm text-muted-foreground">Off</span>
                  ) : (
                    <Checkbox checked={false} disabled aria-label={`${rule.displayName} push`} />
                  )}
                </div>
                <div className="space-y-1">
                  {readOnly ? (
                    <p className="text-sm">{display.enabled ? offsetText : "—"}</p>
                  ) : (
                    <>
                      <Input
                        id={`${rule.ruleKey}-offsets`}
                        type="number"
                        min={0}
                        step={1}
                        value={offsetText}
                        onChange={(event) => onOffsetTextChange?.(rule.ruleKey, event.target.value)}
                        onBlur={(event) =>
                          onOffsetTextCommit?.(rule.ruleKey, event.target.value, ruleCheckboxEnabled)
                        }
                        placeholder={defaultOffsetMinutesPlaceholder(rule)}
                        disabled={!ruleCheckboxEnabled || !settings.enabled}
                        required={ruleCheckboxEnabled && settings.enabled}
                      />
                      <p className="text-xs text-muted-foreground">
                        {NOTIFICATION_OFFSET_MINUTES_HELPER}
                      </p>
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </>
  )
}

export function NotificationSettingsEditor({
  title,
  description,
  rules,
  settings,
  orgSettings,
  showInheritance = false,
  variant = "standalone",
  formSectionId = "org-notifications",
  isSaving = false,
  onSave,
  onDirtyChange,
  onCancel,
}: NotificationSettingsEditorProps) {
  const initial = useMemo(() => normalizeSettings(settings), [settings])
  const normalizedOrgSettings = useMemo(
    () => normalizeSettings(orgSettings),
    [orgSettings]
  )
  const initialOffsetTexts = useMemo(() => buildOffsetTexts(rules, initial), [rules, initial])
  const [draft, setDraft] = useState<NotificationSettings>(initial)
  const [offsetTexts, setOffsetTexts] = useState<Record<string, string>>(() =>
    buildOffsetTexts(rules, initial)
  )
  const [saving, setSaving] = useState(false)
  const [showDirtyDialog, setShowDirtyDialog] = useState(false)
  const onDirtyChangeRef = useRef(onDirtyChange)

  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange
  }, [onDirtyChange])

  useEffect(() => {
    setDraft(initial)
    setOffsetTexts(buildOffsetTexts(rules, initial))
    onDirtyChangeRef.current?.(false)
  }, [initial, rules])

  const dirty = useMemo(() => {
    if (showInheritance && draft.inheritOrgDefaults) {
      const currentPayload = {
        enabled: draft.enabled,
        inheritOrgDefaults: true,
        rules: {},
      }
      if (initial.inheritOrgDefaults) {
        const savedPayload = {
          enabled: initial.enabled,
          inheritOrgDefaults: true,
          rules: {},
        }
        return JSON.stringify(currentPayload) !== JSON.stringify(savedPayload)
      }
      return true
    }

    const draftDirty = JSON.stringify({ ...draft, inheritOrgDefaults: false }) !== JSON.stringify({
      ...initial,
      inheritOrgDefaults: false,
    })
    const offsetDirty = JSON.stringify(offsetTexts) !== JSON.stringify(initialOffsetTexts)
    return draftDirty || offsetDirty
  }, [
    draft,
    initial,
    offsetTexts,
    initialOffsetTexts,
    showInheritance,
  ])

  useEffect(() => {
    onDirtyChangeRef.current?.(dirty)
  }, [dirty])

  const updateRule = (ruleKey: string, patch: Record<string, unknown>) => {
    setDraft((current) => ({
      ...current,
      rules: {
        ...current.rules,
        [ruleKey]: {
          ...(current.rules[ruleKey] || {}),
          ...patch,
        },
      },
    }))
  }

  const handleInheritOrgDefaultsChange = (useOrgDefaults: boolean) => {
    if (useOrgDefaults) {
      setDraft((current) => ({
        ...current,
        inheritOrgDefaults: true,
      }))
      return
    }

    const baseline = normalizedOrgSettings
    const nextDraft: NotificationSettings = {
      enabled: baseline.enabled,
      inheritOrgDefaults: false,
      rules: { ...baseline.rules },
    }
    setDraft(nextDraft)
    setOffsetTexts(buildOffsetTexts(rules, nextDraft))
  }

  const buildSavePayload = (): NotificationSettings | null => {
    if (showInheritance && draft.inheritOrgDefaults) {
      return {
        enabled: draft.enabled,
        inheritOrgDefaults: true,
        rules: {},
      }
    }

    const nextDraft: NotificationSettings = {
      enabled: draft.enabled,
      inheritOrgDefaults: false,
      rules: {},
    }

    if (!draft.enabled) {
      return nextDraft
    }

    for (const rule of rules) {
      const override = draft.rules[rule.ruleKey] || {}
      const ruleEnabled = draft.enabled && (override.enabled ?? true)
      const text =
        offsetTexts[rule.ruleKey] ??
        singleOffsetToDisplayText(override.offsetsMinutes ?? rule.defaultOffsetsMinutes)

      if (!ruleEnabled) {
        const disabledRule: NotificationSettings["rules"][string] = {
          enabled: false,
          channels: ["email"],
        }
        const { offsetsMinutes } = parseValidatedSingleOffsetInput(text, {
          required: false,
        })
        if (offsetsMinutes.length > 0) {
          disabledRule.offsetsMinutes = offsetsMinutes
        } else if (override.offsetsMinutes?.length) {
          disabledRule.offsetsMinutes = override.offsetsMinutes
        }
        nextDraft.rules[rule.ruleKey] = disabledRule
        continue
      }

      const { offsetsMinutes, error } = parseValidatedSingleOffsetInput(text, {
        required: true,
      })
      if (error) {
        toast.error(`${rule.displayName}: ${error}`)
        return null
      }

      nextDraft.rules[rule.ruleKey] = {
        offsetsMinutes,
        channels: ["email"],
        enabled: true,
      }
    }

    return nextDraft
  }

  const commitOffsetText = (ruleKey: string, text: string, ruleEnabled: boolean) => {
    const { offsetsMinutes, error } = parseValidatedSingleOffsetInput(text, {
      required: draft.enabled && ruleEnabled,
    })
    if (error) {
      toast.error(error)
      const rule = rules.find((item) => item.ruleKey === ruleKey)
      setOffsetTexts((current) => ({
        ...current,
        [ruleKey]: rule
          ? singleOffsetToDisplayText(
              draft.rules[ruleKey]?.offsetsMinutes ?? rule.defaultOffsetsMinutes
            )
          : text,
      }))
      return
    }

    updateRule(ruleKey, {
      offsetsMinutes,
      channels: ["email"],
    })
    setOffsetTexts((current) => ({
      ...current,
      [ruleKey]: singleOffsetToDisplayText(offsetsMinutes),
    }))
  }

  const handleSave = async () => {
    const nextDraft = buildSavePayload()
    if (!nextDraft) return

    try {
      setSaving(true)
      setDraft(nextDraft)
      await onSave(nextDraft)
      setOffsetTexts(buildOffsetTexts(rules, nextDraft))
      toast.success("Notification settings saved")
      onDirtyChangeRef.current?.(false)
    } catch (error) {
      logger.error("Failed to save notification settings", error as Error)
      toast.error("Failed to save notification settings")
    } finally {
      setSaving(false)
    }
  }

  const resetToInitial = () => {
    setDraft(initial)
    setOffsetTexts(initialOffsetTexts)
    onDirtyChangeRef.current?.(false)
  }

  const handleCancel = () => {
    if (dirty) {
      setShowDirtyDialog(true)
      return
    }
    onCancel?.()
  }

  const handleConfirmCancel = () => {
    resetToInitial()
    setShowDirtyDialog(false)
    onCancel?.()
  }

  const usingOrgDefaults = showInheritance && draft.inheritOrgDefaults

  const settingsContent = (
    <>
      {showInheritance && (
        <div className="flex flex-row items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="notifications-inherit" className="text-base">
              Use organization defaults
            </Label>
            <p className="text-sm text-muted-foreground">
              Reminder emails follow your organization notification settings unless you override
              them for this resource.
            </p>
          </div>
          <Switch
            id="notifications-inherit"
            checked={draft.inheritOrgDefaults}
            onCheckedChange={handleInheritOrgDefaultsChange}
          />
        </div>
      )}

      {usingOrgDefaults ? (
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium">Organization notification settings</p>
          <p className="text-sm text-muted-foreground">
            This resource uses the organization defaults shown below. Turn off organization defaults
            to customize its reminders.
          </p>
          <NotificationSettingsRulesTable
            rules={rules}
            settings={normalizedOrgSettings}
            readOnly
          />
        </div>
      ) : (
        <NotificationSettingsRulesTable
          rules={rules}
          settings={draft}
          offsetTexts={offsetTexts}
          onMasterEnabledChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
          onRuleEnabledChange={(ruleKey, enabled) =>
            updateRule(ruleKey, {
              enabled,
              channels: ["email"],
            })
          }
          onOffsetTextChange={(ruleKey, text) =>
            setOffsetTexts((current) => ({
              ...current,
              [ruleKey]: text,
            }))
          }
          onOffsetTextCommit={(ruleKey, text, ruleEnabled) =>
            commitOffsetText(ruleKey, text, ruleEnabled)
          }
        />
      )}
    </>
  )

  if (variant === "section") {
    return (
      <>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void handleSave()
          }}
          className="flex flex-col gap-6"
        >
          <Card>
            <CardContent className="pt-6">
              <FormSection
                id={formSectionId}
                title={title}
                description={description}
                isDirty={dirty}
              >
                {settingsContent}
              </FormSection>
            </CardContent>
          </Card>

          <FormFooter
            onSave={() => void handleSave()}
            onCancel={handleCancel}
            isSaving={saving || isSaving}
            isDirty={dirty}
            saveLabel="Save settings"
          />
        </form>

        <DirtyFormDialog
          open={showDirtyDialog}
          onConfirm={handleConfirmCancel}
          onCancel={() => setShowDirtyDialog(false)}
        />
      </>
    )
  }

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void handleSave()
        }}
        className="flex flex-col gap-6"
      >
        <Card>
          <CardHeader className="space-y-2">
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              {title}
            </CardTitle>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </CardHeader>
          <CardContent className="space-y-5">{settingsContent}</CardContent>
        </Card>

        <FormFooter
          onSave={() => void handleSave()}
          onCancel={onCancel ? handleCancel : undefined}
          isSaving={saving || isSaving}
          isDirty={dirty}
          saveLabel="Save settings"
        />
      </form>

      {onCancel && (
        <DirtyFormDialog
          open={showDirtyDialog}
          onConfirm={handleConfirmCancel}
          onCancel={() => setShowDirtyDialog(false)}
        />
      )}
    </>
  )
}
