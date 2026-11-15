"""Scoped access tokens for private R2 media playback."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import parse_qsl, quote, urlencode, urlparse, urlunparse, unquote
from uuid import UUID

from jose import jwt
from sqlalchemy.orm import Session

from app.common.business_exceptions import AuthorizationError, ValidationError
from app.common.config import (
    MEDIA_ACCESS_TOKEN_ALGORITHM,
    MEDIA_ACCESS_TOKEN_EXPIRE_MINUTES,
    MEDIA_ACCESS_TOKEN_SECRET,
    R2_MEDIA_SERVER_WORKER_URL,
)
from app.v1.auth.schema import UserTokenInfo

_MEDIA_ADMIN_ROLES = {"org_admin", "super_admin"}
_WORKER_AUTH_QUERY_PARAMS = {"token", "expires", "local", "mediatoken", "media_token"}


class MediaAccessService:
    """Authorize and sign private media URLs for playback."""

    @staticmethod
    def sign_access_url(
        db: Session,
        *,
        current_user: UserTokenInfo,
        media_url: Optional[str] = None,
        object_key: Optional[str] = None,
        asset_id: Optional[UUID] = None,
    ) -> dict:
        org_id = current_user.organization_id
        if not org_id:
            raise AuthorizationError("Organization not found in token")

        roles = set(current_user.roles or [])
        if asset_id:
            from app.v1.media.media_asset_service import MediaAssetService

            asset = MediaAssetService.get_asset_for_signing(
                db,
                current_user=current_user,
                asset_id=asset_id,
            )
            MediaAccessService.assert_user_can_access_object(
                current_user=current_user,
                object_key=asset.source_object_key,
                organization_id=asset.organization_id,
            )
            key = asset.source_object_key
            token_org_id = asset.organization_id
        else:
            # Key-only signing is media-admin; end users must pass assetId for playback.
            if not (roles & _MEDIA_ADMIN_ROLES):
                raise AuthorizationError("You are not authorized to access this media")
            key = MediaAccessService.normalize_object_key(
                object_key=object_key,
                media_url=media_url,
                organization_id=org_id,
                allow_any_org="super_admin" in roles,
            )
            token_org_id = MediaAccessService.organization_id_from_object_key(key)
            MediaAccessService.assert_user_can_access_object(
                current_user=current_user,
                object_key=key,
                organization_id=token_org_id,
            )

        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(minutes=MEDIA_ACCESS_TOKEN_EXPIRE_MINUTES)
        token = MediaAccessService._encode_media_token(
            current_user=current_user,
            object_key=key,
            organization_id=token_org_id,
            issued_at=now,
            expires_at=expires_at,
        )
        return {
            "playback_url": MediaAccessService.build_playback_url(
                object_key=key,
                media_url=media_url,
                media_token=token,
            ),
            "object_key": key,
            "expires_in": int((expires_at - now).total_seconds()),
            "expires_at": expires_at,
            "delivery": "object",
        }

    @staticmethod
    def normalize_object_key(
        *,
        organization_id: UUID,
        object_key: Optional[str] = None,
        media_url: Optional[str] = None,
        allow_any_org: bool = False,
    ) -> str:
        raw = (object_key or "").strip()
        if not raw and media_url:
            raw = MediaAccessService._object_key_from_url(
                media_url,
                None if allow_any_org else organization_id,
            ) or ""
        if not raw:
            raise ValidationError("objectKey or mediaUrl is required")

        key = unquote(raw).strip().lstrip("/")
        if not key or ".." in key.split("/"):
            raise ValidationError("Invalid media object key")
        if allow_any_org:
            MediaAccessService.organization_id_from_object_key(key)
        else:
            expected_prefix = f"orgs/{organization_id}/"
            if not key.startswith(expected_prefix):
                raise AuthorizationError("You are not authorized to access this media")
        return key

    @staticmethod
    def organization_id_from_object_key(object_key: str) -> UUID:
        parts = (object_key or "").split("/")
        if len(parts) < 2 or parts[0] != "orgs":
            raise ValidationError("Invalid media object key")
        try:
            return UUID(parts[1])
        except ValueError as exc:
            raise ValidationError("Invalid media object key") from exc

    @staticmethod
    def assert_user_can_access_object(
        *,
        current_user: UserTokenInfo,
        object_key: str,
        organization_id: UUID,
    ) -> None:
        roles = set(current_user.roles or [])
        if "super_admin" in roles:
            return
        if current_user.organization_id != organization_id:
            raise AuthorizationError("You are not authorized to access this media")
        if roles & _MEDIA_ADMIN_ROLES:
            return
        expected_prefix = f"orgs/{organization_id}/"
        if not object_key.startswith(expected_prefix):
            raise AuthorizationError("You are not authorized to access this media")
        if not current_user.id:
            raise AuthorizationError("You are not authorized to access this media")

    @staticmethod
    def build_playback_url(
        *,
        object_key: str,
        media_url: Optional[str],
        media_token: str,
    ) -> str:
        base_url = MediaAccessService._clean_base_url(media_url)
        if not base_url:
            worker_url = (R2_MEDIA_SERVER_WORKER_URL or "").strip().rstrip("/")
            if not worker_url:
                raise ValidationError("Private media worker URL is not configured")
            base_url = f"{worker_url}/{quote(object_key, safe='/')}"

        parsed = urlparse(base_url)
        query = [
            (key, value)
            for key, value in parse_qsl(parsed.query, keep_blank_values=True)
            if key.lower() not in _WORKER_AUTH_QUERY_PARAMS
        ]
        query.append(("mediaToken", media_token))
        return urlunparse(
            (
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                parsed.params,
                urlencode(query),
                parsed.fragment,
            )
        )

    @staticmethod
    def _encode_media_token(
        *,
        current_user: UserTokenInfo,
        object_key: str,
        organization_id: UUID,
        issued_at: datetime,
        expires_at: datetime,
    ) -> str:
        if not MEDIA_ACCESS_TOKEN_SECRET:
            raise ValidationError("Media access token secret is not configured")
        payload = {
            "purpose": "media",
            "sub": str(current_user.id),
            "org_id": str(organization_id),
            "object_key": object_key,
            "iat": issued_at,
            "exp": expires_at,
            "aud": "r2-private-worker",
        }
        if current_user.session_id:
            payload["sid"] = current_user.session_id
        return jwt.encode(payload, MEDIA_ACCESS_TOKEN_SECRET, algorithm=MEDIA_ACCESS_TOKEN_ALGORITHM)

    @staticmethod
    def _object_key_from_url(url: str, organization_id: Optional[UUID]) -> Optional[str]:
        text = (url or "").strip()
        if not text:
            return None
        clean = text.split("?", 1)[0]
        path = urlparse(clean).path if "://" in clean else clean
        path = unquote(path).lstrip("/")
        org_prefix = f"orgs/{organization_id}/" if organization_id else "orgs/"
        idx = path.find(org_prefix)
        if idx < 0:
            return None
        return path[idx:]

    @staticmethod
    def _clean_base_url(url: Optional[str]) -> Optional[str]:
        text = (url or "").strip()
        if not text or "://" not in text:
            return None
        parsed = urlparse(text)
        if not MediaAccessService._is_trusted_worker_url(parsed):
            return None
        query = [
            (key, value)
            for key, value in parse_qsl(parsed.query, keep_blank_values=True)
            if key.lower() not in _WORKER_AUTH_QUERY_PARAMS
        ]
        return urlunparse(
            (
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                parsed.params,
                urlencode(query),
                parsed.fragment,
            )
        )

    @staticmethod
    def _is_trusted_worker_url(parsed) -> bool:
        worker_url = (R2_MEDIA_SERVER_WORKER_URL or "").strip()
        if not worker_url:
            return False
        configured = urlparse(worker_url if "://" in worker_url else f"https://{worker_url}")
        return (
            parsed.scheme in {"http", "https"}
            and configured.netloc
            and parsed.netloc.lower() == configured.netloc.lower()
        )
