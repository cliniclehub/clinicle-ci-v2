# Changelog

All notable changes to Clinicle Intelligence are documented here. This file
starts at 2.2.1 — earlier releases (tagged `v2.2.0` and before) predate this
changelog and aren't backfilled.

## [2.2.1] - 2026-09-28

### Added
- Notifications bell in the header: aggregates Review Queue flags, Pending
  Edits, worktree merge conflicts, and scheduler run completions into one
  dropdown with an unread count badge and click-to-navigate.
- Code Editor and Browser View are now split panels on the Chat view
  (toggle buttons next to Activity) instead of separate sidebar pages —
  watch the agent browse or edit files without leaving the conversation.
  The browser panel resizes the live page's viewport to fit the panel.
- Org Graph, Worktrees (isolated sub-agent git worktrees with merge-conflict
  resolution), Pending Edits review queue, and an Extensions system.
- A Plan tool, Claude Code/Codex CLI bot support, a scheduler stall
  watchdog, and usage tracking.
- Drag-and-drop status changes on the Task Board.
- Profile picture upload, reflected in the topbar avatar.

### Changed
- Settings consolidated from 8 separate pages into one shell with internal
  sub-navigation.
- Non-critical vendor scripts deferred, cutting page load by roughly 30%.
- WAL mode enabled on the review-queue/meeting/tenancy databases; the
  default org id is now cached instead of recomputed per request.

### Fixed
- Dashboard was capped at `max-w-6xl`; now fills the page width.
- The Autopilot/Activity panel no longer auto-opens on every page load.
- The "Release notes" button was a hardcoded no-op.
- Subagent run misattribution in the web console.
- A full ecosystem-touchpoint audit pass found and fixed 43 cross-feature
  correlation bugs across frontend/backend/desktop, including a critical
  route-collision fix, a desktop LAN-exposure fix, cross-pane theme/i18n/CSS
  sync, scheduler org-identity restoration, and a credential-fallback
  hardening fix.
