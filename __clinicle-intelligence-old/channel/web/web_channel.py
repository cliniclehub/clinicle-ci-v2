"""The console's URL table.

Every route the web console answers on, and the web.py application built
from it. The handlers themselves live in api/, one module per view, and the
plumbing they share lives in core/ -- see channel/web/README.md.

This module imports every handler because build_app() resolves the names in
URLS against this module's globals; see build_app at the bottom.
"""

import web

from channel.web.api.agents import (  # noqa: F401
    AgentAvatarHandler, AgentCoreFileHandler, AgentsHandler,
)
from channel.web.api.auth import (  # noqa: F401
    AuthCheckHandler, AuthLoginHandler, AuthLogoutHandler, AuthSignupHandler,
    ChangePasswordHandler, McpOAuthCallbackHandler, MfaConfirmHandler, MfaDisableHandler, MfaEnrollHandler,
)
from channel.web.api.channels import (  # noqa: F401
    ChannelsHandler, FeishuRegisterHandler, WeixinQrHandler,
)
from channel.web.api.chat import (  # noqa: F401
    CancelHandler, MessageHandler, PollHandler, StreamHandler,
)
from channel.web.api.config import ConfigHandler, CustomCssHandler  # noqa: F401
from channel.web.api.extensions import (  # noqa: F401
    ExtensionActionHandler, ExtensionsActiveHandler, ExtensionsHandler,
)
from channel.web.api.files import (  # noqa: F401
    FileServeHandler, PreviewHandler, UploadHandler, UploadsHandler,
    VoiceAsrHandler, VoiceTtsHandler,
)
from channel.web.api.knowledge import (  # noqa: F401
    KnowledgeActionHandler, KnowledgeGraphHandler, KnowledgeImportHandler,
    KnowledgeListHandler, KnowledgeReadHandler,
)
from channel.web.api.logs import LogsDownloadHandler, LogsHandler  # noqa: F401
from channel.web.api.memory import (  # noqa: F401
    MemoryContentHandler, MemoryHandler,
)
from channel.web.api.models import ModelsHandler  # noqa: F401
from channel.web.api.openai_compat import (  # noqa: F401
    OpenAIChatCompletionsHandler,
)
from channel.web.api.pages import (  # noqa: F401
    AssetsHandler, ChatHandler, HealthHandler, LoginPageHandler,
    RootHandler, SignupPageHandler,
)
from channel.web.api.scheduler import (  # noqa: F401
    SchedulerCreateHandler, SchedulerDeleteHandler, SchedulerHandler,
    SchedulerInstancesHandler, SchedulerRecipientsHandler,
    SchedulerRunDeleteHandler, SchedulerRunDetailHandler, SchedulerRunHandler,
    SchedulerRunsHandler, SchedulerToggleHandler, SchedulerUpdateHandler,
)
from channel.web.api.connectors import (  # noqa: F401
    ConnectorsCatalogHandler, ConnectorSessionHandler, ConnectorsListHandler, ConnectorToggleHandler,
    ConnectorToolsHandler, MCPServerHandler, MCPServersHandler, OutlookAllowlistHandler,
)
from channel.web.api.teams import (  # noqa: F401
    TeamHandler, TeamMembersHandler, TeamsHandler, TeamWorkHandler,
)
from channel.web.api.alerts import AlertsHandler  # noqa: F401
from channel.web.api.sovereignty import (  # noqa: F401
    SovereigntyExportHandler, SovereigntyMetricsHandler,
    SovereigntyPurgeHandler, SovereigntyRetentionHandler,
)
from channel.web.api.analytics import AnalyticsMetricsHandler  # noqa: F401
from channel.web.api.task_board import (  # noqa: F401
    BoardAutopilotHandler, BoardTaskHandler, BoardTasksHandler,
)
from channel.web.api.meetings import (  # noqa: F401
    MeetingActionItemHandler, MeetingCalendarPrefillHandler, MeetingCalendarViewHandler,
    MeetingCancelBotHandler, MeetingHandler, MeetingParticipantsHandler,
    MeetingPublishHandler, MeetingReprocessHandler, MeetingsHandler,
    MeetingTranscriptHandler, RecallaiGoogleLoginHandler, RecallaiZoomAppHandler,
    UpcomingMeetingsHandler,
)
from channel.web.api.workflows import (  # noqa: F401
    WorkflowActiveHandler, WorkflowGraphHandler, WorkflowHandler,
    WorkflowRunHandler, WorkflowsHandler, WorkflowWebhookHandler,
)
from channel.web.api.whatsapp import WhatsAppWebhookHandler  # noqa: F401
from channel.web.api.review_queue import (  # noqa: F401
    ReviewQueueHandler, ReviewQueueItemActionHandler,
)
from channel.web.api.pending_edits import (  # noqa: F401
    PendingEditActionHandler, PendingEditsHandler,
)
from channel.web.api.notifications import NotificationsHandler  # noqa: F401
from channel.web.api.tenancy import (  # noqa: F401
    InviteAcceptHandler, MyCapabilitiesHandler, OrgAuditHandler, OrgCapabilitiesHandler,
    OrgInviteHandler, OrgInvitesHandler,
    OrgMemberHandler, OrgMemberRoleHandler, OrgMembersHandler,
)
from channel.web.api.org_graph import OrgGraphHandler, OrgTeamAssignHandler  # noqa: F401
from channel.web.api.worktrees import (  # noqa: F401
    WorktreeActionHandler, WorktreeCompleteHandler, WorktreeConflictsHandler,
    WorktreeResolveBinaryHandler, WorktreeResolveHandler, WorktreesHandler,
)
from channel.web.api.workspace_files import (  # noqa: F401
    WorkspaceFileHandler, WorkspaceTerminalHandler, WorkspaceTreeHandler,
)
from channel.web.api.browser_view import (  # noqa: F401
    BrowserControlHandler, BrowserFrameHandler, BrowserStatusHandler,
)
from channel.web.api.config import CustomCssHandler  # noqa: F401
from channel.web.api.usage import UsageSummaryHandler  # noqa: F401
from channel.web.api.user_avatar import UserAvatarHandler  # noqa: F401
from channel.web.api.secrets import (  # noqa: F401
    MfaCoverageHandler, SecretHandler, SecretsHandler,
    SecuritySessionRevokeHandler, SecuritySessionsHandler,
)
from channel.web.api.activity import ActivityHandler  # noqa: F401
from channel.web.api.system import SystemMetricsHandler  # noqa: F401
from channel.web.api.sessions import (  # noqa: F401
    HistoryHandler, MessageDeleteHandler, PromptOptimizeHandler,
    SessionClearContextHandler, SessionCompactContextHandler,
    SessionContextUsageHandler, SessionDetailHandler, SessionSettingsHandler,
    SessionTitleHandler, SessionsHandler, UserMessagesHandler,
)
from channel.web.api.skills import (  # noqa: F401
    SkillContentHandler, SkillsHandler, ToolsHandler,
)
from channel.web.api.update import (  # noqa: F401
    UpdateCheckHandler, UpdateStartHandler, UpdateStatusHandler, VersionHandler,
)
from channel.web.api.workspace import (  # noqa: F401
    ProjectBrowseHandler, ProjectCreateHandler, ProjectManageHandler,
    ProjectOrderHandler, ProjectSelectHandler, ProjectsHandler, ProjectTreeHandler,
    WorkspaceMetaHandler, WorkspaceReadHandler, WorkspaceResolveHandler,
    WorkspaceSearchHandler, WorkspaceWriteHandler,
)
# Re-exported, not used here. app.py waits on SERVING and channel_factory
# resolves "channel.web.web_channel.WebChannel" by name, so both have to stay
# reachable through this module; the tests reach for the rest.
from channel.web.core._common import (  # noqa: F401
    SERVING, SSEStreamState, WebMessage,
)
from channel.web.core.channel import WebChannel  # noqa: F401


URLS = (
    '/', 'ChatHandler',
    '/chat', 'RootHandler',
    '/login', 'LoginPageHandler',
    '/signup', 'SignupPageHandler',
    '/api/health', 'HealthHandler',
    '/auth/login', 'AuthLoginHandler',
    '/auth/signup', 'AuthSignupHandler',
    '/auth/check', 'AuthCheckHandler',
    '/auth/logout', 'AuthLogoutHandler',
    '/auth/mfa/enroll', 'MfaEnrollHandler',
    '/auth/mfa/confirm', 'MfaConfirmHandler',
    '/auth/mfa/disable', 'MfaDisableHandler',
    '/auth/change-password', 'ChangePasswordHandler',
    '/api/org/members', 'OrgMembersHandler',
    '/api/org/members/([0-9]+)/role', 'OrgMemberRoleHandler',
    '/api/org/members/([0-9]+)', 'OrgMemberHandler',
    '/api/org/invites/(.*)', 'OrgInviteHandler',
    '/api/org/invites', 'OrgInvitesHandler',
    '/api/org/capabilities', 'OrgCapabilitiesHandler',
    '/api/org/audit', 'OrgAuditHandler',
    '/api/org/graph', 'OrgGraphHandler',
    '/api/org/teams/(.*)', 'OrgTeamAssignHandler',
    '/api/me/capabilities', 'MyCapabilitiesHandler',
    '/api/invites/(.*)/accept', 'InviteAcceptHandler',
    '/invite/(.*)', 'InviteAcceptHandler',
    '/api/secrets/(.*)', 'SecretHandler',
    '/api/secrets', 'SecretsHandler',
    '/api/security/mfa-coverage', 'MfaCoverageHandler',
    '/api/security/sessions/(.*)/revoke', 'SecuritySessionRevokeHandler',
    '/api/security/sessions', 'SecuritySessionsHandler',
    '/message', 'MessageHandler',
    '/upload', 'UploadHandler',
    '/uploads/(.*)', 'UploadsHandler',
    '/api/file', 'FileServeHandler',
    '/preview/(.+)', 'PreviewHandler',
    '/api/workspace/tree', 'WorkspaceTreeHandler',
    '/api/workspace/search', 'WorkspaceSearchHandler',
    '/api/workspace/resolve', 'WorkspaceResolveHandler',
    '/api/workspace/meta', 'WorkspaceMetaHandler',
    '/api/workspace/read', 'WorkspaceReadHandler',
    '/api/workspace/write', 'WorkspaceWriteHandler',
    '/api/projects', 'ProjectsHandler',
    '/api/projects/select', 'ProjectSelectHandler',
    '/api/projects/create', 'ProjectCreateHandler',
    '/api/projects/browse', 'ProjectBrowseHandler',
    '/api/projects/order', 'ProjectOrderHandler',
    '/api/projects/manage', 'ProjectManageHandler',
    '/api/voice/asr', 'VoiceAsrHandler',
    '/api/voice/tts', 'VoiceTtsHandler',
    '/poll', 'PollHandler',
    '/stream', 'StreamHandler',
    '/cancel', 'CancelHandler',
    '/v1/chat/completions', 'OpenAIChatCompletionsHandler',
    '/config', 'ConfigHandler',
    '/api/models', 'ModelsHandler',
    '/api/usage/summary', 'UsageSummaryHandler',
    '/api/channels', 'ChannelsHandler',
    '/api/weixin/qrlogin', 'WeixinQrHandler',
    '/api/feishu/register', 'FeishuRegisterHandler',
    '/api/tools', 'ToolsHandler',
    '/api/skills', 'SkillsHandler',
    '/api/skills/content', 'SkillContentHandler',
    '/api/memory', 'MemoryHandler',
    '/api/memory/content', 'MemoryContentHandler',
    '/api/knowledge/list', 'KnowledgeListHandler',
    '/api/knowledge/read', 'KnowledgeReadHandler',
    '/api/knowledge/graph', 'KnowledgeGraphHandler',
    '/api/knowledge/action', 'KnowledgeActionHandler',
    '/api/knowledge/import', 'KnowledgeImportHandler',
    '/api/scheduler', 'SchedulerHandler',
    '/api/scheduler/runs/detail', 'SchedulerRunDetailHandler',
    '/api/scheduler/runs/delete', 'SchedulerRunDeleteHandler',
    '/api/scheduler/runs', 'SchedulerRunsHandler',
    '/api/scheduler/run', 'SchedulerRunHandler',
    '/api/scheduler/toggle', 'SchedulerToggleHandler',
    '/api/scheduler/update', 'SchedulerUpdateHandler',
    '/api/scheduler/delete', 'SchedulerDeleteHandler',
    '/api/scheduler/create', 'SchedulerCreateHandler',
    '/api/scheduler/recipients', 'SchedulerRecipientsHandler',
    '/api/scheduler/instances', 'SchedulerInstancesHandler',
    '/api/agents', 'AgentsHandler',
    '/api/agents/([^/]+)/avatar', 'AgentAvatarHandler',
    '/api/users/([^/]+)/avatar', 'UserAvatarHandler',
    '/api/agents/([^/]+)/files/([^/]+)', 'AgentCoreFileHandler',
    '/api/sessions', 'SessionsHandler',
    '/api/sessions/(.*)/generate_title', 'SessionTitleHandler',
    '/api/prompt/optimize', 'PromptOptimizeHandler',
    '/api/sessions/(.*)/clear_context', 'SessionClearContextHandler',
    '/api/sessions/(.*)/context_usage', 'SessionContextUsageHandler',
    '/api/sessions/(.*)/compact_context', 'SessionCompactContextHandler',
    '/api/sessions/(.*)/settings', 'SessionSettingsHandler',
    '/api/sessions/(.*)', 'SessionDetailHandler',
    '/api/history/user_messages', 'UserMessagesHandler',
    '/api/history', 'HistoryHandler',
    '/api/messages/delete', 'MessageDeleteHandler',
    '/api/logs/download', 'LogsDownloadHandler',
    '/api/logs', 'LogsHandler',
    '/api/version', 'VersionHandler',
    '/api/update/check', 'UpdateCheckHandler',
    '/api/update/start', 'UpdateStartHandler',
    '/api/update/status', 'UpdateStatusHandler',
    '/mcp/oauth/callback', 'McpOAuthCallbackHandler',
    '/api/connectors/sessions', 'ConnectorSessionHandler',
    '/api/connectors/catalog', 'ConnectorsCatalogHandler',
    '/api/connectors/tools', 'ConnectorToolsHandler',
    '/api/connectors/toggles', 'ConnectorToggleHandler',
    '/api/connectors/outlook/allowlist', 'OutlookAllowlistHandler',
    '/api/connectors/mcp/(.*)', 'MCPServerHandler',
    '/api/connectors/mcp', 'MCPServersHandler',
    '/api/connectors/(.*)', 'ConnectorsListHandler',
    '/api/connectors', 'ConnectorsListHandler',
    '/api/teams/(.*)/members/(.*)', 'TeamMembersHandler',
    '/api/teams/(.*)/members', 'TeamMembersHandler',
    '/api/teams/(.*)/work', 'TeamWorkHandler',
    '/api/teams/(.*)', 'TeamHandler',
    '/api/teams', 'TeamsHandler',
    '/api/sovereignty/metrics', 'SovereigntyMetricsHandler',
    '/api/sovereignty/export', 'SovereigntyExportHandler',
    '/api/sovereignty/retention', 'SovereigntyRetentionHandler',
    '/api/sovereignty/purge', 'SovereigntyPurgeHandler',
    '/api/review-queue/(.*)', 'ReviewQueueItemActionHandler',
    '/api/review-queue', 'ReviewQueueHandler',
    '/api/pending-edits/(.*)', 'PendingEditActionHandler',
    '/api/pending-edits', 'PendingEditsHandler',
    '/api/worktrees/(.*)/conflicts', 'WorktreeConflictsHandler',
    '/api/worktrees/(.*)/resolve-binary', 'WorktreeResolveBinaryHandler',
    '/api/worktrees/(.*)/resolve', 'WorktreeResolveHandler',
    '/api/worktrees/(.*)/complete', 'WorktreeCompleteHandler',
    '/api/worktrees/(.*)', 'WorktreeActionHandler',
    '/api/worktrees', 'WorktreesHandler',
    '/api/notifications', 'NotificationsHandler',
    '/api/workspace/project-tree', 'ProjectTreeHandler',
    '/api/workspace/file', 'WorkspaceFileHandler',
    '/api/workspace/terminal', 'WorkspaceTerminalHandler',
    '/api/browser/status', 'BrowserStatusHandler',
    '/api/browser/frame', 'BrowserFrameHandler',
    '/api/browser/control', 'BrowserControlHandler',
    '/api/custom-css', 'CustomCssHandler',
    '/api/extensions/active', 'ExtensionsActiveHandler',
    '/api/extensions', 'ExtensionsHandler',
    '/api/extensions/(.*)', 'ExtensionActionHandler',
    '/api/analytics', 'AnalyticsMetricsHandler',
    '/api/alerts', 'AlertsHandler',
    '/api/board/autopilot', 'BoardAutopilotHandler',
    '/api/board/tasks/(.*)', 'BoardTaskHandler',
    '/api/board/tasks', 'BoardTasksHandler',
    '/api/meetings/settings/recallai/zoom_app', 'RecallaiZoomAppHandler',
    '/api/meetings/settings/recallai/google_login/(.*)', 'RecallaiGoogleLoginHandler',
    '/api/meetings/upcoming', 'UpcomingMeetingsHandler',
    '/api/meetings/calendar', 'MeetingCalendarViewHandler',
    '/api/meetings/(.*)/action_items/([0-9]+)', 'MeetingActionItemHandler',
    '/api/meetings/(.*)/participants', 'MeetingParticipantsHandler',
    '/api/meetings/(.*)/calendar_prefill', 'MeetingCalendarPrefillHandler',
    '/api/meetings/(.*)/cancel_bot', 'MeetingCancelBotHandler',
    '/api/meetings/(.*)/transcript', 'MeetingTranscriptHandler',
    '/api/meetings/(.*)/reprocess', 'MeetingReprocessHandler',
    '/api/meetings/(.*)/publish', 'MeetingPublishHandler',
    '/api/meetings/(.*)', 'MeetingHandler',
    '/api/meetings', 'MeetingsHandler',
    '/api/whatsapp/webhook', 'WhatsAppWebhookHandler',
    '/api/workflows/webhook/(.*)', 'WorkflowWebhookHandler',
    '/api/workflows/(.*)/run', 'WorkflowRunHandler',
    '/api/workflows/(.*)/active', 'WorkflowActiveHandler',
    '/api/workflows/(.*)/graph', 'WorkflowGraphHandler',
    '/api/workflows/(.*)', 'WorkflowHandler',
    '/api/workflows', 'WorkflowsHandler',
    '/api/activity', 'ActivityHandler',
    '/api/system/metrics', 'SystemMetricsHandler',
    '/assets/(.*)', 'AssetsHandler',
    # Views inside the single-page console. Each serves the same shell;
    # the frontend router reads the path and opens the view it names,
    # so a reload or a shared link lands where it says. Last in the
    # table on purpose: web.py takes the first match, so no view name
    # can ever shadow an API route above -- which is also why the
    # settings view is /settings and not /config, a path the config
    # API already owns.
    '/(?:home|agents|settings|memory|knowledge|scheduler|logs'
    '|review-queue|workflows|teams|meetings|board|alerts|analytics|org-graph'
    '|pending-edits|worktrees)'
    '(?:/[a-z-]+)?/?', 'ChatHandler',
)


def _identity_processor(handler):
    """Resolve org identity from the session token before every request.

    A request carrying a valid multi-tenant session token (see
    ``tenancy_session.py``) runs its handler with ``org_id`` pushed onto the
    ambient ``RuntimeIdentity`` — so every ``state_root()``/``shared_root()``
    call the handler makes, transitively, resolves under that org's own
    directory tree without the handler itself needing to know tenancy
    exists. A request with no such token (every request today, on an
    instance with no accounts yet) runs exactly as it always has.

    Runs on every request, ahead of routing — so the token lookup it does
    (cookie / bearer header / query string) must never touch the POST body.
    ``_get_query_token()`` is now GET-only for exactly this reason (see its
    own docstring): an earlier version of this processor read the body via
    an unrestricted ``web.input()`` and silently corrupted multipart file
    uploads by draining the stream before the real handler read it — caught
    by ``tests/test_upload_agent_scope.py``.
    """
    from channel.web.core._common import _get_bearer_token, _get_query_token, _session_expire_seconds
    from channel.web.core.tenancy_session import verify_session_token
    from common.runtime_identity import RuntimeIdentity, use_identity

    # Deliberately the pure verifier, not verify_session_token_active: this
    # processor only sets ambient org identity for routing, it is not an
    # authorization gate (that's _check_auth/_require_membership, which do
    # use the revocation-aware verifier). A revoked token still gets its
    # org_id resolved here, but every real handler downstream still 401s it
    # at the actual gate -- and a DB lookup on literally every request here
    # is exactly the wrong place to pay that cost or that failure mode.
    token = (
        web.cookies().get("cow_auth_token", "")
        or _get_bearer_token()
        or _get_query_token()
    )
    resolved = verify_session_token(token, _session_expire_seconds()) if token else None
    if resolved is None:
        return handler()
    _user_id, org_id = resolved
    with use_identity(RuntimeIdentity(org_id=str(org_id))):
        return handler()


def build_app():
    """The web.py application, built against this module's namespace.

    web.py resolves the handler names in URLS by looking them up in a
    namespace dict, so the application has to be built where those names are
    in scope. That is here -- this module imports every handler -- and it is
    why WebChannel, which only runs the server, asks for the app instead of
    assembling one.
    """
    app = web.application(URLS, globals(), autoreload=False)
    app.add_processor(_identity_processor)
    return app
