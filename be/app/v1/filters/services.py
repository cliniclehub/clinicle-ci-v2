import json
from typing import List, Optional, Dict, Any
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.v1.filters.model import SavedFilter as SavedFilterModel
from app.v1.filters.schema import SavedFilterCreate, SavedFilterUpdate, SavedFilterResponse
from app.common.business_exceptions import BadRequestError, NotFoundError
from app.common.app_logger import get_logger

class_logger = get_logger(__name__)


class SavedFilterService:
    #---------------------------------
    # Validation Methods
    #---------------------------------
    @staticmethod
    def _validate_filter_structure(filter_config: Dict[str, Any]) -> bool:
        """Validate the filter configuration structure"""
        try:
            # Check required top-level keys
            if not isinstance(filter_config, dict):
                return False
            
            if 'groups' not in filter_config or 'groupLogic' not in filter_config:
                return False
            
            if filter_config['groupLogic'] not in ['AND', 'OR']:
                return False
            
            if not isinstance(filter_config['groups'], list):
                return False
            
            # Validate each group
            for group in filter_config['groups']:
                if not isinstance(group, dict):
                    return False
                
                if 'conditions' not in group or 'logic' not in group:
                    return False
                
                if group['logic'] not in ['AND', 'OR']:
                    return False
                
                if not isinstance(group['conditions'], list):
                    return False
                
                # Validate each condition
                for condition in group['conditions']:
                    if not isinstance(condition, dict):
                        return False
                    
                    required_condition_keys = ['field', 'operator', 'value']
                    if not all(key in condition for key in required_condition_keys):
                        return False
            
            return True
        except Exception:
            return False

    #---------------------------------
    # Create Saved Filter
    #---------------------------------
    @staticmethod
    async def create_saved_filter(
        db: Session,
        user_id: UUID,
        organization_id: UUID,
        filter_data: SavedFilterCreate
    ) -> SavedFilterResponse:
        """Create a new saved filter"""
        methodLogger = class_logger.get_method_logger('create_saved_filter')

        methodLogger.info('Creating saved filter', extra={
            'user_id': str(user_id),
            'organization_id': str(organization_id),
            'page_type': filter_data.page_type,
            'filter_name': filter_data.name
        })
        
        # Validate filter config structure
        if not SavedFilterService._validate_filter_structure(filter_data.filter_config):
            methodLogger.warning('Invalid filter configuration structure', extra={
                'user_id': str(user_id),
                'filter_config': filter_data.filter_config
            })
            raise BadRequestError("Invalid filter configuration structure")
        
        # Check if user already has a filter with this name for this page type
        existing_filter = db.query(SavedFilterModel).filter(
            SavedFilterModel.user_id == user_id,
            SavedFilterModel.organization_id == organization_id,
            SavedFilterModel.page_type == filter_data.page_type,
            SavedFilterModel.name == filter_data.name
        ).first()
        
        if existing_filter:
            methodLogger.warning('Filter name already exists', extra={
                'user_id': str(user_id),
                'organization_id': str(organization_id),
                'page_type': filter_data.page_type,
                'filter_name': filter_data.name
            })
            raise BadRequestError(f"A filter with the name '{filter_data.name}' already exists for this page type")
        
        # If this is set as default, unset other defaults for this page type
        if filter_data.is_default:
            SavedFilterService._unset_defaults_for_page_type(db, user_id, organization_id, filter_data.page_type)
        
        try:
            saved_filter = SavedFilterModel(
                user_id=user_id,
                organization_id=organization_id,
                name=filter_data.name,
                description=filter_data.description,
                page_type=filter_data.page_type,
                filter_config=filter_data.filter_config,
                is_default=filter_data.is_default
            )
            
            db.add(saved_filter)
            db.commit()
            db.refresh(saved_filter)
            
            methodLogger.info('Saved filter created successfully', extra={
                'filter_id': str(saved_filter.id),
                'user_id': str(user_id),
                'organization_id': str(organization_id)
            })
            
            return SavedFilterResponse.from_orm(saved_filter)
        except IntegrityError as e:
            db.rollback()
            methodLogger.error('Failed to create saved filter', exc_info=True, extra={
                'user_id': str(user_id),
                'organization_id': str(organization_id),
                'error': str(e)
            })
            raise BadRequestError("Failed to create saved filter")

    #---------------------------------
    # Get User Saved Filters
    #---------------------------------
    @staticmethod
    async def get_user_saved_filters(
        db: Session,
        user_id: UUID,
        organization_id: UUID,
        page_type: Optional[str] = None
    ) -> List[SavedFilterResponse]:
        """Get user's saved filters, optionally filtered by page type"""
        methodLogger = class_logger.get_method_logger('get_user_saved_filters')
        methodLogger.info('Getting user saved filters', extra={
            'user_id': str(user_id),
            'organization_id': str(organization_id),
            'page_type': page_type
        })
        
        query = db.query(SavedFilterModel).filter(
            SavedFilterModel.user_id == user_id,
            SavedFilterModel.organization_id == organization_id
        )
        
        if page_type:
            query = query.filter(SavedFilterModel.page_type == page_type)
        
        saved_filters = query.order_by(SavedFilterModel.created_at.desc()).all()
        
        methodLogger.info('Retrieved saved filters', extra={
            'user_id': str(user_id),
            'organization_id': str(organization_id),
            'count': len(saved_filters)
        })
        
        return [SavedFilterResponse.from_orm(sf) for sf in saved_filters]

    #---------------------------------
    # Get Saved Filter by ID
    #---------------------------------
    @staticmethod
    async def get_saved_filter_by_id(
        db: Session,
        filter_id: int,
        user_id: UUID,
        organization_id: UUID
    ) -> SavedFilterResponse:
        """Get a specific saved filter by ID"""
        methodLogger = class_logger.get_method_logger('get_saved_filter_by_id')
        
        methodLogger.info('Getting saved filter by ID', extra={
            'filter_id': str(filter_id),
            'user_id': str(user_id),
            'organization_id': str(organization_id)
        })
        
        saved_filter = db.query(SavedFilterModel).filter(
            SavedFilterModel.id == filter_id,
            SavedFilterModel.user_id == user_id,
            SavedFilterModel.organization_id == organization_id
        ).first()
        
        if not saved_filter:
            methodLogger.warning('Saved filter not found', extra={
                'filter_id': str(filter_id),
                'user_id': str(user_id),
                'organization_id': str(organization_id)
            })
            raise NotFoundError("Saved filter not found")
        
        methodLogger.info('Retrieved saved filter', extra={
            'filter_id': str(filter_id),
            'user_id': str(user_id),
            'organization_id': str(organization_id)
        })
        
        return SavedFilterResponse.from_orm(saved_filter)

    #---------------------------------
    # Update Saved Filter
    #---------------------------------
    @staticmethod
    async def update_saved_filter(
        db: Session,
        filter_id: int,
        user_id: UUID,
        organization_id: UUID,
        filter_data: SavedFilterUpdate
    ) -> SavedFilterResponse:
        """Update an existing saved filter"""

        methodLogger = class_logger.get_method_logger('update_saved_filter')
        methodLogger.info('Updating saved filter', extra={
            'filter_id': str(filter_id),
            'user_id': str(user_id),
            'organization_id': str(organization_id)
        })
        
        saved_filter = db.query(SavedFilterModel).filter(
            SavedFilterModel.id == filter_id,
            SavedFilterModel.user_id == user_id,
            SavedFilterModel.organization_id == organization_id
        ).first()
        
        if not saved_filter:
            methodLogger.warning('Saved filter not found for update', extra={
                'filter_id': str(filter_id),
                'user_id': str(user_id),
                'organization_id': str(organization_id)
            })
            raise NotFoundError("Saved filter not found")
        
        # Validate filter config if provided
        if filter_data.filter_config:
            if not SavedFilterService._validate_filter_structure(filter_data.filter_config):
                methodLogger.warning('Invalid filter configuration structure', extra={
                    'filter_id': str(filter_id),
                    'user_id': str(user_id),
                    'filter_config': filter_data.filter_config
                })
                raise BadRequestError("Invalid filter configuration structure")
        
        # Check for name conflicts if name is being updated
        if filter_data.name and filter_data.name != saved_filter.name:
            existing_filter = db.query(SavedFilterModel).filter(
                SavedFilterModel.user_id == user_id,
                SavedFilterModel.organization_id == organization_id,
                SavedFilterModel.page_type == saved_filter.page_type,
                SavedFilterModel.name == filter_data.name,
                SavedFilterModel.id != filter_id
            ).first()
            
            if existing_filter:
                methodLogger.warning('Filter name already exists', extra={
                    'filter_id': str(filter_id),
                    'user_id': str(user_id),
                    'organization_id': str(organization_id),
                    'filter_name': filter_data.name
                })
                raise BadRequestError(f"A filter with the name '{filter_data.name}' already exists for this page type")
        
        # If setting as default, unset other defaults for this page type
        if filter_data.is_default:
            SavedFilterService._unset_defaults_for_page_type(db, user_id, organization_id, saved_filter.page_type)
        
        try:
            # Update fields
            for field, value in filter_data.dict(exclude_unset=True).items():
                setattr(saved_filter, field, value)
            
            db.commit()
            db.refresh(saved_filter)
            
            methodLogger.info('Saved filter updated successfully', extra={
                'filter_id': str(filter_id),
                'user_id': str(user_id),
                'organization_id': str(organization_id)
            })
            
            return SavedFilterResponse.from_orm(saved_filter)
        except IntegrityError as e:
            db.rollback()
            methodLogger.error('Failed to update saved filter', exc_info=True, extra={
                'filter_id': str(filter_id),
                'user_id': str(user_id),
                'organization_id': str(organization_id),
                'error': str(e)
            })
            raise BadRequestError("Failed to update saved filter")

    #---------------------------------
    # Delete Saved Filter
    #---------------------------------
    @staticmethod
    async def delete_saved_filter(
        db: Session,
        filter_id: int,
        user_id: UUID,
        organization_id: UUID
    ) -> bool:
        """Delete a saved filter"""
        methodLogger = class_logger.get_method_logger('delete_saved_filter')
        
        methodLogger.info('Deleting saved filter', extra={
            'filter_id': str(filter_id),
            'user_id': str(user_id),
            'organization_id': str(organization_id)
        })
        
        saved_filter = db.query(SavedFilterModel).filter(
            SavedFilterModel.id == filter_id,
            SavedFilterModel.user_id == user_id,
            SavedFilterModel.organization_id == organization_id
        ).first()
        
        if not saved_filter:
            methodLogger.warning('Saved filter not found for deletion', extra={
                'filter_id': str(filter_id),
                'user_id': str(user_id),
                'organization_id': str(organization_id)
            })
            raise NotFoundError("Saved filter not found")
        
        try:
            db.delete(saved_filter)
            db.commit()
            
            methodLogger.info('Saved filter deleted successfully', extra={
                'filter_id': str(filter_id),
                'user_id': str(user_id),
                'organization_id': str(organization_id)
            })
            
            return True
        except IntegrityError as e:
            db.rollback()
            methodLogger.error('Failed to delete saved filter', exc_info=True, extra={
                'filter_id': str(filter_id),
                'user_id': str(user_id),
                'organization_id': str(organization_id),
                'error': str(e)
            })
            raise BadRequestError("Failed to delete saved filter")

    #---------------------------------
    # Helper Methods
    #---------------------------------
    @staticmethod
    def _unset_defaults_for_page_type(
        db: Session,
        user_id: UUID,
        organization_id: UUID,
        page_type: str
    ):
        """Unset all default filters for a specific page type"""
        methodLogger = class_logger.get_method_logger('unset_defaults_for_page_type')
        
        methodLogger.info('Unsetting default filters for page type', extra={ 
            'user_id': str(user_id),
            'organization_id': str(organization_id),
            'page_type': page_type
        })
        
        db.query(SavedFilterModel).filter(
            SavedFilterModel.user_id == user_id,
            SavedFilterModel.organization_id == organization_id,
            SavedFilterModel.page_type == page_type,
            SavedFilterModel.is_default == True
        ).update({"is_default": False})
        db.commit()

    @staticmethod
    async def get_default_filter(
        db: Session,
        user_id: UUID,
        organization_id: UUID,
        page_type: str
    ) -> Optional[SavedFilterResponse]:
        """Get the default filter for a user and page type"""
        methodLogger = class_logger.get_method_logger('get_default_filter')
        
        methodLogger.info('Getting default filter', extra={
            'user_id': str(user_id),
            'organization_id': str(organization_id),
            'page_type': page_type
        })
        
        saved_filter = db.query(SavedFilterModel).filter(
            SavedFilterModel.user_id == user_id,
            SavedFilterModel.organization_id == organization_id,
            SavedFilterModel.page_type == page_type,
            SavedFilterModel.is_default == True
        ).first()
        
        if saved_filter:
            methodLogger.info('Default filter found', extra={
                'filter_id': str(saved_filter.id),
                'user_id': str(user_id),
                'organization_id': str(organization_id),
                'page_type': page_type
            })
            return SavedFilterResponse.from_orm(saved_filter)
        
        methodLogger.info('No default filter found', extra={
            'user_id': str(user_id),
            'organization_id': str(organization_id),
            'page_type': page_type
        })
        return None 