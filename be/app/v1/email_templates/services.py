"""
Email Templates Services
Handles email template CRUD operations
"""

from typing import List, Optional, Dict, Any
from uuid import UUID
import json
from pathlib import Path
from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import and_, func

from .model import EmailTemplate as EmailTemplateModel
from .schema import EmailTemplateCreate, EmailTemplateUpdate, EmailTemplateResponse
from app.common.app_logger import get_logger

class_logger = get_logger(__name__)

class EmailTemplateService:
    """Service for email template management - CRUD operations only"""

    def __init__(self, db: Session):
        self.db = db

    @classmethod
    def _load_default_templates(cls) -> List[dict]:
        templates_file = Path(__file__).parent / "default_templates.json"
        with open(templates_file, "r", encoding="utf-8") as f:
            return json.load(f)

    @classmethod
    def _get_default_template_definition(cls, template_key: str) -> Optional[dict]:
        return next(
            (t for t in cls._load_default_templates() if t.get("template_key") == template_key),
            None,
        )

    def _resolve_restore_template_key(self, template: EmailTemplateModel) -> str:
        if self._get_default_template_definition(template.template_key):
            return template.template_key
        raise HTTPException(
            status_code=400,
            detail="This template cannot be restored to a system default",
        )

    @staticmethod
    def _encode_json_text_fields(data: dict) -> dict:
        """Keep legacy TEXT columns while accepting JSON API payloads."""
        encoded = dict(data)
        if encoded.get("available_fields") is not None:
            encoded["available_fields"] = EmailTemplateService._normalize_available_fields(
                encoded["available_fields"]
            )
        for field in ("available_fields", "preview_data"):
            value = encoded.get(field)
            if value is not None and not isinstance(value, str):
                encoded[field] = json.dumps(value)
        return encoded

    @staticmethod
    def _decode_json_text(value: Any, fallback: Any = None) -> Any:
        if value is None:
            return fallback
        if not isinstance(value, str):
            return value
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback

    @staticmethod
    def _normalize_available_fields(value: Any) -> Optional[List[Dict[str, Any]]]:
        """Accept legacy string lists from default_templates.json and API dict rows."""
        if value is None:
            return None
        if not isinstance(value, list):
            return None
        normalized: List[Dict[str, Any]] = []
        for item in value:
            if isinstance(item, str) and item.strip():
                normalized.append({"field": item.strip()})
            elif isinstance(item, dict):
                normalized.append(item)
        return normalized or None

    @classmethod
    def _to_response(cls, template: EmailTemplateModel) -> EmailTemplateResponse:
        payload = {
            "id": template.id,
            "organization_id": template.organization_id,
            "template_key": template.template_key,
            "name": template.name,
            "description": template.description,
            "subject": template.subject,
            "body_html": template.body_html,
            "body_text": template.body_text,
            "from_name": template.from_name,
            "from_email": template.from_email,
            "reply_to": template.reply_to,
            "cc_emails": template.cc_emails,
            "bcc_emails": template.bcc_emails,
            "category": template.category,
            "is_active": template.is_active,
            "is_system_default": template.is_system_default,
            "available_fields": cls._normalize_available_fields(
                cls._decode_json_text(template.available_fields, fallback=[])
            ),
            "preview_data": cls._decode_json_text(template.preview_data, fallback={}),
            "created_by": template.created_by,
            "created_at": template.created_at,
            "updated_at": template.updated_at,
        }
        return EmailTemplateResponse.model_validate(payload)

    #---------------------------------
    # Create Template
    #---------------------------------
    async def create_template(
        self,
        template_data: EmailTemplateCreate, 
        organization_id: str, 
        created_by: str
    ) -> EmailTemplateResponse:
        """Create a new email template"""
        method_logger = class_logger.get_method_logger("create_template")
        method_logger.info('Creating email template', extra={
            'template_key': template_data.template_key,
            'organization_id': organization_id,
            'created_by': created_by
        })

        # Check if template key already exists
        existing = self.db.query(EmailTemplateModel).filter(
                and_(
                EmailTemplateModel.template_key == template_data.template_key,
                EmailTemplateModel.organization_id == organization_id
            )
        ).first()

        if existing:
            method_logger.warning('Template key already exists', extra={
                'template_key': template_data.template_key,
                'organization_id': organization_id
            })
            raise HTTPException(
                status_code=400, 
                detail=f"Template with key '{template_data.template_key}' already exists"
            )

        # Create template
        template_dict = self._encode_json_text_fields(template_data.model_dump())
        template_dict['organization_id'] = organization_id
        template_dict['created_by'] = created_by

        template = EmailTemplateModel(**template_dict)
        self.db.add(template)
        self.db.commit()
        self.db.refresh(template)

        method_logger.info('Template created successfully', extra={
            'template_id': str(template.id),
            'template_key': template.template_key
        })

        return self._to_response(template)

    #---------------------------------
    # Get Template
    #---------------------------------
    async def get_template(self, template_id: UUID, organization_id: str) -> EmailTemplateResponse:
        """Get template by ID"""
        method_logger = class_logger.get_method_logger("get_template")
        method_logger.info('Getting template', extra={
            'template_id': str(template_id),
            'organization_id': organization_id
        })

        template = self.db.query(EmailTemplateModel).filter(
                and_(
                EmailTemplateModel.id == template_id,
                EmailTemplateModel.organization_id == organization_id
            )
        ).first()

        if not template:
            method_logger.warning('Template not found', extra={
                'template_id': str(template_id),
                'organization_id': organization_id
            })
            raise HTTPException(status_code=404, detail="Template not found")

        return self._to_response(template)

    #---------------------------------
    # List Templates
    #---------------------------------
    async def list_templates(
        self,
        organization_id: str,
        skip: int = 0,
        limit: int = 100,
        is_active: Optional[bool] = None,
        category: Optional[str] = None
    ) -> tuple[List[EmailTemplateResponse], int]:
        """List templates with optional filtering"""
        method_logger = class_logger.get_method_logger("list_templates")
        method_logger.info('Listing templates', extra={
            'organization_id': organization_id,
            'skip': skip,
            'limit': limit,
            'is_active': is_active,
            'category': category
        })

        query = self.db.query(EmailTemplateModel).filter(
            EmailTemplateModel.organization_id == organization_id
        )

        # Apply filters
        if is_active is not None:
            query = query.filter(EmailTemplateModel.is_active == is_active)

        if category:
            query = query.filter(EmailTemplateModel.category == category)

        # Get total count
        total_count = query.count()

        # Apply pagination
        templates = query.order_by(EmailTemplateModel.created_at.desc()).offset(skip).limit(limit).all()

        method_logger.info('Templates listed successfully', extra={
            'count': len(templates),
            'total_count': total_count
        })

        return [self._to_response(template) for template in templates], total_count

    #---------------------------------
    # Update Template
    #---------------------------------
    async def update_template(
        self,
        template_id: UUID,
        template_data: EmailTemplateUpdate, 
        organization_id: str
    ) -> EmailTemplateResponse:
        """Update template"""
        method_logger = class_logger.get_method_logger("update_template")
        method_logger.info('Updating template', extra={
            'template_id': str(template_id),
            'organization_id': organization_id
        })

        template = self.db.query(EmailTemplateModel).filter(
                and_(
                EmailTemplateModel.id == template_id,
                EmailTemplateModel.organization_id == organization_id
            )
        ).first()

        if not template:
            method_logger.warning('Template not found for update', extra={
                'template_id': str(template_id),
                'organization_id': organization_id
            })
            raise HTTPException(status_code=404, detail="Template not found")

        # Check if template key already exists (if changing key)
        if template_data.template_key and template_data.template_key != template.template_key:
            existing = self.db.query(EmailTemplateModel).filter(
                and_(
                    EmailTemplateModel.template_key == template_data.template_key,
                    EmailTemplateModel.organization_id == organization_id,
                    EmailTemplateModel.id != template_id
                )
            ).first()

            if existing:
                method_logger.warning('Template key already exists', extra={
                    'template_key': template_data.template_key,
                    'organization_id': organization_id
                })
                raise HTTPException(
                    status_code=400, 
                    detail=f"Template with key '{template_data.template_key}' already exists"
                )

        # Update template
        update_data = self._encode_json_text_fields(template_data.model_dump(exclude_unset=True))
        for field, value in update_data.items():
            setattr(template, field, value)

        self.db.commit()
        self.db.refresh(template)

        method_logger.info('Template updated successfully', extra={
            'template_id': str(template.id),
            'template_key': template.template_key
        })

        return self._to_response(template)

    #---------------------------------
    # Restore Template to Default
    #---------------------------------
    async def restore_template_to_default(
        self,
        template_id: UUID,
        organization_id: str,
    ) -> EmailTemplateResponse:
        """Reset template content from default_templates.json (by template_key or category fallback)."""
        method_logger = class_logger.get_method_logger("restore_template_to_default")
        method_logger.info(
            "Restoring template to default",
            extra={
                "template_id": str(template_id),
                "organization_id": organization_id,
            },
        )

        template = self.db.query(EmailTemplateModel).filter(
            and_(
                EmailTemplateModel.id == template_id,
                EmailTemplateModel.organization_id == organization_id,
            )
        ).first()

        if not template:
            raise HTTPException(status_code=404, detail="Template not found")

        default_key = self._resolve_restore_template_key(template)
        default_data = self._get_default_template_definition(default_key)
        if not default_data:
            raise HTTPException(
                status_code=400,
                detail=f"Default template '{default_key}' not found",
            )

        template.name = default_data["name"]
        template.description = default_data.get("description")
        template.subject = default_data["subject"]
        template.body_html = default_data["body_html"]
        template.body_text = default_data.get("body_text")
        template.available_fields = (
            json.dumps(
                self._normalize_available_fields(default_data.get("available_fields"))
            )
            if default_data.get("available_fields") is not None
            else None
        )
        template.preview_data = (
            json.dumps(default_data["preview_data"])
            if default_data.get("preview_data") is not None
            else None
        )

        if template.is_system_default:
            template.category = default_data["category"]
            template.is_active = default_data["is_active"]

        self.db.commit()
        self.db.refresh(template)

        method_logger.info(
            "Template restored to default",
            extra={
                "template_id": str(template.id),
                "template_key": template.template_key,
                "default_key": default_key,
            },
        )

        return self._to_response(template)

    #---------------------------------
    # Delete Template
    #---------------------------------
    async def delete_template(self, template_id: UUID, organization_id: str) -> None:
        """Delete template"""
        method_logger = class_logger.get_method_logger("delete_template")
        method_logger.info('Deleting template', extra={
            'template_id': str(template_id),
            'organization_id': organization_id
        })

        template = self.db.query(EmailTemplateModel).filter(
                and_(
                EmailTemplateModel.id == template_id,
                EmailTemplateModel.organization_id == organization_id
            )
        ).first()

        if not template:
            method_logger.warning('Template not found for deletion', extra={
                'template_id': str(template_id),
                'organization_id': organization_id
            })
            raise HTTPException(status_code=404, detail="Template not found")

        self.db.delete(template)
        self.db.commit()

        method_logger.info('Template deleted successfully', extra={
            'template_id': str(template_id)
        })

    #---------------------------------
    # Preview Template
    #---------------------------------
    async def preview_template(
        self, 
        template_id: UUID, 
        organization_id: str, 
        variables: dict = None
    ) -> dict:
        """Preview template with variables"""
        method_logger = class_logger.get_method_logger("preview_template")
        method_logger.info('Previewing template', extra={
            'template_id': str(template_id),
            'organization_id': organization_id,
            'variables': variables
        })

        template = await self.get_template(template_id, organization_id)
        
        # Simple variable replacement (you can enhance this)
        subject = template.subject or ""
        html_content = template.body_html or ""
        text_content = template.body_text or ""
        
        if variables:
            for key, value in variables.items():
                subject = subject.replace(f"{{{{{key}}}}}", str(value)).replace(f"{{{key}}}", str(value))
                html_content = html_content.replace(f"{{{key}}}", str(value))
                html_content = html_content.replace(f"{{{{{key}}}}}", str(value))
                text_content = text_content.replace(f"{{{key}}}", str(value))
                text_content = text_content.replace(f"{{{{{key}}}}}", str(value))

        method_logger.info('Template preview generated', extra={
            'template_id': str(template_id)
        })

        return {
            "subject": subject,
            "htmlContent": html_content,
            "textContent": text_content,
            "variablesUsed": list(variables.keys()) if variables else []
        }

    #---------------------------------
    # Test Template Rendering
    #---------------------------------
    async def test_template_rendering(
        self, 
        template_id: UUID, 
        organization_id: str, 
        test_variables: dict
    ) -> dict:
        """Test template rendering with sample data"""
        method_logger = class_logger.get_method_logger("test_template_rendering")
        method_logger.info('Testing template rendering', extra={
                'template_id': str(template_id),
            'organization_id': organization_id,
            'test_variables': test_variables
        })

        return await self.preview_template(template_id, organization_id, test_variables)

    #---------------------------------
    # Create Default Templates for Organization
    #---------------------------------
    @staticmethod
    async def create_default_templates_for_organization(
        db: Session,
        organization_id: UUID,
        created_by: Optional[UUID] = None
    ) -> List[EmailTemplateModel]:
        """
        Create default system email templates for a new organization.
        These templates are system defaults and cannot be changed.
        Templates are loaded from default_templates.json file.
        """
        from uuid import uuid4
        
        logger = get_logger(__name__)
        method_logger = logger.get_method_logger("create_default_templates_for_organization")
        
        method_logger.info('Creating default email templates for organization', extra={
            'organization_id': str(organization_id)
        })
        
        
        # Load default templates from JSON file
        try:
            # Get the directory where this file is located
            current_dir = Path(__file__).parent
            templates_file = current_dir / "default_templates.json"
            
            if not templates_file.exists():
                method_logger.error('Default templates file not found', extra={
                    'file_path': str(templates_file)
                })
                raise FileNotFoundError(f"Default templates file not found: {templates_file}")
            
            with open(templates_file, 'r', encoding='utf-8') as f:
                default_templates = json.load(f)
            
            method_logger.info('Loaded default templates from JSON file', extra={
                'file_path': str(templates_file),
                'template_count': len(default_templates)
            })
        except json.JSONDecodeError as e:
            method_logger.error('Failed to parse default templates JSON file', exc_info=True, extra={
                'file_path': str(templates_file),
                'error': str(e)
            })
            raise ValueError(f"Invalid JSON in default templates file: {e}")
        except Exception as e:
            method_logger.error('Failed to load default templates file', exc_info=True, extra={
                'file_path': str(templates_file),
                'error': str(e)
            })
            raise
        
        created_templates = []
        
        try:
            for template_data in default_templates:
                # Generate new UUID for each template
                template_id = uuid4()
                
                # Create template instance
                template = EmailTemplateModel(
                    id=template_id,
                    organization_id=organization_id,
                    template_key=template_data['template_key'],
                    name=template_data['name'],
                    description=template_data['description'],
                    subject=template_data['subject'],
                    body_html=template_data['body_html'],
                    body_text=template_data['body_text'],
                    from_name=None,
                    from_email=None,
                    reply_to=None,
                    cc_emails=None,
                    bcc_emails=None,
                    category=template_data['category'],
                    is_active=template_data['is_active'],
                    is_system_default=template_data['is_system_default'],
                    available_fields=json.dumps(
                        EmailTemplateService._normalize_available_fields(template_data["available_fields"])
                    )
                    if template_data["available_fields"] is not None
                    else None,
                    preview_data=json.dumps(template_data['preview_data']) if template_data['preview_data'] is not None else None,
                    created_by=created_by,
                    updated_by=None,
                )
                
                db.add(template)
                created_templates.append(template)
            
            # Commit all templates at once
            db.commit()
            
            # Refresh all templates
            for template in created_templates:
                db.refresh(template)
            
            method_logger.info('Default email templates created successfully', extra={
                'organization_id': str(organization_id),
                'template_count': len(created_templates)
            })
            
            return created_templates
            
        except Exception as e:
            db.rollback()
            method_logger.error('Failed to create default email templates', exc_info=True, extra={
                'organization_id': str(organization_id),
                'error': str(e)
            })
            raise

    @staticmethod
    def ensure_system_template_from_defaults(
        db: Session,
        organization_id: UUID,
        template_key: str,
        created_by: Optional[UUID] = None,
    ) -> None:
        """
        Insert a single system default template for an org when missing (e.g. after JSON adds new keys).
        """
        from uuid import uuid4

        logger = get_logger(__name__)
        existing = (
            db.query(EmailTemplateModel)
            .filter(
                EmailTemplateModel.organization_id == organization_id,
                EmailTemplateModel.template_key == template_key,
            )
            .first()
        )
        if existing:
            return

        template_data = EmailTemplateService._get_default_template_definition(template_key)
        if not template_data:
            raise ValueError(f"Template key '{template_key}' not found in default_templates.json")

        template = EmailTemplateModel(
            id=uuid4(),
            organization_id=organization_id,
            template_key=template_data["template_key"],
            name=template_data["name"],
            description=template_data["description"],
            subject=template_data["subject"],
            body_html=template_data["body_html"],
            body_text=template_data.get("body_text"),
            from_name=None,
            from_email=None,
            reply_to=None,
            cc_emails=None,
            bcc_emails=None,
            category=template_data["category"],
            is_active=template_data["is_active"],
            is_system_default=template_data["is_system_default"],
            available_fields=(
                json.dumps(
                    EmailTemplateService._normalize_available_fields(
                        template_data["available_fields"]
                    )
                )
                if template_data.get("available_fields") is not None
                else None
            ),
            preview_data=(
                json.dumps(template_data["preview_data"])
                if template_data.get("preview_data") is not None
                else None
            ),
            created_by=created_by,
            updated_by=None,
        )
        db.add(template)
        db.flush()
        logger.info(
            "Provisioned missing system email template",
            extra={
                "organization_id": str(organization_id),
                "template_key": template_key,
            },
        )
