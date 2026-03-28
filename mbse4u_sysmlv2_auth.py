#    Authentication helpers and custom exceptions for the MBSE4U SysML v2 API helpers.
#
#    Inspired by the Open-MBEE sysmlv2-python-client project
#    (https://github.com/Open-MBEE/sysmlv2-python-client).
#
#    Copyright 2026 Tim Weilkiens
#
#    Licensed under the Apache License, Version 2.0 (the "License");
#    you may not use this file except in compliance with the License.
#    You may obtain a copy of the License at
#
#        http://www.apache.org/licenses/LICENSE-2.0
#
#    Unless required by applicable law or agreed to in writing, software
#    distributed under the License is distributed on an "AS IS" BASIS,
#    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#    See the License for the specific language governing permissions and
#    limitations under the License.
#
#    Author: Tim Weilkiens
#    Date: 2026-03-07
#    Version: 1.0.0

"""
mbse4u_sysmlv2_auth
===================
Authentication and exception helpers for the MBSE4U SysML v2 API helpers.

Usage
-----
Call :func:`configure_session` once at the start of your script/application
before using any function from ``mbse4u_sysmlv2_api_helpers``:

    from mbse4u_sysmlv2_auth import configure_session

    configure_session("Bearer <your_token_here>")

The Bearer token is the same token used by the Open-MBEE Flexo SysMLv2 service
(found in ``flexo-setup/docker-compose/env/flexo-sysmlv2.env`` under
``FLEXO_AUTH``). It must start with the string ``"Bearer "``.
"""

import requests
from typing import Optional

# ---------------------------------------------------------------------------
# Custom Exceptions  (mirrors Open-MBEE sysmlv2_client/exceptions.py)
# ---------------------------------------------------------------------------

class SysMLV2Error(Exception):
    """Base class for all SysML v2 API errors."""
    pass


class SysMLV2AuthError(SysMLV2Error):
    """Raised when authentication fails (HTTP 401 or 403)."""
    pass


class SysMLV2APIError(SysMLV2Error):
    """Raised for generic API errors returned by the server."""
    def __init__(self, status_code: int, message: str = "API request failed"):
        self.status_code = status_code
        self.message = f"{message} (HTTP {status_code})"
        super().__init__(self.message)


class SysMLV2NotFoundError(SysMLV2APIError):
    """Raised when the requested resource does not exist (HTTP 404)."""
    def __init__(self, message: str = "Resource not found"):
        super().__init__(status_code=404, message=message)


class SysMLV2BadRequestError(SysMLV2APIError):
    """Raised for malformed requests (HTTP 400)."""
    def __init__(self, message: str = "Bad request"):
        super().__init__(status_code=400, message=message)


class SysMLV2ConflictError(SysMLV2APIError):
    """Raised when a conflict is detected on the server (HTTP 409)."""
    def __init__(self, message: str = "Conflict detected"):
        super().__init__(status_code=409, message=message)


# ---------------------------------------------------------------------------
# Session configuration
# ---------------------------------------------------------------------------

def configure_session(bearer_token: str, base_url: Optional[str] = None) -> requests.Session:
    """Configure the shared HTTP session used by mbse4u_sysmlv2_api_helpers.

    This function must be called **once** before any API helper function is
    invoked.  It injects the ``Authorization`` header (and optionally a
    ``base_url`` for reference) into the module-level session so that all
    subsequent requests are authenticated automatically.

    Args:
        bearer_token (str): The full Bearer token string, e.g.
            ``"Bearer eyJ0eXAiOiJKV1Qi..."``  The value must start with
            ``"Bearer "`` (case-insensitive).
        base_url (str, optional): The base URL of the SysML v2 API server
            (e.g. ``"http://localhost:8083"``).  Stored on the session for
            informational purposes but not used directly by this function.

    Returns:
        requests.Session: The configured session object (same object used by
        mbse4u_sysmlv2_api_helpers).

    Raises:
        ValueError: If ``bearer_token`` is empty or does not start with
            ``"Bearer "``.

    Example::

        from mbse4u_sysmlv2_auth import configure_session
        configure_session("Bearer MY_SECRET_TOKEN", "http://localhost:8083")
    """
    if not bearer_token:
        raise ValueError("bearer_token cannot be empty.")
    if not bearer_token.lower().startswith("bearer "):
        raise ValueError(
            "bearer_token must start with 'Bearer ' (e.g. 'Bearer YOUR_TOKEN')."
        )

    # Import here (not at module level) to avoid circular imports if this
    # module is ever imported before mbse4u_sysmlv2_api_helpers.
    import mbse4u_sysmlv2_api_helpers as _helpers  # noqa: PLC0415

    _helpers.session.headers.update({
        "Authorization": bearer_token,
        "Content-Type": "application/json",
        "Accept": "application/json",
    })

    # Attach base_url as a convenience attribute (not used internally).
    _helpers.session.base_url = base_url  # type: ignore[attr-defined]

    return _helpers.session


def get_session() -> requests.Session:
    """Return the shared session used by mbse4u_sysmlv2_api_helpers.

    Useful for inspecting headers or adding further configuration (e.g.
    custom SSL certificates, proxy settings).

    Returns:
        requests.Session: The shared session object.
    """
    import mbse4u_sysmlv2_api_helpers as _helpers  # noqa: PLC0415
    return _helpers.session
