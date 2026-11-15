"""
Email Webhook Service
Handles MailerSend webhook events for bounce detection and email tracking
"""

from typing import Dict, Any, Optional
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.common.app_logger import get_logger
from app.v1.email_engine.model import EmailLog, EmailQueue

class_logger = get_logger(__name__)


class EmailWebhookService:
    """Service for handling MailerSend webhook events"""
    
    @staticmethod
    async def process_webhook_event(
        db: Session,
        event_data: Dict[str, Any]
    ) -> bool:
        """Process MailerSend webhook event"""
        method_logger = class_logger.get_method_logger('process_webhook_event')
        
        try:
            event_type = event_data.get('type')
            method_logger.info('Processing webhook event', extra={
                'event_type': event_type,
                'event_id': event_data.get('id')
            })
            
            if event_type == 'email.bounced':
                return await EmailWebhookService._handle_bounce_event(db, event_data)
            elif event_type == 'email.delivered':
                return await EmailWebhookService._handle_delivered_event(db, event_data)
            elif event_type == 'email.opened':
                return await EmailWebhookService._handle_opened_event(db, event_data)
            elif event_type == 'email.clicked':
                return await EmailWebhookService._handle_clicked_event(db, event_data)
            elif event_type == 'email.complained':
                return await EmailWebhookService._handle_complaint_event(db, event_data)
            else:
                method_logger.info('Unhandled event type', extra={'event_type': event_type})
                return False
                
        except Exception as e:
            method_logger.error('Error processing webhook event', e, extra={
                'event_data': event_data
            })
            return False
    
    @staticmethod
    async def _handle_bounce_event(db: Session, event_data: Dict[str, Any]) -> bool:
        """Handle email bounce event"""
        method_logger = class_logger.get_method_logger('_handle_bounce_event')
        
        try:
            # Extract data from webhook
            data = event_data.get('data', {})
            message_id = data.get('message_id')
            recipient = data.get('recipient', {})
            recipient_email = recipient.get('email')
            bounce_data = data.get('bounce', {})
            bounce_type = bounce_data.get('type')  # 'hard' or 'soft'
            bounce_reason = bounce_data.get('reason')
            
            method_logger.info('Processing bounce event', extra={
                'message_id': message_id,
                'recipient': recipient_email,
                'bounce_type': bounce_type,
                'bounce_reason': bounce_reason
            })
            
            if not message_id:
                method_logger.warn('No message_id in bounce event')
                return False
            
            # Find the email log by provider_message_id
            email_log = db.query(EmailLog).filter(
                EmailLog.provider_message_id == message_id
            ).first()
            
            if not email_log:
                method_logger.warn('Email log not found for message_id', extra={
                    'message_id': message_id
                })
                return False
            
            # Update email log with bounce information
            email_log.status = 'bounced'
            email_log.bounced_at = func.now()
            email_log.bounce_type = bounce_type
            email_log.bounce_reason = bounce_reason
            email_log.updated_at = func.now()
            
            # Also update the queue item if it exists
            if email_log.queue_id:
                queue_item = db.query(EmailQueue).filter(
                    EmailQueue.id == email_log.queue_id
                ).first()
                if queue_item:
                    queue_item.status = 'failed'
                    queue_item.error_message = f"Bounced ({bounce_type}): {bounce_reason}"
                    queue_item.updated_at = func.now()
            
            db.commit()
            
            method_logger.info('Bounce event processed successfully', extra={
                'email_log_id': str(email_log.id),
                'queue_id': str(email_log.queue_id) if email_log.queue_id else None
            })
            
            return True
                
        except Exception as e:
            method_logger.error('Error handling bounce event', e, extra={
                'event_data': event_data
            })
            db.rollback()
            return False
    
    @staticmethod
    async def _handle_delivered_event(db: Session, event_data: Dict[str, Any]) -> bool:
        """Handle email delivered event"""
        method_logger = class_logger.get_method_logger('_handle_delivered_event')
        
        try:
            data = event_data.get('data', {})
            message_id = data.get('message_id')
            
            if not message_id:
                return False
            
            # Find the email log by provider_message_id
            email_log = db.query(EmailLog).filter(
                EmailLog.provider_message_id == message_id
            ).first()
            
            if email_log:
                email_log.status = 'delivered'
                email_log.delivered_at = func.now()
                email_log.updated_at = func.now()
                db.commit()
                
                method_logger.info('Email delivered', extra={
                    'email_log_id': str(email_log.id),
                    'message_id': message_id
                })
                return True
                
        except Exception as e:
            method_logger.error('Error handling delivered event', e)
            db.rollback()
            
        return False
    
    @staticmethod
    async def _handle_opened_event(db: Session, event_data: Dict[str, Any]) -> bool:
        """Handle email opened event"""
        method_logger = class_logger.get_method_logger('_handle_opened_event')
        
        try:
            data = event_data.get('data', {})
            message_id = data.get('message_id')
            user_agent = data.get('user_agent')
            ip_address = data.get('ip')
            
            if not message_id:
                return False
            
            # Find the email log by provider_message_id
            email_log = db.query(EmailLog).filter(
                EmailLog.provider_message_id == message_id
            ).first()
            
            if email_log:
                # Update open tracking
                if not email_log.opened_at:
                    email_log.opened_at = func.now()
                
                email_log.open_count = (email_log.open_count or 0) + 1
                email_log.user_agent = user_agent
                email_log.ip_address = ip_address
                email_log.updated_at = func.now()
                db.commit()
                
                method_logger.info('Email opened', extra={
                    'email_log_id': str(email_log.id),
                    'open_count': email_log.open_count
                })
                return True
                
        except Exception as e:
            method_logger.error('Error handling opened event', e)
            db.rollback()
            
        return False
    
    @staticmethod
    async def _handle_clicked_event(db: Session, event_data: Dict[str, Any]) -> bool:
        """Handle email clicked event"""
        method_logger = class_logger.get_method_logger('_handle_clicked_event')
        
        try:
            data = event_data.get('data', {})
            message_id = data.get('message_id')
            user_agent = data.get('user_agent')
            ip_address = data.get('ip')
            url = data.get('url')
            
            if not message_id:
                return False
            
            # Find the email log by provider_message_id
            email_log = db.query(EmailLog).filter(
                EmailLog.provider_message_id == message_id
            ).first()
            
            if email_log:
                # Update click tracking
                if not email_log.first_clicked_at:
                    email_log.first_clicked_at = func.now()
                
                email_log.click_count = (email_log.click_count or 0) + 1
                email_log.user_agent = user_agent
                email_log.ip_address = ip_address
                email_log.updated_at = func.now()
                db.commit()
                
                method_logger.info('Email clicked', extra={
                    'email_log_id': str(email_log.id),
                    'click_count': email_log.click_count,
                    'url': url
                })
                return True
                
        except Exception as e:
            method_logger.error('Error handling clicked event', e)
            db.rollback()
            
        return False
    
    @staticmethod
    async def _handle_complaint_event(db: Session, event_data: Dict[str, Any]) -> bool:
        """Handle email complaint (spam) event"""
        method_logger = class_logger.get_method_logger('_handle_complaint_event')
        
        try:
            data = event_data.get('data', {})
            message_id = data.get('message_id')
            complaint_data = data.get('complaint', {})
            feedback_type = complaint_data.get('feedback_type')
            
            if not message_id:
                return False
            
            # Find the email log by provider_message_id
            email_log = db.query(EmailLog).filter(
                EmailLog.provider_message_id == message_id
            ).first()
            
            if email_log:
                email_log.status = 'complained'
                email_log.complained_at = func.now()
                email_log.complaint_feedback_type = feedback_type
                email_log.updated_at = func.now()
                db.commit()
                
                method_logger.info('Email complaint received', extra={
                    'email_log_id': str(email_log.id),
                    'feedback_type': feedback_type
                })
                return True
                
        except Exception as e:
            method_logger.error('Error handling complaint event', e)
            db.rollback()
            
        return False


























