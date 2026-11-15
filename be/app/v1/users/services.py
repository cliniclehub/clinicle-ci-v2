from collections import defaultdict
from typing import Dict, List, Any, Optional, Tuple
from uuid import UUID
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_, func as sql_func
from sqlalchemy.exc import IntegrityError

from app.v1.users.model import User as UserModel
from app.v1.auth.model import UserOAuthIdentity
from app.v1.roles.model import Role, UserRole
from app.v1.organizations.model import Organization as OrganizationModel
from app.v1.users.schema import User, UserCreate, UserUpdate
from app.common.business_exceptions import (
    ConflictError,
    NotFoundError,
    ValidationError,
    BadRequestError,
    BusinessException,
)
from app.common.auth_helper import hash_password, verify_password
from app.common.email_validation import validate_email_address, parse_multi_email_search
from app.common.filter_parser import FilterParser
from app.common.app_logger import get_logger
from app.common.name_utils import (
    PERSON_NAME_TOO_SHORT_MESSAGE,
    count_person_name_letters,
    normalize_person_name,
)
from app.v1.auth.org_roles import ORG_ASSIGNABLE_ROLES, USER

logger = get_logger(__name__)

# Role keys allowed when org admins bulk-import users (org-facing roles only)
BULK_IMPORT_ALLOWED_ROLES = frozenset(ORG_ASSIGNABLE_ROLES)


def _escape_like_term(value: str) -> str:
    return (
        value
        .replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_")
    )


class UserService:
    
    #--------------------------------
    # Get Users (with optional org filtering)
    #--------------------------------
    @staticmethod
    async def get_users(
        db: Session,
        skip: int = 0,
        limit: int = 25,
        search: Optional[str] = None,
        sort_by: str = "created_at",
        sort_order: str = "desc",
        org_id: Optional[UUID] = None,
        filters: Optional[str] = None
    ) -> Tuple[List[User], int]:
        """Get users with pagination, search, and sorting - with optional org filtering"""
        # Build base query
        query = db.query(UserModel).options(
            joinedload(UserModel.organization)
        )
        
        # Apply org filtering if provided
        if org_id:
            query = query.filter(UserModel.organization_id == org_id)
        
        # Apply search filter if provided
        if search:
            clean_search = search.strip()
        else:
            clean_search = ""

        if clean_search:
            multi_emails = parse_multi_email_search(clean_search)
            if multi_emails:
                query = query.filter(sql_func.lower(UserModel.email).in_(multi_emails))
            else:
                search_term = f"%{_escape_like_term(clean_search)}%"
                full_name = sql_func.trim(
                    sql_func.concat(
                        sql_func.coalesce(UserModel.first_name, ""),
                        " ",
                        sql_func.coalesce(UserModel.last_name, ""),
                    )
                )
                query = query.filter(
                    or_(
                        UserModel.email.ilike(search_term, escape="\\"),
                        UserModel.first_name.ilike(search_term, escape="\\"),
                        UserModel.last_name.ilike(search_term, escape="\\"),
                        full_name.ilike(search_term, escape="\\"),
                    )
                )
        
        # Apply advanced filters if provided
        if filters:
            # Parse the filters first
            import json
            parsed_filters = json.loads(filters)

            # Check if we have roles filters and apply them directly
            has_role_filter = False

            for group in parsed_filters.get('groups', []):
                for condition in group.get('conditions', []):
                    field = condition.get('field')
                    operator = condition.get('operator')
                    value = condition.get('value')

                    if field == 'roles':
                        has_role_filter = True
                        # Normalize value to list
                        role_values = value if isinstance(value, list) else [value]
                        
                        # Build subquery to find users with the specified roles
                        role_subquery = db.query(UserRole.user_id).join(
                            Role, UserRole.role_id == Role.id
                        )
                        
                        # Apply organization filtering for roles
                        if org_id:
                            role_subquery = role_subquery.filter(UserRole.organization_id == org_id)
                        
                        # Apply role filter based on operator
                        if operator == 'equals':
                            role_subquery = role_subquery.filter(Role.key == value)
                            # Apply the filter to the main query using subquery
                            query = query.filter(UserModel.id.in_(role_subquery))
                        elif operator == 'not_equals':
                            role_subquery = role_subquery.filter(Role.key == value)
                            # Users who don't have this role
                            query = query.filter(~UserModel.id.in_(role_subquery))
                        elif operator == 'in':
                            role_subquery = role_subquery.filter(Role.key.in_(role_values))
                            # Apply the filter to the main query using subquery
                            query = query.filter(UserModel.id.in_(role_subquery))
                        elif operator == 'not_in':
                            role_subquery = role_subquery.filter(Role.key.in_(role_values))
                            # Users who don't have any of these roles
                            query = query.filter(~UserModel.id.in_(role_subquery))

            # Apply other filters if they exist
            if not has_role_filter or any(
                condition.get('field') not in ['roles']
                for group in parsed_filters.get('groups', [])
                for condition in group.get('conditions', [])
            ):
                # Define field mapping for other filters
                field_mapping = {
                    'email': UserModel.email,
                    'firstName': UserModel.first_name,
                    'lastName': UserModel.last_name,
                    'locked': UserModel.locked,
                    'createdAt': UserModel.created_at,
                    'updatedAt': UserModel.updated_at,
                    'organizationId': UserModel.organization_id,
                    'emailVerified': UserModel.email_verified,
                    'mustChangePassword': UserModel.must_change_password,
                    'phoneNumber': UserModel.phone_number,
                }

                # Roles are handled above, so return True to skip
                def skip_handler(operator, value, field_type):
                    return True

                special_handlers = {
                    'roles': skip_handler,
                }

                # Apply remaining filters
                query = FilterParser.apply_filters(query, UserModel, field_mapping, filters, special_handlers)
        
        # Count after filtering but before sorting joins/subqueries.
        total = query.order_by(None).count()

        # Apply sorting - convert camelCase to snake_case
        field_mapping = {
            "createdAt": "created_at",
            "updatedAt": "updated_at", 
            "firstName": "first_name",
            "lastName": "last_name",
            "organizationId": "organization_id",
            "organizationName": "organization_name",
            "roles": "roles"
        }
        
        # Convert camelCase to snake_case if needed
        db_field_name = field_mapping.get(sort_by, sort_by)
        
        # Special handling for organization_name - need to join Organization table
        if db_field_name == "organization_name":
            # Join Organization table if not already joined
            # Check if organization is already loaded (it should be via joinedload, but we need an actual join for sorting)
            query = query.join(OrganizationModel, UserModel.organization_id == OrganizationModel.id)
            sort_column = OrganizationModel.name
            if sort_order.lower() == "desc":
                query = query.order_by(sort_column.desc())
            else:
                query = query.order_by(sort_column.asc())
        elif db_field_name == "roles":
            # Sort by roles - use a subquery to get the minimum role key for each user
            # This handles users with multiple roles by sorting by the first (alphabetically) role
            from sqlalchemy import func, select
            # Create a subquery that gets the minimum role key for each user
            role_subquery = select(
                UserRole.user_id,
                func.min(Role.key).label('min_role_key')
            ).join(
                Role, UserRole.role_id == Role.id
            )
            if org_id:
                role_subquery = role_subquery.filter(UserRole.organization_id == org_id)
            role_subquery = role_subquery.group_by(UserRole.user_id).subquery()
            
            # Left join the subquery to get the min role key for each user
            query = query.outerjoin(
                role_subquery, UserModel.id == role_subquery.c.user_id
            )
            
            # Sort by the minimum role key
            # Users without roles will have NULL, which should sort last
            if sort_order.lower() == "desc":
                query = query.order_by(role_subquery.c.min_role_key.desc().nullslast())
            else:
                query = query.order_by(role_subquery.c.min_role_key.asc().nullslast())
        elif hasattr(UserModel, db_field_name):
            sort_column = getattr(UserModel, db_field_name)
            # Special handling: when sorting by first_name, also sort by last_name as secondary
            if db_field_name == "first_name":
                last_name_column = getattr(UserModel, "last_name")
                if sort_order.lower() == "desc":
                    query = query.order_by(sort_column.desc(), last_name_column.desc())
                else:
                    query = query.order_by(sort_column.asc(), last_name_column.asc())
            else:
                if sort_order.lower() == "desc":
                    query = query.order_by(sort_column.desc())
                else:
                    query = query.order_by(sort_column.asc())
        else:
            query = query.order_by(UserModel.created_at.desc())
        
        # Apply pagination
        users = query.offset(skip).limit(limit).all()

        uid_list = [u.id for u in users]
        oauth_by_uid: Dict[UUID, List[str]] = defaultdict(list)
        roles_by_uid: Dict[UUID, List[str]] = defaultdict(list)

        if uid_list:
            for row in db.query(UserOAuthIdentity.user_id, UserOAuthIdentity.provider).filter(
                UserOAuthIdentity.user_id.in_(uid_list)
            ).all():
                oauth_by_uid[row.user_id].append(row.provider)
            for uid in oauth_by_uid:
                oauth_by_uid[uid] = list(dict.fromkeys(oauth_by_uid[uid]))

            roles_query = (
                db.query(UserRole.user_id, Role.key)
                .join(Role, UserRole.role_id == Role.id)
                .filter(UserRole.user_id.in_(uid_list))
            )
            if org_id:
                roles_query = roles_query.filter(UserRole.organization_id == org_id)
            for user_id, role_key in roles_query.all():
                roles_by_uid[user_id].append(role_key)

        # Convert to User schema
        user_list = []
        for user in users:
            has_password = bool(getattr(user, "password_hash", None) and str(user.password_hash).strip())
            oauth_providers = list(oauth_by_uid.get(user.id, []))

            # Create User schema instance
            user_data = User(
                id=user.id,
                email=user.email,
                first_name=user.first_name,
                last_name=user.last_name,
                organization_id=user.organization_id,
                organization_name=user.organization.name,
                organization_domain=user.organization.domain,
                roles=roles_by_uid.get(user.id, []),
                email_verified=user.email_verified,
                email_verified_at=user.email_verified_at,
                phone_number=user.phone_number,
                phone_verified=user.phone_verified,
                phone_verified_at=user.phone_verified_at,
                must_change_password=user.must_change_password,
                locked=user.locked,
                locked_until=user.locked_until,
                created_at=user.created_at,
                updated_at=user.updated_at,
                has_password=has_password,
                oauth_providers=oauth_providers,
            )
            user_list.append(user_data)

        return user_list, total

    #--------------------------------
    # Get Users by Organization
    #--------------------------------
    @staticmethod
    async def list_users_by_organization(
        db: Session,
        org_id: UUID,
        skip: int = 0,
        limit: int = 25,
        search: Optional[str] = None,
        role: Optional[str] = None
    ) -> Tuple[List[User], int]:
        """Get users for a specific organization with pagination, search, and role filtering"""
        
        # Build base query
        query = db.query(UserModel).options(
            joinedload(UserModel.organization)
        ).filter(UserModel.organization_id == org_id)
        
        # Apply search filter if provided
        if search:
            search_term = f"%{search}%"
            query = query.filter(
                or_(
                    UserModel.email.ilike(search_term),
                    UserModel.first_name.ilike(search_term),
                    UserModel.last_name.ilike(search_term)
                )
            )
        
        # Apply role filtering if provided
        if role:
            query = query.join(UserRole).join(Role).filter(Role.key == role)
        
        # Get total count
        total = query.count()
        
        # Apply pagination and sorting
        # Apply org filtering if provided
        if org_id:
            query = query.filter(UserModel.organization_id == org_id)
        
        user = query.first()
        if not user:
            raise NotFoundError("User not found")
        
        # Get user roles for their organization
        user_roles = db.query(Role).join(UserRole).filter(
            UserRole.user_id == user.id,
            UserRole.organization_id == user.organization_id
        ).all()
        
        # Create User schema instance
        return User(
            id=user.id,
            email=user.email,
            first_name=user.first_name,
            last_name=user.last_name,
            organization_id=user.organization_id,
            organization_name=user.organization.name,
            organization_domain=user.organization.domain,
            roles=[role.key for role in user_roles],
            email_verified=user.email_verified,
            email_verified_at=user.email_verified_at,
            phone_number=user.phone_number,
            phone_verified=user.phone_verified,
            phone_verified_at=user.phone_verified_at,
            must_change_password=user.must_change_password,
            locked=user.locked,
            locked_until=user.locked_until,
            created_at=user.created_at,
            updated_at=user.updated_at,
        )

    #--------------------------------
    # Get Single User by ID
    #--------------------------------
    @staticmethod
    async def get_user(db: Session, user_id: UUID, org_id: Optional[UUID] = None) -> User:
        """Get a single user by ID with optional org filtering"""
        # Get user object
        user = await UserService._get_user_object(db, user_id)
        
        # Check org access if provided
        if org_id and user.organization_id != org_id:
            raise NotFoundError("User not found in this organization")
        
        # Get user roles for their organization
        user_roles = db.query(Role).join(UserRole).filter(
            UserRole.user_id == user.id,
            UserRole.organization_id == user.organization_id
        ).all()
        
        has_password = bool(getattr(user, "password_hash", None) and str(user.password_hash).strip())
        oauth_providers = list(
            dict.fromkeys(
                row.provider
                for row in db.query(UserOAuthIdentity).filter(UserOAuthIdentity.user_id == user.id).all()
            )
        )

        # Create User schema instance
        user_data = User(
            id=user.id,
            email=user.email,
            first_name=user.first_name,
            last_name=user.last_name,
            organization_id=user.organization_id,
            organization_name=user.organization.name,
            organization_domain=user.organization.domain,
            roles=[role.key for role in user_roles],
            email_verified=user.email_verified,
            email_verified_at=user.email_verified_at,
            phone_number=user.phone_number,
            phone_verified=user.phone_verified,
            phone_verified_at=user.phone_verified_at,
            must_change_password=user.must_change_password,
            locked=user.locked,
            locked_until=user.locked_until,
            created_at=user.created_at,
            updated_at=user.updated_at,
            has_password=has_password,
            oauth_providers=oauth_providers,
        )
        
        return user_data

    @staticmethod
    def _normalize_bulk_import_phone(raw: Any) -> Tuple[Optional[str], Optional[str]]:
        """Returns (e164_phone_or_none, validation_error). Blank input -> (None, None)."""
        if raw is None:
            return None, None
        s = str(raw).strip()
        if not s:
            return None, None
        try:
            digits_and_plus = "".join(c for c in s if c.isdigit() or c == "+")
            digits_only = digits_and_plus.replace("+", "")
            candidate = "+" + digits_only
            if len(candidate) < 8:
                return None, "Phone number is too short; include country code (e.g. +962791234567)"
            if not candidate[1:].isdigit():
                return None, "Phone number must contain only digits after +"
            try:
                import phonenumbers
                from phonenumbers import NumberParseException, PhoneNumberFormat

                try:
                    parsed_number = phonenumbers.parse(candidate, None)
                    if not phonenumbers.is_valid_number(parsed_number):
                        return None, "Invalid phone number format"
                    return phonenumbers.format_number(parsed_number, PhoneNumberFormat.E164), None
                except NumberParseException as e:
                    return None, f"Invalid phone number format: {str(e)}"
            except ImportError:
                return candidate, None
        except Exception as e:
            return None, str(e)

    @staticmethod
    def _parse_bulk_import_roles(raw_roles: Any) -> Tuple[List[str], Optional[str]]:
        """Returns (ordered deduped role keys, error if unknown role). Default user when empty."""
        keys: List[str] = []
        if raw_roles is None:
            return [USER], None
        if isinstance(raw_roles, list):
            keys = [str(x).strip().lower() for x in raw_roles if str(x).strip()]
        else:
            s = str(raw_roles).strip()
            if not s:
                return [USER], None
            keys = [p.strip().lower() for p in s.replace(";", ",").split(",") if p.strip()]
        if not keys:
            return [USER], None
        invalid = sorted({k for k in keys if k not in BULK_IMPORT_ALLOWED_ROLES})
        if invalid:
            return [], (
                "Unknown role(s): "
                + ", ".join(invalid)
                + ". Allowed: "
                + ", ".join(sorted(BULK_IMPORT_ALLOWED_ROLES))
            )
        seen: set = set()
        ordered: List[str] = []
        for k in keys:
            if k not in seen:
                seen.add(k)
                ordered.append(k)
        return ordered, None

    #--------------------------------
    # Bulk Create Users
    #--------------------------------
    @staticmethod
    async def bulk_create_users(
        db: Session,
        org_id: UUID,
        users_data: List[Dict[str, Any]],
        created_by_user_id: UUID,
        skip_email_verification: bool = True,
        skip_emails: bool = False,
    ) -> Dict[str, Any]:
        """Create multiple users in bulk"""
        method_logger = logger.get_method_logger("bulk_create_users")
        results = []
        success_count = 0
        error_count = 0
        created_user_ids = []
        
        # Process each user
        all_user_ids = []  # Track all user IDs (newly created + existing)
        user_result_map: Dict[UUID, Dict[str, Any]] = {}  # Map user_id to result dict
        
        for user_data_dict in users_data:
            user_email_raw = user_data_dict.get("email", "").strip()
            user_first_name = normalize_person_name(user_data_dict.get("firstName", ""))
            user_last_name = normalize_person_name(user_data_dict.get("lastName", ""))
            user_password = user_data_dict.get("password", "")
            raw_phone = user_data_dict.get("phoneNumber") or user_data_dict.get("phone_number")
            roles_explicit = bool(user_data_dict.get("rolesFieldInRequest"))
            raw_roles = user_data_dict.get("roles") if roles_explicit else None
            
            # Pre-validate each user individually
            validation_errors = []
            
            # Validate email format
            if not user_email_raw:
                validation_errors.append("Email is required")
            else:
                is_valid, email_result = validate_email_address(user_email_raw)
                if not is_valid:
                    validation_errors.append(email_result or "Invalid email format")
                else:
                    user_email = email_result
            
            # Validate first name
            if not user_first_name:
                validation_errors.append("First name is required")
            elif len(user_first_name) > 100:
                validation_errors.append("First name must be 100 characters or less")
            elif count_person_name_letters(user_first_name) < 2:
                validation_errors.append(f"First name: {PERSON_NAME_TOO_SHORT_MESSAGE}")

            # Validate last name
            if not user_last_name:
                validation_errors.append("Last name is required")
            elif len(user_last_name) > 100:
                validation_errors.append("Last name must be 100 characters or less")
            elif count_person_name_letters(user_last_name) < 2:
                validation_errors.append(f"Last name: {PERSON_NAME_TOO_SHORT_MESSAGE}")

            # Validate password
            if not user_password:
                validation_errors.append("Password is required")
            
            normalized_phone, phone_err = UserService._normalize_bulk_import_phone(raw_phone)
            if phone_err:
                validation_errors.append(phone_err)

            role_list, role_err = UserService._parse_bulk_import_roles(raw_roles)
            if role_err:
                validation_errors.append(role_err)

            # If validation errors, add to results and skip processing
            if validation_errors:
                results.append({
                    "user_id": None,
                    "email": user_email_raw or "N/A",
                    "success": False,
                    "error": "; ".join(validation_errors),
                    "status": None,
                })
                error_count += 1
                continue
            
            # Validation passed, proceed with user creation/checking
            user = None
            
            # Check if user already exists
            existing_user = db.query(UserModel).filter(
                sql_func.lower(UserModel.email) == user_email,
                UserModel.organization_id == org_id
            ).first()
            
            if existing_user:
                # User already exists - treat as status, not error; optionally sync phone / roles / verified
                user = existing_user
                all_user_ids.append(user.id)
                
                status_bits = ["User already exists"]
                try:
                    if user.email != user_email:
                        user.email = user_email
                        status_bits.append("Email normalized to lowercase")
                    if skip_email_verification and not user.email_verified:
                        user.email_verified = True
                        user.email_verified_at = datetime.now(timezone.utc)
                        status_bits.append("Email marked verified")
                    if normalized_phone is not None:
                        user.phone_number = normalized_phone
                        status_bits.append("Phone updated")
                    if roles_explicit and role_list:
                        from app.v1.users.org_role_policy import assert_org_cannot_manage_org_owner

                        existing_keys = [
                            key
                            for (key,) in db.query(Role.key)
                            .join(UserRole, UserRole.role_id == Role.id)
                            .filter(
                                UserRole.user_id == user.id,
                                UserRole.organization_id == org_id,
                            )
                            .all()
                        ]
                        assert_org_cannot_manage_org_owner(existing_keys)
                        UserService._update_user_roles_scoped(db, user, role_list, org_id)
                        status_bits.append("Roles updated")
                    # Commit if anything might have changed beyond the three branches above
                    if len(status_bits) > 1:
                        db.commit()
                        db.refresh(user)
                except Exception as e:
                    db.rollback()
                    method_logger.error(f"Failed updating existing user {user_email}: {str(e)}")
                    results.append({
                        "user_id": None,
                        "email": user_email,
                        "success": False,
                        "error": f"Failed to update existing user: {str(e)}",
                        "status": None,
                    })
                    error_count += 1
                    all_user_ids.pop()
                    continue

                result = {
                    "user_id": str(user.id),
                    "email": user.email,
                    "success": True,  # Still success, just existing
                    "error": None,
                    "status": "; ".join(status_bits),
                }
                user_result_map[user.id] = result
                results.append(result)
                success_count += 1
            else:
                # Try to create new user
                try:
                    user_create = UserCreate(
                        email=user_email,  # Already validated and normalized
                        first_name=user_first_name,
                        last_name=user_last_name,
                        password=user_password,
                        organization_id=org_id,
                        roles=role_list,
                        phone_number=normalized_phone,
                        skip_email_verification=skip_email_verification
                    )
                    
                    user = await UserService.create_user(db, user_create)
                    created_user_ids.append(user.id)
                    all_user_ids.append(user.id)
                    
                    result = {
                        "user_id": str(user.id),
                        "email": user.email,
                        "success": True,
                        "error": None,
                        "status": None,
                    }
                    user_result_map[user.id] = result
                    results.append(result)
                    success_count += 1
                    
                except Exception as e:
                    method_logger.error(f"Failed to create user {user_email}: {str(e)}")
                    # Extract meaningful error message
                    error_msg = str(e)
                    if "email" in error_msg.lower() and "valid" in error_msg.lower():
                        error_msg = "Invalid email format"
                    elif "already exists" in error_msg.lower() or "duplicate" in error_msg.lower():
                        error_msg = "User with this email already exists"
                    
                    results.append({
                        "user_id": None,
                        "email": user_email,
                        "success": False,
                        "error": error_msg,
                        "status": None,
                    })
                    error_count += 1
        
        return {
            "success_count": success_count,
            "error_count": error_count,
            "results": results
        }

    #--------------------------------
    # Create User
    #--------------------------------
    @staticmethod
    async def create_user(db: Session, user_data: UserCreate) -> User:
        """Create user with optional org assignment"""
        try:
            # Validate input using Pydantic
            user_create_data = user_data.model_dump()
            roles = user_create_data.pop("roles", []) or []
            plain_password = user_create_data.pop("password", None)
            skip_email_verification = user_create_data.pop("skip_email_verification", False)

            if not roles:
                roles = [USER]
            
            # Hash password if provided
            if plain_password:
                user_create_data["password_hash"] = hash_password(plain_password)
            else:
                raise ValidationError("Password is required")
            
            
            # Normalize email to lowercase for consistent storage and lookups
            normalized_email = user_data.email.lower().strip()
            user_create_data["email"] = normalized_email
            
            # Check if user already exists (using normalized email)
            existing_user = db.query(UserModel).filter(
                sql_func.lower(UserModel.email) == normalized_email,
                UserModel.organization_id == user_data.organization_id
            ).first()
            if existing_user:
                raise ConflictError("User with this email already exists in this organization")
            
            # Create user in database
            # Set email_verified based on skip_email_verification flag
            if skip_email_verification:
                user_create_data["email_verified"] = True
                from datetime import datetime, timezone
                user_create_data["email_verified_at"] = datetime.now(timezone.utc)
            else:
                user_create_data.setdefault("email_verified", False)
            
            org = db.query(OrganizationModel).filter(
                OrganizationModel.id == user_data.organization_id
            ).first()

            user = UserModel(**user_create_data)
            db.add(user)
            db.flush()
            
            # Add roles for the organization
            if roles:
                UserService._add_user_roles_for_organization(db, user, user.organization_id, roles)
            
            # Generate verification code and send welcome email (only if not skipping)
            if not skip_email_verification:
                if not org:
                    raise NotFoundError(f"Organization {user.organization_id} not found")
                # Use Auth2Service methods for consistency with registration flow
                from app.v1.auth.services import Auth2Service
                auth_service = Auth2Service(db)
                
                # Generate verification code
                verification_code = await auth_service._generate_verification_code(user.id)
                
                # Send registration welcome email BEFORE committing
                # This ensures rollback if email fails
                try:
                    await auth_service._send_registration_welcome_email(user, verification_code, org)
                except Exception as e:
                    # Rollback if email sending fails
                    db.rollback()
                    logger.error(f"Failed to send welcome email for user {user.email}: {str(e)}")
                    raise BusinessException(f"Failed to send welcome email: {str(e)}")
            
            db.commit()
            db.refresh(user)
            
            if skip_email_verification:
                logger.info(f"✅ Successfully created user {user.id} in organization {user.organization_id} with email verified (no email sent)")
            else:
                logger.info(f"✅ Successfully created user {user.id} in organization {user.organization_id} and sent welcome email")
            return await UserService.get_user(db, user.id)
            
        except IntegrityError:
            db.rollback()
            raise ConflictError("User with this email already exists")
        except (ValidationError, ConflictError, NotFoundError):
            db.rollback()
            raise
        except Exception as e:
            db.rollback()
            logger.error(f"Error creating user: {e}")
            raise

    #--------------------------------
    # Update User
    #--------------------------------
    @staticmethod
    async def update_user(db: Session, user_id: UUID, user_data: UserUpdate, is_self_edit: bool = False) -> User:
        """Update user with optional org filtering
        
        Args:
            db: Database session
            user_id: ID of user to update
            user_data: User update data
            is_self_edit: If True, applies email/phone verification checks. If False (admin edit), skips verification checks.
        """
        method_logger = logger.get_method_logger("update_user")
        try:
            # Get user and verify org access if needed
            user = await UserService._get_user_object(db, user_id)
            
            # Convert Pydantic model to dict, excluding None values
            update_data = user_data.model_dump(exclude_unset=True)
            roles = update_data.pop("roles", None)
            plain_password = update_data.pop("password", None)
            # Hash password if provided
            if plain_password:
                update_data["password_hash"] = hash_password(plain_password)
            
            # Check for email conflict and verification (only for self-edits)
            if "email" in update_data:
                # Normalize email to lowercase for consistent storage and lookups
                new_email = update_data["email"].lower().strip()
                update_data["email"] = new_email
                
                if new_email != (user.email or "").lower().strip():
                    # Email is being changed
                    from app.v1.auth.model import EmailVerificationCode
                    from app.common.business_exceptions import ValidationError
                    
                    # Check if email already exists for another user
                    existing_user = db.query(UserModel).filter(
                        sql_func.lower(UserModel.email) == new_email,
                        UserModel.id != user_id
                    ).first()
                    if existing_user:
                        raise ConflictError("User with this email already exists")
                    
                    # Only apply verification check for self-edits (users editing their own profile)
                    if is_self_edit:
                        # Check if there's a recently verified code for this user
                        # We check for a used code created within the last hour
                        # The UI manages which email was verified, but we verify that
                        # a code was actually used (proving verification happened)
                        recent_verified_code = db.query(EmailVerificationCode).filter(
                            EmailVerificationCode.user_id == user_id,
                            EmailVerificationCode.used == True,
                            EmailVerificationCode.created_at > datetime.now(timezone.utc) - timedelta(hours=1)
                        ).order_by(EmailVerificationCode.created_at.desc()).first()
                        
                        if not recent_verified_code:
                            raise ValidationError(
                                "Email address has changed and must be verified before saving. "
                                "Please verify your email address using the verification button."
                            )
                        
                        # Email is verified - update verification status
                        user.email_verified = True
                        user.email_verified_at = datetime.now(timezone.utc)
                        method_logger.info('Email verified and will be updated on save', {
                            'user_id': str(user_id),
                            'old_email': user.email,
                            'new_email': new_email
                        })
                    else:
                        # Admin edit - skip verification check, but reset verification status since email changed
                        user.email_verified = False
                        user.email_verified_at = None
                        method_logger.info('Email changed by admin - verification status reset', {
                            'user_id': str(user_id),
                            'old_email': user.email,
                            'new_email': new_email
                        })
                else:
                    # Email hasn't changed - keep existing verification status
                    pass
            
            # Handle phone number update with verification check (only for self-edits)
            phone_number_value = update_data.get('phone_number') or update_data.get('phoneNumber')
            if phone_number_value:
                # Normalize phone number key
                if 'phoneNumber' in update_data:
                    update_data['phone_number'] = update_data.pop('phoneNumber')
                
                # Check if this is first-time phone addition (user had no phone before)
                is_first_time_addition = not user.phone_number or not user.phone_number.strip()
                
                if is_first_time_addition:
                    # First-time phone addition - allow without verification
                    # User will verify later through the verify-phone page flow
                    user.phone_verified = False
                    user.phone_verified_at = None
                else:
                    # User has existing phone - check if phone changed and needs verification
                    from app.v1.users.phone_verification_service import PhoneVerificationService
                    from app.common.business_exceptions import ValidationError
                    
                    # Normalize phone numbers for comparison
                    is_valid, formatted_new = PhoneVerificationService.validate_phone_number(phone_number_value)
                    if not is_valid:
                        raise ValidationError("Invalid phone number format")
                    
                    normalized_new = formatted_new
                    normalized_current = None
                    if user.phone_number:
                        is_valid_old, formatted_old = PhoneVerificationService.validate_phone_number(user.phone_number)
                        if is_valid_old and formatted_old:
                            normalized_current = formatted_old
                    
                    # Check if phone changed
                    phone_changed = normalized_current != normalized_new
                    
                    if phone_changed:
                        # Phone changed from existing number
                        if is_self_edit:
                            # Self-edit: requires verification
                            # When verifying from settings page (update_user=False), we don't update the user
                            # So we check if phone_verified_at is recent (within last hour) as an indicator
                            # that verification happened. The UI ensures the phone matches.
                            if user.phone_verified_at:
                                time_since_verification = datetime.now(timezone.utc) - user.phone_verified_at
                                if time_since_verification > timedelta(hours=1):
                                    raise ValidationError(
                                        "Phone number has changed and must be verified before saving. "
                                        "Please verify your phone number using the verification button."
                                    )
                            else:
                                # No recent verification timestamp
                                raise ValidationError(
                                    "Phone number has changed and must be verified before saving. "
                                    "Please verify your phone number using the verification button."
                                )
                            
                            # Phone is verified - update verification status
                            user.phone_verified = True
                            user.phone_verified_at = datetime.now(timezone.utc)
                        else:
                            # Admin edit: skip verification check, but reset verification status since phone changed
                            user.phone_verified = False
                            user.phone_verified_at = None
                            method_logger.info('Phone changed by admin - verification status reset', {
                                'user_id': str(user_id),
                                'old_phone': user.phone_number,
                                'new_phone': normalized_new
                            })
                    # If phone hasn't changed, allow saving (no verification needed for unchanged phone)
            
            # Update user fields
            for field, value in update_data.items():
                if hasattr(user, field):
                    setattr(user, field, value)
            
            # Update roles
            if roles is not None:
                UserService._update_user_roles_scoped(db, user, roles, user.organization_id)
            
            db.commit()
            db.refresh(user)
            
            return await UserService.get_user(db, user.id)
            
        except IntegrityError as e:
            logger.error(f"❌ IntegrityError during update: {e}")
            db.rollback()
            if "email" in str(e).lower() or "unique" in str(e).lower():
                raise ConflictError("User with this email already exists")
            else:
                raise ConflictError(f"Database constraint violation: {str(e)}")
        except Exception as e:
            logger.error(f"❌ Unexpected error during update: {e}")
            db.rollback()
            raise

    #--------------------------------
    # Update Current User (Secure)
    #--------------------------------
    @staticmethod
    async def update_current_user_secure(db: Session, user_id: UUID, user_data: UserUpdate) -> User:
        """Securely update current user profile - strips sensitive fields like roles and organization_id
        
        This method is specifically for the /users/me endpoint where users update their own profile.
        It prevents users from escalating their privileges or changing their organization.
        """
        try:
            # Create a copy of the update data to avoid modifying the original
            secure_data = user_data.model_copy()
            
            # SECURITY: Remove fields that users should not be able to update themselves
            secure_data.roles = None  # Users cannot change their own roles
            secure_data.organization_id = None  # Users cannot change their organization
            
            # Remove sensitive admin fields by setting them to None (they will be excluded from update)
            admin_fields = ['email_verified', 'email_verified_at', 'must_change_password', 
                           'locked', 'locked_until']
            for field in admin_fields:
                if hasattr(secure_data, field):
                    setattr(secure_data, field, None)
            
            # Log if sensitive fields were attempted to be updated
            if user_data.roles is not None:
                logger.warning(f"User {user_id} attempted to update their own roles through /users/me endpoint")
            
            if user_data.organization_id is not None:
                logger.warning(f"User {user_id} attempted to update their organization through /users/me endpoint")
            
            # Convert to dict and exclude None values to avoid NOT NULL constraint violations
            update_dict = secure_data.model_dump(exclude_unset=True, exclude_none=True)
            
            # Log field names only — never password or other secret values
            logger.info(
                "User %s self-update fields=%s",
                user_id,
                sorted(k for k in update_dict.keys() if k != "password"),
            )
            
            # Create a new UserUpdate object with only the allowed fields
            allowed_fields = ['email', 'first_name', 'last_name', 'phone_number', 'phoneNumber', 'password']
            
            # Extract phone_number if present (handle both snake_case and camelCase)
            phone_number_value = update_dict.get('phone_number') or update_dict.get('phoneNumber')
            if phone_number_value:
                # Normalize to snake_case
                if 'phoneNumber' in update_dict:
                    update_dict['phone_number'] = update_dict.pop('phoneNumber')
            
            filtered_data = {k: v for k, v in update_dict.items() if k in allowed_fields}
            
            logger.info(
                "User %s filtered self-update fields=%s",
                user_id,
                sorted(k for k in filtered_data.keys() if k != "password"),
            )            
            # Create a new UserUpdate object with the filtered data
            filtered_update = UserUpdate(**filtered_data)
            
            # Use the regular update method with the sanitized data
            # Pass is_self_edit=True since this is called from /users/me endpoint
            return await UserService.update_user(db, user_id, filtered_update, is_self_edit=True)
            
        except Exception as e:
            logger.error(f"Error in secure update for user {user_id}: {e}")
            raise

    #--------------------------------
    # Delete User
    #--------------------------------
    @staticmethod
    async def delete_user(db: Session, user_id: UUID, org_id: Optional[UUID] = None) -> None:
        """Delete user with optional org filtering"""
        try:
            # Get user and verify org access if needed
            user = await UserService._get_user_object(db, user_id)
            
            if org_id and user.organization_id != org_id:
                raise NotFoundError("User not found in this organization")
            
            db.delete(user)
            db.commit()
            logger.info(f"🗑️ Deleted user {user_id}")
            
        except (NotFoundError, ConflictError):
            # Re-raise business exceptions as-is
            raise
        except IntegrityError as e:
            logger.error(f"Database constraint violation deleting user: {e}")
            db.rollback()
            raise ConflictError(
                f"Cannot delete user due to database constraints: {str(e)}"
            )
        except Exception as e:
            logger.error(f"Error deleting user: {e}")
            db.rollback()
            raise BadRequestError(f"Failed to delete user: {str(e)}")

    #--------------------------------
    # Internal Helper Methods
    #--------------------------------
    @staticmethod
    def _validate_role_keys_exist(db: Session, role_keys: List[str]) -> None:
        """Ensure every requested role key exists in the roles table before assignment."""
        if not role_keys:
            return
        unique_keys = list(dict.fromkeys(role_keys))
        existing_keys = {
            row.key
            for row in db.query(Role.key).filter(Role.key.in_(unique_keys)).all()
        }
        missing = [key for key in unique_keys if key not in existing_keys]
        if missing:
            raise ValidationError(
                "Unknown role(s): "
                + ", ".join(missing)
                + ". The role may not be installed in the database yet — contact your platform administrator."
            )

    @staticmethod
    def _add_user_roles_for_organization(db: Session, user: UserModel, org_id: UUID, role_keys: List[str]) -> None:
        """Add user roles for a specific organization"""
        UserService._validate_role_keys_exist(db, role_keys)
        for role_key in role_keys:
            role = db.query(Role).filter(Role.key == role_key).first()
            if role:
                user_role = UserRole(
                    user_id=user.id,
                    organization_id=org_id,
                    role_id=role.id
                )
                db.add(user_role)

    @staticmethod
    def _update_user_roles_scoped(db: Session, user: UserModel, roles: List[str], org_id: UUID) -> None:
        """Update user roles for a specific organization"""
        UserService._validate_role_keys_exist(db, roles)

        # Remove existing roles for this organization
        db.query(UserRole).filter(
            UserRole.user_id == user.id,
            UserRole.organization_id == org_id
        ).delete()
        
        # Add new roles
        UserService._add_user_roles_for_organization(db, user, org_id, roles)

    @staticmethod
    async def _get_user_object(db: Session, user_id: UUID) -> UserModel:
        """Get user object by ID"""
        user = db.query(UserModel).filter(UserModel.id == user_id).first()
        if not user:
            raise NotFoundError("User not found")
        return user

    #--------------------------------
    # Password Change Methods
    #--------------------------------
    @staticmethod
    async def change_user_password_with_verification(
        db: Session, 
        user_id: UUID, 
        current_password: str, 
        new_password: str
    ) -> bool:
        """Change user password with current password verification"""
        try:
            from app.v1.auth.services import Auth2Service
            
            user = await UserService._get_user_object(db, user_id)
            
            # Use consolidated password validation and update logic
            auth_service = Auth2Service(db)
            await auth_service._validate_and_update_password(
                user=user,
                new_password=new_password,
                current_password=current_password,
                require_current_password=True
            )
            
            logger.info(f"User {user_id} changed their own password")
            return True
            
        except Exception as e:
            logger.error(f"Error changing password for user {user_id}: {e}")
            db.rollback()
            raise

    @staticmethod
    async def set_user_password_for_oauth_account(
        db: Session,
        user_id: UUID,
        new_password: str
    ) -> bool:
        """Create the first local password for an OAuth-only account."""
        try:
            from app.v1.auth.services import Auth2Service

            user = await UserService._get_user_object(db, user_id)

            has_local_password = bool(
                getattr(user, "password_hash", None) and str(user.password_hash).strip()
            )
            if has_local_password:
                raise ValidationError("This account already has a password. Use change password instead.")

            auth_service = Auth2Service(db)
            await auth_service._validate_and_update_password(
                user=user,
                new_password=new_password,
                require_current_password=False
            )

            logger.info(f"User {user_id} created first local password for OAuth account")
            return True
        except Exception as e:
            logger.error(f"Error creating password for OAuth account {user_id}: {e}")
            db.rollback()
            raise

    @staticmethod
    async def admin_change_user_password(
        db: Session, 
        user_id: UUID, 
        new_password: str,
        org_id: Optional[UUID] = None
    ) -> None:
        """Admin change user password without old password verification"""
        try:
            from app.v1.auth.services import Auth2Service
            
            user = await UserService._get_user_object(db, user_id)
            
            # Verify org access if needed
            if org_id and user.organization_id != org_id:
                raise NotFoundError("User not found in this organization")

            has_local_password = bool(
                getattr(user, "password_hash", None) and str(user.password_hash).strip()
            )
            oauth_count = db.query(UserOAuthIdentity).filter(UserOAuthIdentity.user_id == user_id).count()
            if not has_local_password and oauth_count > 0:
                raise ValidationError(
                    "This user signs in with a linked provider (such as Google) and has no local password. "
                    "You cannot set or change a password for this account."
                )
            
            # Use consolidated password validation and update logic
            auth_service = Auth2Service(db)
            await auth_service._validate_and_update_password(
                user=user,
                new_password=new_password,
                require_current_password=False
            )
            
            # Revoke all refresh tokens for security (same as password reset)
            from app.v1.auth.model import RefreshToken
            db.query(RefreshToken).filter_by(
                user_id=user.id,
                revoked=False
            ).update({"revoked": True})
            
            # Set must_change_password flag for admin changes
            user.must_change_password = True
            db.commit()
            
            logger.info(f"Admin changed password for user {user_id}")
            
        except Exception as e:
            logger.error(f"Error in admin password change for user {user_id}: {e}")
            db.rollback()
            raise

    #--------------------------------
    # Get User Statistics
    #--------------------------------
    @staticmethod
    async def get_user_statistics(
        db: Session,
        org_id: Optional[UUID] = None
    ) -> Dict[str, int]:
        """Get user statistics for an organization"""
        try:
            # Base query with org filtering
            base_query = db.query(UserModel)
            if org_id:
                base_query = base_query.filter(UserModel.organization_id == org_id)
            
            # Total users
            total_users = base_query.count()
            
            # Active users (not locked)
            active_users = base_query.filter(UserModel.locked == False).count()
            
            # Locked users
            locked_users = base_query.filter(UserModel.locked == True).count()
            
            return {
                "totalUsers": total_users,
                "activeUsers": active_users,
                "lockedUsers": locked_users
            }
            
        except Exception as e:
            logger.error(f"Error getting user statistics: {e}")
            return {
                "totalUsers": 0,
                "activeUsers": 0,
                "lockedUsers": 0
            }
