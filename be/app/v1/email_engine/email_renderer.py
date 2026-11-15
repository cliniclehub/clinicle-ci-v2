"""
Email Renderer Service
Handles dynamic email rendering with context-aware template variables
"""

from typing import Optional, Dict, Any, List
from uuid import UUID
from sqlalchemy.orm import Session
from jinja2 import Template, TemplateSyntaxError

from app.common.business_exceptions import BadRequestError, NotFoundError
from app.common.app_logger import get_logger

class_logger = get_logger(__name__)


class EmailRenderer:
    """
    Email renderer that dynamically fetches template variables based on provided IDs
    and renders emails with rich context
    """
    
    def __init__(self, db: Session):
        self.db = db
    
    def render_email(
        self,
        template_key: Optional[str] = None,
        template_data: Optional[Dict[str, Any]] = None,
        template_variables: Optional[Dict[str, Any]] = None,
        organization_id: Optional[UUID] = None
    ) -> Dict[str, str]:
        """
        Render email template with provided variables
        
        Args:
            template_key: Key to fetch template from database (optional if template_data provided)
            template_data: Direct template data (required if template_key not provided)
            template_variables: Pre-prepared variables for template rendering
            organization_id: Organization ID to fetch org-specific template (required when template_key used)
            
        Returns:
            Dict with 'subject', 'body_html', 'body_text' keys
        """
        method_logger = class_logger.get_method_logger("render_email")
        
        # Validate input
        if not template_key and not template_data:
            raise BadRequestError("Either template_key or template_data must be provided")
        
        if template_key and template_data:
            raise BadRequestError("Cannot provide both template_key and template_data")
        
        # Get template data (org-specific when organization_id provided)
        if template_key:
            template_data = self._get_template_by_key(template_key, organization_id)
        
        # Use provided variables or empty dict
        variables = template_variables or {}
        
        method_logger.info('Rendering email', extra={
            'template_key': template_key,
            'variables_count': len(variables)
        })
        
        # Render template
        try:
            rendered_subject = self._render_template(template_data.get('subject', ''), variables)
            rendered_html = self._render_template(template_data.get('bodyHtml', ''), variables)
            rendered_text = self._render_template(template_data.get('bodyText', ''), variables) if template_data.get('bodyText') else None
            
            return {
                'subject': rendered_subject,
                'bodyHtml': rendered_html,
                'bodyText': rendered_text
            }
            
        except Exception as e:
            method_logger.error('Email rendering failed', extra={
                'error': str(e),
                'template_key': template_key
            })
            raise BadRequestError(f"Email rendering failed: {str(e)}")
    
    def _get_template_by_key(self, template_key: str, organization_id: Optional[UUID] = None) -> Dict[str, Any]:
        """Get template data by key, optionally scoped to organization"""
        from app.v1.email_templates.model import EmailTemplate
        
        query = self.db.query(EmailTemplate).filter(
            EmailTemplate.template_key == template_key,
            EmailTemplate.is_active == True
        )
        if organization_id:
            query = query.filter(EmailTemplate.organization_id == organization_id)
        template = query.first()
        
        if not template:
            raise NotFoundError(f"Template with key '{template_key}' not found")
        
        return {
            'subject': template.subject,
            'bodyHtml': template.body_html,
            'bodyText': template.body_text
        }
    
    
    def _render_template(self, template_content: str, variables: Dict[str, Any]) -> str:
        """Render Jinja2 template with variables"""
        if not template_content:
            return ""
        
        try:
            template = Template(template_content)
            return template.render(**variables)
        except TemplateSyntaxError as e:
            raise BadRequestError(f"Template syntax error: {str(e)}")
        except Exception as e:
            raise BadRequestError(f"Template rendering error: {str(e)}")
    

