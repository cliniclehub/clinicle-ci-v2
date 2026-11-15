"""
Enhanced Email Service
Simplified email service with threshold-based queue processing
"""

import json
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List, Tuple
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import and_, func, inspect, or_

from .email_renderer import EmailRenderer
from .model import EmailQueue, EmailLog
from .recipient_gate import (
    BLOCKED_PLACEHOLDER_EMAIL_REASON,
    is_non_deliverable_recipient_email,
)
from .schema import EmailQueueResponse, EmailLogResponse
from app.common.business_exceptions import BadRequestError, NotFoundError
from app.common.app_logger import get_logger
from app.common.config import (
    DEFAULT_SENDER_FROM_EMAIL,
    DEFAULT_SYSTEM_FROM_EMAIL,
    EMAIL_QUEUE_PROCESSING_STALE_AFTER_SECONDS,
)
from app.common.email_providers.base import EmailMessage, EmailAddress, EmailSendResult
from app.common.email_providers.factory import EmailProviderFactory
# No need to import config - factory handles everything

class_logger = get_logger(__name__)

BLOCKED_DELIVERY_DISABLED_REASON = (
    "Blocked: EMAIL_DELIVERY_ENABLED is false; message was not sent to the email provider"
)
BLOCKED_DELIVERY_DISABLED_CODE = "delivery_disabled"


def _is_dry_run_provider_result(send_result: EmailSendResult) -> bool:
    """True when the provider did not actually deliver (logging dry-run)."""
    response = send_result.provider_response or {}
    return bool(response.get("dry_run"))


class EmailEngineService:
    """
    Simplified email service with threshold-based queue processing
    """
    
    # Class-level configuration
    DEFAULT_THRESHOLD = 1  # Number of emails above which to use queue
    
    def __init__(self, db: Session, threshold: Optional[int] = None):
        self.db = db
        self.renderer = EmailRenderer(db)
        self.threshold = threshold or self.DEFAULT_THRESHOLD

    @staticmethod
    def _json_safe(value: Any) -> Any:
        """Recursively convert values so they can be stored in JSONB."""
        if isinstance(value, UUID):
            return str(value)
        if isinstance(value, datetime):
            return value.isoformat()
        if isinstance(value, dict):
            return {key: EmailEngineService._json_safe(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [EmailEngineService._json_safe(item) for item in value]
        return value

    @staticmethod
    def _coerce_user_id(value: Any) -> Optional[UUID]:
        if value is None or value == "":
            return None
        return value if isinstance(value, UUID) else UUID(str(value))

    @staticmethod
    def _normalize_json_object(value: Any) -> Optional[Dict[str, Any]]:
        """Return a JSON-serializable object, including for legacy rows stored as JSON strings."""
        if value is None:
            return None
        if isinstance(value, dict):
            return EmailEngineService._json_safe(value)
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                return None
            return EmailEngineService._json_safe(parsed) if isinstance(parsed, dict) else None
        return None

    def _record_blocked_placeholder_email_log(
        self,
        *,
        email: str,
        organization_id: UUID,
        template_key: Optional[str],
        subject: str,
        body_html: str,
        from_name: Optional[str],
        from_email: str,
        reply_to: Optional[str],
        template_data: Optional[Dict[str, Any]],
        user_id: Optional[UUID],
        priority: int,
        cc_emails: Optional[List[str]] = None,
        bcc_emails: Optional[List[str]] = None,
        queue_id: Optional[int] = None,
        batch_id: Optional[UUID] = None,
        batch_name: Optional[str] = None,
        attempts: int = 0,
        error_message: str = BLOCKED_PLACEHOLDER_EMAIL_REASON,
        error_code: str = "placeholder_recipient",
        error_details: Optional[Dict[str, Any]] = None,
        provider_message_id: Optional[str] = None,
        template_id: Optional[UUID] = None,
        max_attempts: int = 3,
    ) -> EmailLog:
        """Persist an audit row for a deliberately non-delivered email."""
        if error_details is None:
            if error_code == "placeholder_recipient":
                error_details = {
                    "reason": "placeholder_recipient",
                    "suffix": "@internal.invalid",
                    "delivered": False,
                }
            else:
                error_details = {
                    "reason": error_code,
                    "delivered": False,
                    "dry_run": error_code == BLOCKED_DELIVERY_DISABLED_CODE,
                }

        email_log = EmailLog(
            organization_id=organization_id,
            queue_id=queue_id,
            template_id=template_id,
            template_key=template_key,
            to_emails=[email],
            cc_emails=cc_emails,
            bcc_emails=bcc_emails,
            subject=subject,
            body_html=body_html,
            from_name=from_name,
            from_email=from_email,
            reply_to=reply_to,
            template_data=self._normalize_json_object(template_data),
            user_id=user_id,
            status="blocked",
            priority=priority,
            attempts=attempts,
            max_attempts=max_attempts,
            provider_message_id=provider_message_id,
            sent_at=None,
            error_message=error_message,
            error_code=error_code,
            error_details=self._normalize_json_object(error_details),
            batch_id=batch_id,
            batch_name=batch_name,
        )
        self.db.add(email_log)
        return email_log
    
    #********************************************************************************
    # Send Email
    #********************************************************************************
    def send_email(
        self,
        to_emails: List[str],
        template_key: Optional[str] = None,
        template_data: Optional[Dict[str, Any]] = None,
        organization_id: Optional[UUID] = None,
        custom_variables: Optional[Dict[str, Any]] = None,
        from_name: Optional[str] = None,
        from_email: Optional[str] = None,
        reply_to: Optional[str] = None,
        cc_emails: Optional[List[str]] = None,
        bcc_emails: Optional[List[str]] = None,
        priority: int = 5
    ) -> Dict[str, Any]:
        """
        Send email with contextual template variables
        
        Args:
            to_emails: List of recipient email addresses (will be used to query user data)
            template_key: Template key to fetch from database
            template_data: Direct template data (if template_key not provided)
            organization_id: Organization ID for context (from current_user)
            custom_variables: Additional custom variables
            from_name: Sender name (optional, will use org name if not provided)
            from_email: Sender email (optional, will use org email if not provided)
            reply_to: Reply-to email address
            cc_emails: CC email addresses
            bcc_emails: BCC email addresses
            priority: Email priority (1-10, higher = more urgent)
            
        Returns:
            Dict with 'method' (immediate/queued), 'count', and 'results'
        """
        method_logger = class_logger.get_method_logger("send_email")
        
        # Validate inputs
        if not to_emails:
            raise BadRequestError("At least one recipient email is required")
        
        if not organization_id:
            raise BadRequestError("Organization ID is required")
        
        email_count = len(to_emails)
        
        # Determine sending method based on threshold
        if email_count > self.threshold:
            # Use queue for bulk emails
            method_logger.info('Using queue for bulk emails', extra={'count': email_count})
            results = self._send_emails_via_queue(
                to_emails=to_emails,
                template_key=template_key,
                template_data=template_data,
                organization_id=organization_id,
                custom_variables=custom_variables,
                from_name=from_name,
                from_email=from_email,
                reply_to=reply_to,
                cc_emails=cc_emails,
                bcc_emails=bcc_emails,
                priority=priority
            )
            
            return {
                'method': 'queued',
                'count': email_count,
                'results': results
            }
        else:
            # Send immediately for small batches
            method_logger.info('Sending emails immediately', extra={'count': email_count})
            results = self._send_emails_immediately(
                to_emails=to_emails,
                template_key=template_key,
                template_data=template_data,
                organization_id=organization_id,
                custom_variables=custom_variables,
                from_name=from_name,
                from_email=from_email,
                reply_to=reply_to,
                cc_emails=cc_emails,
                bcc_emails=bcc_emails,
                priority=priority
            )
            
            return {
                'method': 'immediate',
                'count': email_count,
                'results': results
            }
    

   
    #********************************************************************************
    # Send Emails Immediately
    #********************************************************************************
    def _send_emails_immediately(
        self,
        to_emails: List[str],
        template_key: Optional[str] = None,
        template_data: Optional[Dict[str, Any]] = None,
        organization_id: Optional[UUID] = None,
        custom_variables: Optional[Dict[str, Any]] = None,
        from_name: Optional[str] = None,
        from_email: Optional[str] = None,
        reply_to: Optional[str] = None,
        cc_emails: Optional[List[str]] = None,
        bcc_emails: Optional[List[str]] = None,
        priority: int = 5
    ) -> List[Dict[str, Any]]:
        """Send emails immediately"""
        from sqlalchemy import func
        
        # Prepare template variables efficiently
        template_variables = self._prepare_template_variables(
            organization_id=organization_id,
            custom_variables=custom_variables
        )
        
        # Get organization-specific email configuration
        org_email_config = self._get_organization_email_config(organization_id)
                
        # Prepare email details (organization-specific)
        final_from_name = from_name or org_email_config['from_name']
        
        # From email priority: 
        # 1) Explicitly provided from_email
        # 2) If template_key is None (user-initiated from UI), use {DEFAULT_SENDER_FROM_EMAIL}
        # 3) Otherwise (system/transactional), use noreply@example.com
        if from_email and from_email.strip():
            final_from_email = from_email.strip()
        elif template_key is None:
            # User-initiated email from unified form - use {DEFAULT_SENDER_FROM_EMAIL}
            final_from_email = DEFAULT_SENDER_FROM_EMAIL
        else:
            # System/transactional email - use noreply@example.com
            final_from_email = org_email_config['from_email']
        
        final_reply_to = self._resolve_reply_to(
            reply_to,
            org_email_config['reply_to'],
        )

        # Get email provider (uses config.py automatically)
        provider = EmailProviderFactory.create_provider()
        
        # Iterate through each email address and send individually
        results = []
        
        for email in to_emails:
            try:
                # Get user-specific variables for this email
                user_variables = self._get_user_variables_for_email(email, organization_id)
                
                # Caller-provided template/custom variables win over recipient lookup
                personalized_variables = {**user_variables, **template_variables}
                
                # Render personalized content for this specific user
                personalized_content = self.renderer.render_email(
                    template_key=template_key,
                    template_data=template_data,
                    template_variables=personalized_variables,
                    organization_id=organization_id
                )

                if is_non_deliverable_recipient_email(email):
                    class_logger.info(
                        "Email blocked at send gate (placeholder recipient)",
                        extra={
                            "recipient": email,
                            "organization_id": str(organization_id),
                            "template_key": template_key,
                        },
                    )
                    results.append({
                        'email': email,
                        'blocked': True,
                        'success': {
                            'success': False,
                            'message_id': None,
                            'error_message': BLOCKED_PLACEHOLDER_EMAIL_REASON,
                            'error_code': 'placeholder_recipient',
                            'provider_response': None,
                        },
                        'recipients': 1,
                        'personalized_content': personalized_content,
                        'personalized_variables': personalized_variables,
                        'user_variables': user_variables,
                    })
                    continue
                
                # Create email message for this specific user
                to_addresses = [EmailAddress(email=email)]
                cc_addresses = [EmailAddress(email=email) for email in cc_emails] if cc_emails else None
                bcc_addresses = [EmailAddress(email=email) for email in bcc_emails] if bcc_emails else None
                
                message = EmailMessage(
                    to=to_addresses,
                    cc=cc_addresses,
                    bcc=bcc_addresses,
                    subject=personalized_content['subject'],
                    html_body=personalized_content['bodyHtml'],
                    text_body=personalized_content.get('bodyText'),
                    from_email=EmailAddress(email=final_from_email, name=final_from_name),
                    reply_to=EmailAddress(email=final_reply_to) if final_reply_to else None
                )
                
                # Send email
                send_result = provider.send_email(message)
                
                # Check if email sending was successful
                if not send_result.success:
                    error_msg = send_result.error_message or 'Unknown email sending error'
                    class_logger.error(f"Email sending failed for {email}: {error_msg}")
                    raise Exception(f"Failed to send email to {email}: {error_msg}")

                if _is_dry_run_provider_result(send_result):
                    # Delivery disabled is intentional (local/dev). Audit as blocked, but
                    # report success so callers (user create, welcome email, etc.) do not fail.
                    class_logger.info(
                        "Email dry-run (delivery disabled); logged without provider send",
                        extra={
                            "recipient": email,
                            "organization_id": str(organization_id),
                            "template_key": template_key,
                            "message_id": send_result.message_id,
                        },
                    )
                    results.append({
                        'email': email,
                        'blocked': True,
                        'blocked_reason': BLOCKED_DELIVERY_DISABLED_CODE,
                        'success': {
                            'success': True,
                            'message_id': send_result.message_id,
                            'error_message': BLOCKED_DELIVERY_DISABLED_REASON,
                            'error_code': BLOCKED_DELIVERY_DISABLED_CODE,
                            'provider_response': send_result.provider_response,
                        },
                        'recipients': 1,
                        'personalized_content': personalized_content,
                        'personalized_variables': personalized_variables,
                        'user_variables': user_variables,
                    })
                    continue
                
                results.append({
                    'email': email,
                    'success': {
                        'success': send_result.success,
                        'message_id': send_result.message_id,
                        'error_message': send_result.error_message,
                        'error_code': send_result.error_code,
                        'provider_response': send_result.provider_response
                    },
                    'recipients': 1
                })
                
            except Exception as e:
                class_logger.error(f"Error sending email to {email}: {str(e)}")
                raise Exception(f"Failed to send email to {email}: {str(e)}")
        
        # Create EmailLog entries directly (one per email)
        email_logs = []
        for result in results:
            email = result['email']
            success_data = result['success']
            is_blocked = bool(result.get('blocked'))
            is_success = success_data['success'] and not is_blocked

            if 'personalized_content' in result:
                personalized_content = result['personalized_content']
                personalized_variables = result['personalized_variables']
                user_variables = result['user_variables']
            else:
                user_variables = self._get_user_variables_for_email(email, organization_id)
                personalized_variables = {**user_variables, **template_variables}
                personalized_content = self.renderer.render_email(
                    template_key=template_key,
                    template_data=template_data,
                    template_variables=personalized_variables,
                    organization_id=organization_id
                )

            if is_blocked:
                blocked_reason = result.get("blocked_reason") or "placeholder_recipient"
                if blocked_reason == BLOCKED_DELIVERY_DISABLED_CODE:
                    email_log = self._record_blocked_placeholder_email_log(
                        email=email,
                        organization_id=organization_id,
                        template_key=template_key,
                        subject=personalized_content['subject'],
                        body_html=personalized_content['bodyHtml'],
                        from_name=final_from_name,
                        from_email=final_from_email,
                        reply_to=final_reply_to,
                        template_data=personalized_variables,
                        user_id=self._coerce_user_id(user_variables.get('userId')),
                        priority=priority,
                        cc_emails=cc_emails,
                        bcc_emails=bcc_emails,
                        attempts=0,
                        error_message=BLOCKED_DELIVERY_DISABLED_REASON,
                        error_code=BLOCKED_DELIVERY_DISABLED_CODE,
                        provider_message_id=success_data.get("message_id"),
                    )
                else:
                    email_log = self._record_blocked_placeholder_email_log(
                        email=email,
                        organization_id=organization_id,
                        template_key=template_key,
                        subject=personalized_content['subject'],
                        body_html=personalized_content['bodyHtml'],
                        from_name=final_from_name,
                        from_email=final_from_email,
                        reply_to=final_reply_to,
                        template_data=personalized_variables,
                        user_id=self._coerce_user_id(user_variables.get('userId')),
                        priority=priority,
                        cc_emails=cc_emails,
                        bcc_emails=bcc_emails,
                        attempts=0,
                    )
                email_logs.append(email_log)
                continue

            # Create EmailLog entry
            email_log = EmailLog(
            organization_id=organization_id,
            template_id=None,  # Will be set if template_key is used
            template_key=template_key,
            to_emails=[email],
            cc_emails=cc_emails,
            bcc_emails=bcc_emails,
            subject=personalized_content['subject'],
            body_html=personalized_content['bodyHtml'],
            from_name=final_from_name,
            from_email=final_from_email,
            reply_to=final_reply_to,
            template_data=self._normalize_json_object(personalized_variables),
            user_id=self._coerce_user_id(user_variables.get('userId')),
            status="sent" if is_success else "failed",
            priority=priority,
            attempts=1,
            max_attempts=3,
            provider_message_id=success_data.get('message_id'),
            sent_at=func.now() if is_success else None,
            error_message=success_data.get('error_message') if not is_success else None,
            error_code=success_data.get('error_code'),
            error_details={"error_code": success_data.get('error_code')} if success_data.get('error_code') else None,
            batch_id=None  # Immediate sends don't have batch
            )
            email_logs.append(email_log)
        
        # Add all email logs to database
        for log in email_logs:
            self.db.add(log)
        
        self.db.commit()
        
        # Refresh all logs
        for log in email_logs:
            self.db.refresh(log)
        
        return [{
            'log_id': str(log.id),
            'success': result['success'],
            'recipients': 1,
            'email': result['email']
        } for log, result in zip(email_logs, results)]
    



    #********************************************************************************
    # Send Emails via Queue
    #********************************************************************************
    def _send_emails_via_queue(
        self,
        to_emails: List[str],
        template_key: Optional[str] = None,
        template_data: Optional[Dict[str, Any]] = None,
        organization_id: Optional[UUID] = None,
        custom_variables: Optional[Dict[str, Any]] = None,
        from_name: Optional[str] = None,
        from_email: Optional[str] = None,
        reply_to: Optional[str] = None,
        cc_emails: Optional[List[str]] = None,
        bcc_emails: Optional[List[str]] = None,
        priority: int = 5
    ) -> List[EmailQueueResponse]:
        """Queue emails for background processing"""

        # Prepare template variables efficiently
        template_variables = self._prepare_template_variables(
            organization_id=organization_id,
            custom_variables=custom_variables
        )
        
        # Get organization-specific email configuration
        org_email_config = self._get_organization_email_config(organization_id)
        
        # Prepare email details (organization-specific)
        final_from_name = from_name or org_email_config['from_name']
        
        # From email priority: 
        # 1) Explicitly provided from_email
        # 2) If template_key is None (user-initiated from UI), use {DEFAULT_SENDER_FROM_EMAIL}
        # 3) Otherwise (system/transactional), use noreply@example.com
        if from_email and from_email.strip():
            final_from_email = from_email.strip()
        elif template_key is None:
            # User-initiated email from unified form - use {DEFAULT_SENDER_FROM_EMAIL}
            final_from_email = DEFAULT_SENDER_FROM_EMAIL
        else:
            # System/transactional email - use noreply@example.com
            final_from_email = org_email_config['from_email']
        
        final_reply_to = self._resolve_reply_to(
            reply_to,
            org_email_config['reply_to'],
        )

        # Iterate through each email address and create individual queue items
        queue_items = []
        
        for email in to_emails:
            # Get user-specific variables for this email
            user_variables = self._get_user_variables_for_email(email, organization_id)
            
            # Merge user variables with template variables
            personalized_variables = {**user_variables, **template_variables}
            
            # Render personalized content for this specific user
            personalized_content = self.renderer.render_email(
                template_key=template_key,
                template_data=template_data,
                template_variables=personalized_variables,
                organization_id=organization_id
            )

            if is_non_deliverable_recipient_email(email):
                class_logger.info(
                    "Email blocked at queue gate (placeholder recipient)",
                    extra={
                        "recipient": email,
                        "organization_id": str(organization_id),
                        "template_key": template_key,
                    },
                )
                self._record_blocked_placeholder_email_log(
                    email=email,
                    organization_id=organization_id,
                    template_key=template_key,
                    subject=personalized_content['subject'],
                    body_html=personalized_content['bodyHtml'],
                    from_name=final_from_name,
                    from_email=final_from_email,
                    reply_to=final_reply_to,
                    template_data=personalized_variables,
                    user_id=self._coerce_user_id(user_variables.get('userId')),
                    priority=priority,
                    cc_emails=cc_emails,
                    bcc_emails=bcc_emails,
                    attempts=0,
                )
                continue
            
            # Create individual queue item for this email
            queue_item = EmailQueue(
                organization_id=organization_id,
                template_key=template_key,
                to_emails=[email],  # Single email per queue item
                cc_emails=cc_emails,
                bcc_emails=bcc_emails,
                subject=personalized_content['subject'],
                body_html=personalized_content['bodyHtml'],
                from_name=final_from_name,
                from_email=final_from_email,
                reply_to=final_reply_to,
                template_data=self._normalize_json_object(personalized_variables),
                status="pending",
                priority=priority,
                attempts=0  # Not yet attempted
            )
            
            self.db.add(queue_item)
            queue_items.append(queue_item)
        
        self.db.commit()
        
        # Refresh all items
        for item in queue_items:
            self.db.refresh(item)
        
        return [EmailQueueResponse.model_validate(item) for item in queue_items]
 



    #********************************************************************************
    # Process Email Queue
    #********************************************************************************
    @staticmethod
    def _email_queue_processing_stale_cutoff(now: datetime) -> datetime:
        return now - timedelta(seconds=EMAIL_QUEUE_PROCESSING_STALE_AFTER_SECONDS)

    @staticmethod
    def claim_next_email_queue_item(
        db: Session,
        *,
        organization_id: UUID,
        now: Optional[datetime] = None,
    ) -> Optional[EmailQueue]:
        method_logger = class_logger.get_method_logger("claim_next_email_queue_item")
        current_time = now or datetime.now(timezone.utc)
        stale_cutoff = EmailEngineService._email_queue_processing_stale_cutoff(current_time)
        queue_item = (
            db.query(EmailQueue)
            .filter(
                EmailQueue.organization_id == organization_id,
                or_(
                    EmailQueue.status == "pending",
                    and_(
                        EmailQueue.status == "failed",
                        EmailQueue.attempts < EmailQueue.max_attempts,
                    ),
                    and_(
                        EmailQueue.status == "processing",
                        EmailQueue.updated_at < stale_cutoff,
                    ),
                ),
            )
            .order_by(EmailQueue.priority.asc(), EmailQueue.created_at.asc())
            .with_for_update(skip_locked=True)
            .first()
        )
        if not queue_item:
            return None
        if queue_item.status == "processing":
            method_logger.warning(
                "Reclaiming stale email queue item",
                extra={
                    "queue_id": str(queue_item.id),
                    "updated_at": queue_item.updated_at.isoformat()
                    if queue_item.updated_at
                    else None,
                    "stale_after_seconds": EMAIL_QUEUE_PROCESSING_STALE_AFTER_SECONDS,
                },
            )
        queue_item.status = "processing"
        queue_item.updated_at = current_time
        db.flush()
        return queue_item

    def _process_claimed_email_queue_item(self, queue_item: EmailQueue, method_logger) -> bool:
        """
        Send one claimed queue item. Returns True when the email was sent successfully.
        """
        to_emails = queue_item.to_emails or []
        cc_emails = queue_item.cc_emails or []
        bcc_emails = queue_item.bcc_emails or []

        if len(to_emails) != 1:
            method_logger.error(
                "Invalid queue item: expected exactly one recipient",
                extra={
                    "queue_id": str(queue_item.id),
                    "recipient_count": len(to_emails),
                },
            )
            queue_item.status = "failed"
            queue_item.error_message = f"Expected exactly one recipient, got {len(to_emails)}"
            queue_item.last_attempt_at = func.now()
            return False

        recipient = to_emails[0]
        if is_non_deliverable_recipient_email(recipient):
            method_logger.info(
                "Email blocked at queue processor gate (placeholder recipient)",
                extra={"queue_id": str(queue_item.id), "recipient": recipient},
            )
            self._record_blocked_placeholder_email_log(
                email=recipient,
                organization_id=queue_item.organization_id,
                template_key=queue_item.template_key,
                subject=queue_item.subject,
                body_html=queue_item.body_html,
                from_name=queue_item.from_name,
                from_email=queue_item.from_email,
                reply_to=queue_item.reply_to,
                template_data=self._normalize_json_object(queue_item.template_data),
                user_id=None,
                priority=queue_item.priority,
                cc_emails=queue_item.cc_emails,
                bcc_emails=queue_item.bcc_emails,
                queue_id=queue_item.id,
                batch_id=queue_item.batch_id,
                batch_name=queue_item.batch_name,
                attempts=queue_item.attempts,
            )
            # Terminal state: intentionally not delivered (do not retry)
            self.db.delete(queue_item)
            return True

        to_addresses = [EmailAddress(email=recipient)]
        cc_addresses = [EmailAddress(email=email) for email in cc_emails] if cc_emails else None
        bcc_addresses = [EmailAddress(email=email) for email in bcc_emails] if bcc_emails else None

        message = EmailMessage(
            to=to_addresses,
            cc=cc_addresses,
            bcc=bcc_addresses,
            subject=queue_item.subject,
            html_body=queue_item.body_html,
            from_email=EmailAddress(
                email=queue_item.from_email,
                name=queue_item.from_name or "Platform",
            ),
            reply_to=EmailAddress(email=queue_item.reply_to) if queue_item.reply_to else None,
        )

        provider = EmailProviderFactory.create_provider()
        queue_item.attempts += 1

        try:
            send_result = provider.send_email(message)

            if send_result.success:
                if _is_dry_run_provider_result(send_result):
                    method_logger.info(
                        "Email blocked at queue processor gate (delivery disabled)",
                        extra={
                            "queue_id": str(queue_item.id),
                            "recipient": to_emails[0],
                            "message_id": send_result.message_id,
                            "attempts": queue_item.attempts,
                        },
                    )
                    self._record_blocked_placeholder_email_log(
                        email=recipient,
                        organization_id=queue_item.organization_id,
                        template_key=queue_item.template_key,
                        subject=queue_item.subject,
                        body_html=queue_item.body_html,
                        from_name=queue_item.from_name,
                        from_email=queue_item.from_email,
                        reply_to=queue_item.reply_to,
                        template_data=self._normalize_json_object(queue_item.template_data),
                        user_id=None,
                        priority=queue_item.priority,
                        cc_emails=queue_item.cc_emails,
                        bcc_emails=queue_item.bcc_emails,
                        queue_id=queue_item.id,
                        batch_id=queue_item.batch_id,
                        batch_name=queue_item.batch_name,
                        attempts=queue_item.attempts,
                        error_message=BLOCKED_DELIVERY_DISABLED_REASON,
                        error_code=BLOCKED_DELIVERY_DISABLED_CODE,
                        provider_message_id=send_result.message_id,
                        template_id=queue_item.template_id,
                        max_attempts=queue_item.max_attempts,
                    )
                    self.db.delete(queue_item)
                    return True

                email_log = EmailLog(
                    organization_id=queue_item.organization_id,
                    queue_id=queue_item.id,
                    template_id=queue_item.template_id,
                    template_key=queue_item.template_key,
                    to_emails=to_emails,
                    cc_emails=queue_item.cc_emails,
                    bcc_emails=queue_item.bcc_emails,
                    subject=queue_item.subject,
                    body_html=queue_item.body_html,
                    from_name=queue_item.from_name,
                    from_email=queue_item.from_email,
                    reply_to=queue_item.reply_to,
                    template_data=self._normalize_json_object(queue_item.template_data),
                    user_id=None,
                    status="sent",
                    priority=queue_item.priority,
                    attempts=queue_item.attempts,
                    max_attempts=queue_item.max_attempts,
                    provider_message_id=send_result.message_id,
                    sent_at=func.now(),
                    batch_id=queue_item.batch_id,
                    batch_name=queue_item.batch_name,
                )
                self.db.add(email_log)
                self.db.delete(queue_item)
                method_logger.info(
                    "Email sent successfully, moved to logs",
                    extra={
                        "queue_id": str(queue_item.id),
                        "recipient": to_emails[0],
                        "message_id": send_result.message_id,
                        "attempts": queue_item.attempts,
                    },
                )
                return True

            queue_item.status = "failed"
            queue_item.error_message = send_result.error_message or "Failed to send email"
            queue_item.error_details = (
                {"error_code": send_result.error_code}
                if send_result.error_code
                else None
            )
            if queue_item.attempts < queue_item.max_attempts:
                method_logger.warn(
                    "Email sending failed, will retry on next scheduler run",
                    extra={
                        "queue_id": str(queue_item.id),
                        "recipient": to_emails[0],
                        "attempts": queue_item.attempts,
                        "max_attempts": queue_item.max_attempts,
                        "error_message": send_result.error_message,
                        "error_code": send_result.error_code,
                    },
                )
            else:
                email_log = EmailLog(
                    organization_id=queue_item.organization_id,
                    queue_id=queue_item.id,
                    template_id=queue_item.template_id,
                    template_key=queue_item.template_key,
                    to_emails=to_emails,
                    cc_emails=queue_item.cc_emails,
                    bcc_emails=queue_item.bcc_emails,
                    subject=queue_item.subject,
                    body_html=queue_item.body_html,
                    from_name=queue_item.from_name,
                    from_email=queue_item.from_email,
                    reply_to=queue_item.reply_to,
                    template_data=self._normalize_json_object(queue_item.template_data),
                    user_id=None,
                    status="failed",
                    priority=queue_item.priority,
                    attempts=queue_item.attempts,
                    max_attempts=queue_item.max_attempts,
                    provider_message_id=None,
                    sent_at=None,
                    error_message=send_result.error_message
                    or "Failed to send email after maximum attempts",
                    error_code=send_result.error_code,
                    error_details={"error_code": send_result.error_code}
                    if send_result.error_code
                    else None,
                    batch_id=queue_item.batch_id,
                    batch_name=queue_item.batch_name,
                )
                self.db.add(email_log)
                self.db.delete(queue_item)
                method_logger.error(
                    "Email sending failed permanently, moved to logs",
                    extra={
                        "queue_id": str(queue_item.id),
                        "recipient": to_emails[0],
                        "attempts": queue_item.attempts,
                        "max_attempts": queue_item.max_attempts,
                        "error_message": send_result.error_message,
                        "error_code": send_result.error_code,
                    },
                )
        except Exception as send_error:
            queue_item.status = "failed"
            queue_item.error_message = f"Send error: {str(send_error)}"
            if queue_item.attempts < queue_item.max_attempts:
                method_logger.warn(
                    "Email sending error, will retry on next scheduler run",
                    extra={
                        "queue_id": str(queue_item.id),
                        "recipient": to_emails[0],
                        "attempts": queue_item.attempts,
                        "max_attempts": queue_item.max_attempts,
                        "error": str(send_error),
                    },
                )
            else:
                email_log = EmailLog(
                    organization_id=queue_item.organization_id,
                    queue_id=queue_item.id,
                    template_id=queue_item.template_id,
                    template_key=queue_item.template_key,
                    to_emails=to_emails,
                    cc_emails=queue_item.cc_emails,
                    bcc_emails=queue_item.bcc_emails,
                    subject=queue_item.subject,
                    body_html=queue_item.body_html,
                    from_name=queue_item.from_name,
                    from_email=queue_item.from_email,
                    reply_to=queue_item.reply_to,
                    template_data=self._normalize_json_object(queue_item.template_data),
                    user_id=None,
                    status="failed",
                    priority=queue_item.priority,
                    attempts=queue_item.attempts,
                    max_attempts=queue_item.max_attempts,
                    provider_message_id=None,
                    sent_at=None,
                    error_message=f"Send error after maximum attempts: {str(send_error)}",
                    error_code=None,
                    error_details={"error": str(send_error)},
                    batch_id=queue_item.batch_id,
                    batch_name=queue_item.batch_name,
                )
                self.db.add(email_log)
                self.db.delete(queue_item)
                method_logger.error(
                    "Email sending error permanently failed, moved to logs",
                    extra={
                        "queue_id": str(queue_item.id),
                        "recipient": to_emails[0],
                        "attempts": queue_item.attempts,
                        "max_attempts": queue_item.max_attempts,
                        "error": str(send_error),
                    },
                )

        if not inspect(queue_item).deleted:
            queue_item.last_attempt_at = func.now()
        return False

    def process_email_queue(self, organization_id: UUID, limit: int = 10) -> int:
        """
        Process queued emails one by one
        
        Each queue item contains exactly one email address and is processed individually.
        This allows for personalized content and individual error tracking.
        
        Args:
            organization_id: Organization ID to process emails for
            limit: Maximum number of emails to process in this batch
            
        Returns:
            Number of emails processed
        """
        method_logger = class_logger.get_method_logger("process_email_queue")
        processed_count = 0
        claimed_count = 0
        now = datetime.now(timezone.utc)

        while processed_count < limit:
            queue_item = self.claim_next_email_queue_item(
                self.db,
                organization_id=organization_id,
                now=now,
            )
            if not queue_item:
                break

            claimed_count += 1
            self.db.commit()

            try:
                if self._process_claimed_email_queue_item(queue_item, method_logger):
                    processed_count += 1
            except Exception as exc:
                queue_item.status = "failed"
                queue_item.attempts += 1
                queue_item.error_message = str(exc)
                queue_item.last_attempt_at = func.now()
                method_logger.error(
                    "Error processing queue item",
                    extra={
                        "queue_id": str(queue_item.id),
                        "recipient": (queue_item.to_emails or ["unknown"])[0],
                        "error": str(exc),
                        "attempts": queue_item.attempts,
                    },
                )
            self.db.commit()

        method_logger.info(
            "Email queue processing completed",
            extra={
                "processed_count": processed_count,
                "claimed_count": claimed_count,
            },
        )

        return processed_count
    
    



    #********************************************************************************
    # Template Variable Preparation Methods
    #********************************************************************************
    def _prepare_template_variables(
        self,
        organization_id: Optional[UUID] = None,
        custom_variables: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Prepare org and custom template variables."""
        variables = {}

        if organization_id:
            org_vars = self._get_organization_variables(organization_id)
            variables.update(org_vars)
            org_config = self._get_organization_email_config(organization_id)
            variables["replyToEmail"] = self._resolve_reply_to(
                None,
                org_config["reply_to"],
            )

        if custom_variables:
            variables.update(custom_variables)

        return variables

    def _get_organization_variables(self, organization_id: UUID) -> Dict[str, Any]:
        """Get organization-specific template variables"""
        try:
            from app.v1.organizations.model import Organization
            
            org = self.db.query(Organization).filter(Organization.id == organization_id).first()
            if not org:
                return {
                    'organizationName': 'Unknown Organization',
                    'organizationUrl': '',
                    'loginUrl': '',
                    'organizationEmail': DEFAULT_SYSTEM_FROM_EMAIL
                }
            
            return {
                'organizationName': org.name or 'Unknown Organization',
                'organizationUrl': f"https://{org.domain}" if org.domain else '',
                'loginUrl': f"https://{org.domain}/login" if org.domain else '',
                'organizationEmail': org.admin_email if org.admin_email else DEFAULT_SYSTEM_FROM_EMAIL
            }
        except Exception:
            # Fallback if there are import issues
            return {
                'organizationName': 'Unknown Organization',
                'organizationUrl': '',
                'loginUrl': '',
                'organizationEmail': DEFAULT_SYSTEM_FROM_EMAIL
            }

    def _get_organization_email_config(self, organization_id: UUID) -> Dict[str, str]:
        """Get organization-specific email configuration"""
        from app.v1.organizations.model import Organization
        
        org = self.db.query(Organization).filter(Organization.id == organization_id).first()
        if not org:
            return {
                'from_name': 'Platform',
                'from_email': DEFAULT_SYSTEM_FROM_EMAIL,
                'reply_to': DEFAULT_SYSTEM_FROM_EMAIL
            }
        
        # Use organization's admin_email as reply-to if available, otherwise use default
        reply_to = org.admin_email if org.admin_email else DEFAULT_SYSTEM_FROM_EMAIL
        
        return {
            'from_name': org.name or 'Platform',
            'from_email': DEFAULT_SYSTEM_FROM_EMAIL,
            'reply_to': reply_to
        }

    def _resolve_reply_to(
        self,
        explicit_reply_to: Optional[str],
        org_default_reply_to: str,
    ) -> str:
        """Reply-To resolution: explicit arg > org default."""
        if explicit_reply_to and explicit_reply_to.strip():
            return explicit_reply_to.strip()
        return org_default_reply_to

    def _get_user_variables_for_email(self, email: str, organization_id: Optional[UUID]) -> Dict[str, Any]:
        """Get user-specific template variables for a single email address"""
        try:
            from app.v1.users.model import User
            
            # Query user by email address within the organization
            query = self.db.query(User).filter(func.lower(User.email) == (email or "").lower().strip())
            if organization_id:
                query = query.filter(User.organization_id == organization_id)
            
            user = query.first()
            
            if not user:
                return {
                    'firstName': 'User',
                    'lastName': 'Not Found',
                    'email': email,
                    'fullName': 'User Not Found',
                    'userCount': 0
                }
            
            full_name = f"{user.first_name or ''} {user.last_name or ''}".strip()
            if not full_name:
                full_name = user.email or 'User'
            
            return {
                'firstName': user.first_name or 'User',
                'lastName': user.last_name or 'User',
                'email': user.email,
                'fullName': full_name,
                'userId': str(user.id),
                'userCount': 1
            }
        except Exception:
            # Fallback if there are import issues
            return {
                'firstName': 'User',
                'lastName': 'Unknown',
                'email': email,
                'fullName': 'User Unknown',
                'userCount': 1
            }


    

    




    #********************************************************************************
    # Get Email Queue
    #********************************************************************************
    def get_email_queue(
        self,
        organization_id: str,
        skip: int = 0,
        limit: int = 100,
        status_filter: Optional[str] = None
    ) -> Tuple[List[EmailQueueResponse], int]:
        """Get email queue with optional filtering"""
        method_logger = class_logger.get_method_logger("get_email_queue")
        method_logger.info('Getting email queue', extra={
            'organization_id': organization_id,
            'skip': skip,
            'limit': limit,
            'status_filter': status_filter
        })

        query = self.db.query(EmailQueue).filter(
            EmailQueue.organization_id == organization_id
        )

        if status_filter:
            query = query.filter(EmailQueue.status == status_filter)

        total_count = query.count()
        queue_items = query.order_by(EmailQueue.created_at.desc()).offset(skip).limit(limit).all()

        method_logger.info('Email queue retrieved', extra={
            'count': len(queue_items),
            'total_count': total_count
        })

        # Normalize legacy rows that stored JSONB objects as serialized strings.
        response_items = []
        for item in queue_items:
            item.template_data = self._normalize_json_object(item.template_data)
            item.error_details = self._normalize_json_object(item.error_details)
            response_items.append(EmailQueueResponse.model_validate(item))

        return response_items, total_count

    #********************************************************************************
    # Get Email Logs
    #********************************************************************************
    def get_email_logs(
        self,
        organization_id: str,
        skip: int = 0,
        limit: int = 100,
        status_filter: Optional[str] = None,
        status_filters: Optional[List[str]] = None,
        template_id: Optional[UUID] = None,
        search_term: Optional[str] = None
    ) -> Tuple[List[EmailLogResponse], int]:
        """Get email logs with optional filtering"""
        method_logger = class_logger.get_method_logger("get_email_logs")
        method_logger.info('Getting email logs', extra={
            'organization_id': organization_id,
            'skip': skip,
            'limit': limit,
            'status_filter': status_filter,
            'template_id': str(template_id) if template_id else None,
            'search_term': search_term
        })

        query = self.db.query(EmailLog).filter(
            EmailLog.organization_id == organization_id
        )

        if status_filters and len(status_filters) > 0:
            # Filter out "all" if present
            filtered_statuses = [s for s in status_filters if s != "all"]
            if filtered_statuses:
                query = query.filter(EmailLog.status.in_(filtered_statuses))
        elif status_filter and status_filter != "all":
            query = query.filter(EmailLog.status == status_filter)
        
        if template_id:
            query = query.filter(EmailLog.template_id == template_id)
        
        if search_term:
            # Search in subject, to_emails, and template_key
            search_filter = or_(
                EmailLog.subject.ilike(f"%{search_term}%"),
                EmailLog.template_key.ilike(f"%{search_term}%"),
                func.array_to_string(EmailLog.to_emails, ',').ilike(f"%{search_term}%")
            )
            query = query.filter(search_filter)

        total_count = query.count()
        logs = query.order_by(EmailLog.sent_at.desc()).offset(skip).limit(limit).all()

        method_logger.info('Email logs retrieved', extra={
            'count': len(logs),
            'total_count': total_count
        })

        response_logs: List[EmailLogResponse] = []
        for log in logs:
            # Some legacy rows store JSONB objects as serialized strings.
            log.template_data = self._normalize_json_object(log.template_data)
            log.error_details = self._normalize_json_object(log.error_details)
            response_logs.append(EmailLogResponse.model_validate(log))

        return response_logs, total_count

    #********************************************************************************
    # Get Email Analytics
    #********************************************************************************
    def get_email_analytics(self, organization_id: str) -> Dict[str, Any]:
        """Get email analytics and statistics"""
        method_logger = class_logger.get_method_logger("get_email_analytics")
        method_logger.info('Getting email analytics', extra={
            'organization_id': organization_id
        })

        # Get total emails sent
        total_emails = self.db.query(func.count(EmailLog.id)).filter(
            EmailLog.organization_id == organization_id
        ).scalar() or 0

        # Get emails by status
        status_counts = self.db.query(
            EmailLog.status,
            func.count(EmailLog.id)
        ).filter(
            EmailLog.organization_id == organization_id
        ).group_by(EmailLog.status).all()

        status_stats = {status: count for status, count in status_counts}

        # Get emails by template
        template_stats = self.db.query(
            EmailLog.template_id,
            func.count(EmailLog.id)
        ).filter(
            EmailLog.organization_id == organization_id
        ).group_by(EmailLog.template_id).all()

        # Calculate rates
        # 'sent' = successfully sent to MailerSend
        # 'delivered' = confirmed delivered by MailerSend webhook
        # 'bounced' = confirmed bounced by MailerSend webhook
        sent = status_stats.get('sent', 0)
        delivered = status_stats.get('delivered', 0)
        bounced = status_stats.get('bounced', 0)
        failed = status_stats.get('failed', 0)
        blocked = status_stats.get('blocked', 0)
        opened = status_stats.get('opened', 0)
        clicked = status_stats.get('clicked', 0)

        # Delivery rate = only emails confirmed as delivered by webhook
        delivery_rate = (delivered / total_emails * 100) if total_emails > 0 else 0
        # Bounce rate = only emails confirmed as bounced by webhook
        bounce_rate = (bounced / total_emails * 100) if total_emails > 0 else 0
        # Failure rate = emails that failed to send to MailerSend
        failure_rate = (failed / total_emails * 100) if total_emails > 0 else 0
        # Open/click rates = based on delivered emails only
        open_rate = (opened / delivered * 100) if delivered > 0 else 0
        click_rate = (clicked / delivered * 100) if delivered > 0 else 0

        analytics = {
            "totalEmails": total_emails,
            "sent": sent,
            "delivered": delivered,
            "bounced": bounced,
            "failed": failed,
            "blocked": blocked,
            "opened": opened,
            "clicked": clicked,
            "deliveryRate": round(delivery_rate, 2),
            "bounceRate": round(bounce_rate, 2),
            "failureRate": round(failure_rate, 2),
            "openRate": round(open_rate, 2),
            "clickRate": round(click_rate, 2),
            "statusBreakdown": status_stats,
            "templateUsage": [
                {"templateId": str(tid), "count": count} 
                for tid, count in template_stats
            ]
        }

        method_logger.info('Email analytics retrieved', extra={
            'total_emails': total_emails,
            'delivery_rate': delivery_rate
        })

        return analytics
