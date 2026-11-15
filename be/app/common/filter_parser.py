"""
Filter parser utility for parsing and applying advanced filters to SQLAlchemy queries.
"""
import json
from typing import Any, Dict, List, Optional, Union
from datetime import datetime, date
from sqlalchemy import and_, or_, func, cast, String
from sqlalchemy.orm import Query
from sqlalchemy.sql import ClauseElement

from app.common.business_exceptions import BadRequestError


class FilterParser:
    """Parser for advanced filter JSON structure."""
    
    # Mapping of operators to SQLAlchemy operations
    OPERATORS = {
        'equals': lambda col, val: col == val,
        'not_equals': lambda col, val: col != val,
        'contains': lambda col, val: col.ilike(f'%{val}%'),
        'not_contains': lambda col, val: ~col.ilike(f'%{val}%'),
        'starts_with': lambda col, val: col.ilike(f'{val}%'),
        'ends_with': lambda col, val: col.ilike(f'%{val}'),
        'greater_than': lambda col, val: col > val,
        'less_than': lambda col, val: col < val,
        'greater_than_or_equal': lambda col, val: col >= val,
        'less_than_or_equal': lambda col, val: col <= val,
        'is_null': lambda col, val: col.is_(None),
        'is_not_null': lambda col, val: col.isnot(None),
        'in': lambda col, val: col.in_(val if isinstance(val, list) else [val]),
        'not_in': lambda col, val: ~col.in_(val if isinstance(val, list) else [val]),
        'between': lambda col, val: col.between(val[0], val[1]) if isinstance(val, list) and len(val) == 2 else None,
    }
    
    # Field type converters
    TYPE_CONVERTERS = {
        'text': str,
        'number': lambda x: float(x) if '.' in str(x) else int(x),
        'date': lambda x: datetime.fromisoformat(x).date() if isinstance(x, str) else x,
        'boolean': lambda x: x if isinstance(x, bool) else str(x).lower() == 'true',
        'select': str,
        'multiselect': lambda x: x if isinstance(x, list) else [x],
    }
    
    @classmethod
    def parse_filters(cls, filters_json: str) -> Dict[str, Any]:
        """Parse filters from JSON string."""
        try:
            return json.loads(filters_json)
        except json.JSONDecodeError:
            raise BadRequestError("Invalid filter format")
    
    @classmethod
    def validate_filter_structure(cls, filters: Dict[str, Any]) -> None:
        """Validate the filter structure."""
        if not isinstance(filters, dict):
            raise BadRequestError("Filters must be an object")
        
        if 'groups' not in filters or not isinstance(filters['groups'], list):
            raise BadRequestError("Filters must contain a 'groups' array")
        
        if 'groupLogic' not in filters or filters['groupLogic'] not in ['AND', 'OR']:
            raise BadRequestError("Filters must contain 'groupLogic' of 'AND' or 'OR'")
        
        for group in filters['groups']:
            if 'conditions' not in group or not isinstance(group['conditions'], list):
                raise BadRequestError("Each filter group must contain a 'conditions' array")
            
            if 'logic' not in group or group['logic'] not in ['AND', 'OR']:
                raise BadRequestError("Each filter group must contain 'logic' of 'AND' or 'OR'")
    
    @classmethod
    def convert_value(cls, value: Any, field_type: str) -> Any:
        """Convert value based on field type."""
        if value is None or (field_type in ['is_null', 'is_not_null']):
            return None
        
        converter = cls.TYPE_CONVERTERS.get(field_type, str)
        try:
            if field_type == 'between' and isinstance(value, list):
                return [converter(v) for v in value]
            return converter(value)
        except (ValueError, TypeError):
            raise BadRequestError(f"Invalid value format for field type: {field_type}")
    
    @classmethod
    def build_condition(cls, model, field_mapping: Dict[str, Any], condition: Dict[str, Any], 
                       special_handlers: Optional[Dict[str, callable]] = None) -> Optional[ClauseElement]:
        """Build a single filter condition."""
        field = condition.get('field')
        operator = condition.get('operator')
        value = condition.get('value')
        field_type = condition.get('type', 'text')
        
        if not field or not operator:
            return None
        
        # Check if there's a special handler for this field
        if special_handlers and field in special_handlers:
            return special_handlers[field](operator, value, field_type)
        
        # Get the column from field mapping
        if field not in field_mapping:
            raise BadRequestError(f"Invalid filter field: {field}")
        
        column = field_mapping[field]
        
        # Special handling for nested fields (e.g., organization.name)
        if isinstance(column, str) and '.' in column:
            # This would need to be handled by the caller with proper joins
            return None
        
        # Get the operator function
        op_func = cls.OPERATORS.get(operator)
        if not op_func:
            raise BadRequestError(f"Invalid operator: {operator}")
        
        # Convert value based on field type
        converted_value = cls.convert_value(value, field_type)
        
        # Apply the operator
        try:
            result = op_func(column, converted_value)
            if result is None:
                raise BadRequestError(f"Invalid value for operator {operator}")
            return result
        except Exception as e:
            raise BadRequestError(f"Error applying filter: {str(e)}")
    
    @classmethod
    def build_group_conditions(cls, model, field_mapping: Dict[str, Any], group: Dict[str, Any], 
                              special_handlers: Optional[Dict[str, callable]] = None) -> Optional[ClauseElement]:
        """Build conditions for a filter group."""
        conditions = []
        
        for condition in group.get('conditions', []):
            cond = cls.build_condition(model, field_mapping, condition, special_handlers)
            # Special handlers might return True to indicate they've already applied the filter
            if cond is not None and cond is not True:
                conditions.append(cond)
        
        if not conditions:
            return None
        
        # Combine conditions based on group logic
        if group.get('logic') == 'OR':
            return or_(*conditions)
        else:
            return and_(*conditions)
    
    @classmethod
    def apply_filters(cls, query: Query, model, field_mapping: Dict[str, Any], filters_json: str, 
                     special_handlers: Optional[Dict[str, callable]] = None) -> Query:
        """Apply advanced filters to a SQLAlchemy query.
        
        Args:
            query: The base SQLAlchemy query
            model: The primary model being queried
            field_mapping: Dictionary mapping field names to SQLAlchemy columns
            filters_json: JSON string containing filter structure
            special_handlers: Optional dict of field names to handler functions for complex filters
        """
        # Parse and validate filters
        filters = cls.parse_filters(filters_json)
        cls.validate_filter_structure(filters)
        
        # Build conditions for each group
        group_conditions = []
        for group in filters.get('groups', []):
            group_cond = cls.build_group_conditions(model, field_mapping, group, special_handlers)
            if group_cond is not None:
                group_conditions.append(group_cond)
        
        if not group_conditions:
            return query
        
        # Combine groups based on groupLogic
        if filters.get('groupLogic') == 'OR':
            combined = or_(*group_conditions)
        else:
            combined = and_(*group_conditions)
        
        return query.filter(combined)