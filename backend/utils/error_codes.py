"""
Standardized error handling for AuraQC API.

All error responses should include:
- error_code: Machine-readable error code (e.g., RCA_001)
- message: Human-readable error message
- request_id: Request ID for tracing
"""

from fastapi import status
from pydantic import BaseModel


class StandardErrorResponse(BaseModel):
    """Standardized error response format."""
    error_code: str
    message: str
    request_id: str | None = None


# Error code definitions
ERROR_CODES = {
    "RCA_001": {
        "status": status.HTTP_502_BAD_GATEWAY,
        "description": "Ollama unavailable",
    },
    "RCA_002": {
        "status": status.HTTP_502_BAD_GATEWAY,
        "description": "All Ollama endpoints failed",
    },
    "RCA_003": {
        "status": status.HTTP_429_TOO_MANY_REQUESTS,
        "description": "Rate limit exceeded",
    },
    "RCA_004": {
        "status": status.HTTP_401_UNAUTHORIZED,
        "description": "Invalid or missing auth token",
    },
    "RCA_005": {
        "status": status.HTTP_422_UNPROCESSABLE_ENTITY,
        "description": "Malformed request body",
    },
    "RCA_006": {
        "status": status.HTTP_404_NOT_FOUND,
        "description": "Cluster not found",
    },
    "RCA_007": {
        "status": status.HTTP_500_INTERNAL_SERVER_ERROR,
        "description": "Internal server error",
    },
    "RCA_008": {
        "status": status.HTTP_422_UNPROCESSABLE_ENTITY,
        "description": "Invalid task type",
    },
    "RCA_009": {
        "status": status.HTTP_502_BAD_GATEWAY,
        "description": "Model response parsing failed",
    },
    "RCA_010": {
        "status": status.HTTP_500_INTERNAL_SERVER_ERROR,
        "description": "Response post-processing failed",
    },
    "RCA_011": {
        "status": status.HTTP_503_SERVICE_UNAVAILABLE,
        "description": "Investigation question generation failed",
    },
    "RCA_012": {
        "status": status.HTTP_422_UNPROCESSABLE_ENTITY,
        "description": "Task type conflicts with requested intent",
    },
    "AUTH_001": {
        "status": status.HTTP_401_UNAUTHORIZED,
        "description": "Missing bearer token",
    },
    "AUTH_002": {
        "status": status.HTTP_401_UNAUTHORIZED,
        "description": "Token expired",
    },
    "AUTH_003": {
        "status": status.HTTP_401_UNAUTHORIZED,
        "description": "Invalid token format",
    },
    "AUTH_004": {
        "status": status.HTTP_403_FORBIDDEN,
        "description": "Insufficient permissions",
    },
    "RES_001": {
        "status": status.HTTP_404_NOT_FOUND,
        "description": "Resource not found",
    },
}


def get_error_status(error_code: str) -> int:
    """Get HTTP status code for an error code."""
    return ERROR_CODES.get(error_code, {}).get("status", status.HTTP_500_INTERNAL_SERVER_ERROR)


def get_error_description(error_code: str) -> str:
    """Get human-readable description for an error code."""
    return ERROR_CODES.get(error_code, {}).get("description", "Unknown error")


def build_error_response(error_code: str, custom_message: str | None = None, request_id: str | None = None) -> dict:
    """
    Build a standardized error response.
    
    Args:
        error_code: Error code (e.g., 'RCA_001')
        custom_message: Optional custom message to override the default description
        request_id: Optional request ID for tracing
    
    Returns:
        Dict with error_code, message, and request_id
    """
    message = custom_message or get_error_description(error_code)
    return {
        "error_code": error_code,
        "message": message,
        "request_id": request_id,
    }
