"""
Render.com API helper for managing custom domains
"""
import httpx
from typing import Optional
from app.common.config import RENDER_API_KEY, get_render_custom_domain_service_id
from app.common.app_logger import get_logger

logger = get_logger(__name__)

RENDER_API_BASE_URL = "https://api.render.com/v1"


class RenderHelper:
    """Helper class for interacting with Render.com API"""
    
    @staticmethod
    async def add_custom_domain(domain: str) -> dict:
        """
        Add a custom domain to the Render service
        
        Args:
            domain: The domain name to add (e.g., "learn.organization.com" or "acme.example.com")
            
        Returns:
            dict: Response from Render API
            
        Raises:
            Exception: If API call fails
        """
        if not RENDER_API_KEY:
            logger.warning("RENDER_API_KEY not configured, skipping Render domain addition")
            raise ValueError("RENDER_API_KEY not configured")

        service_id = get_render_custom_domain_service_id()
        if not service_id:
            logger.warning(
                "No Render target service id (set RENDER_CUSTOM_DOMAIN_SERVICE_ID)"
            )
            raise ValueError(
                "Render target service not configured: set RENDER_CUSTOM_DOMAIN_SERVICE_ID "
                "to the web/static service that serves this domain"
            )

        method_logger = logger.get_method_logger("add_custom_domain")
        method_logger.info(f"Adding domain {domain} to Render service {service_id}")

        url = f"{RENDER_API_BASE_URL}/services/{service_id}/custom-domains"
        headers = {
            "Authorization": f"Bearer {RENDER_API_KEY}",
            "Accept": "application/json"
        }
        payload = {
            "name": domain
        }
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                result = response.json()
                method_logger.info(f"Successfully added domain {domain} to Render: {result}")
                return result
        except httpx.HTTPStatusError as e:
            error_msg = f"Render API error: {e.response.status_code} - {e.response.text}"
            method_logger.error(f"Failed to add domain {domain} to Render: {error_msg}")
            raise Exception(error_msg)
        except Exception as e:
            error_msg = f"Failed to add domain {domain} to Render: {str(e)}"
            method_logger.error(error_msg)
            raise Exception(error_msg)
    
    @staticmethod
    async def verify_dns_configuration(domain_id: str) -> dict:
        """
        Verify DNS configuration for a custom domain
        
        Args:
            domain_id: The ID of the custom domain in Render
            
        Returns:
            dict: Response from Render API
        """
        service_id = get_render_custom_domain_service_id()
        if not RENDER_API_KEY or not service_id:
            raise ValueError("Render API not configured")

        method_logger = logger.get_method_logger("verify_dns_configuration")
        method_logger.info(f"Verifying DNS for domain {domain_id}")

        url = f"{RENDER_API_BASE_URL}/services/{service_id}/custom-domains/{domain_id}/verify"
        headers = {
            "Authorization": f"Bearer {RENDER_API_KEY}",
            "Accept": "application/json"
        }
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, headers=headers)
                response.raise_for_status()
                result = response.json()
                method_logger.info(f"DNS verification result for {domain_id}: {result}")
                return result
        except httpx.HTTPStatusError as e:
            error_msg = f"Render API error: {e.response.status_code} - {e.response.text}"
            method_logger.error(f"Failed to verify DNS for domain {domain_id}: {error_msg}")
            raise Exception(error_msg)
        except Exception as e:
            error_msg = f"Failed to verify DNS for domain {domain_id}: {str(e)}"
            method_logger.error(error_msg)
            raise Exception(error_msg)

