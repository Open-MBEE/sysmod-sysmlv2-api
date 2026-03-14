#
#   SYSMOD MCP Server
#
#   Exposes SYSMOD Flask API endpoints as MCP tools so that any
#   MCP-compatible AI agent (Claude, Cursor, GitHub Copilot, …) can
#   query and update a SysML v2 / SYSMOD model via natural language.
#
#   Prerequisites:
#     1. The SYSMOD Flask server (sysmod_api_server.py) must be running.
#     2. Install:  pip install "mcp[cli]>=1.0.0"
#
#   Run (stdio transport — for Claude Desktop / Cursor):
#     python sysmod_mcp_server.py
#
#   Run (dev inspector — browser UI to test tools interactively):
#     mcp dev sysmod_mcp_server.py
#
#   Copyright 2025 Tim Weilkiens
#
#   Licensed under the Apache License, Version 2.0 (the "License");
#   you may not use this file except in compliance with the License.
#   You may obtain a copy of the License at
#
#       http://www.apache.org/licenses/LICENSE-2.0
#
#   Unless required by applicable law or agreed to in writing, software
#   distributed under the License is distributed on an "AS IS" BASIS,
#   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#   See the License for the specific language governing permissions and
#   limitations under the License.
#

from __future__ import annotations

import os
from typing import Annotated

import requests
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

load_dotenv()

# ---------------------------------------------------------------------------
# Configuration — all values can be set in .env or overridden per tool call
# ---------------------------------------------------------------------------

FLASK_BASE_URL         = os.environ.get("FLASK_BASE_URL",          "http://localhost:5000")
DEFAULT_SERVER_URL     = os.environ.get("SYSML_SERVER_URL",         "")
DEFAULT_PROJECT_ID     = os.environ.get("SYSML_PROJECT_ID",         "")
DEFAULT_COMMIT_ID      = os.environ.get("SYSML_COMMIT_ID",          "")
DEFAULT_SYSMOD_PROJECT = os.environ.get("SYSML_SYSMOD_PROJECT_ID",  "")

# ---------------------------------------------------------------------------
# MCP server instance
# ---------------------------------------------------------------------------

mcp = FastMCP(
    "SYSMOD Agent",
    instructions=(
        "You are an expert MBSE assistant with access to a live SysML v2 / SYSMOD model repository. "
        "Use the available tools to retrieve project information, artifacts, and quality checks. "
        "Always start by calling get_sysmod_atlas to understand which artifacts exist before diving "
        "into details. When the user asks to refine or update artefacts, use the write tools."
    ),
    # These packages are injected into the uv-managed env used by `mcp dev`.
    # Without them the server subprocess fails immediately on `import requests`.
    dependencies=["requests", "python-dotenv"],
)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _post(endpoint: str, payload: dict) -> dict | list:
    """POST to the Flask API and return parsed JSON, or raise on HTTP error."""
    url = f"{FLASK_BASE_URL}{endpoint}"
    try:
        resp = requests.post(url, json=payload, timeout=60)
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.ConnectionError:
        return {"error": f"Cannot reach Flask server at {FLASK_BASE_URL}. Is sysmod_api_server.py running?"}
    except requests.exceptions.HTTPError as exc:
        return {"error": f"HTTP {exc.response.status_code}: {exc.response.text}"}


def _ctx(
    server_url: str = "",
    project_id: str = "",
    commit_id: str = "",
    sysmod_project_id: str = "",
) -> dict:
    """Build the standard context dict, falling back to .env defaults."""
    return {
        "server_url":        server_url        or DEFAULT_SERVER_URL,
        "project_id":        project_id        or DEFAULT_PROJECT_ID,
        "commit_id":         commit_id          or DEFAULT_COMMIT_ID,
        "sysmod_project_id": sysmod_project_id or DEFAULT_SYSMOD_PROJECT,
    }


# ---------------------------------------------------------------------------
# Discovery tools
# ---------------------------------------------------------------------------

@mcp.tool()
def get_projects(
    server_url: Annotated[str, "SysML v2 server URL, e.g. http://localhost:9000"] = "",
) -> dict | list:
    """List all SysML v2 projects available on the server."""
    return _post("/api/projects", {"server_url": server_url or DEFAULT_SERVER_URL})


@mcp.tool()
def get_commits(
    project_id: Annotated[str, "SysML v2 project UUID"] = "",
    server_url: Annotated[str, "SysML v2 server URL"] = "",
) -> dict | list:
    """List commits for a SysML v2 project."""
    return _post("/api/commits", {
        "server_url": server_url or DEFAULT_SERVER_URL,
        "project_id": project_id or DEFAULT_PROJECT_ID,
    })


@mcp.tool()
def get_sysmod_projects(
    server_url: Annotated[str, "SysML v2 server URL"] = "",
    project_id: Annotated[str, "SysML v2 project UUID"] = "",
    commit_id:  Annotated[str, "Commit UUID"] = "",
) -> dict | list:
    """
    List SYSMOD projects found within a SysML v2 repository commit.
    A SYSMOD project is an OccurrenceDefinition specializing SYSMOD::Project.
    Returns name and element ID for each SYSMOD project.
    """
    ctx = _ctx(server_url, project_id, commit_id)
    return _post("/api/sysmod_projects", ctx)


@mcp.tool()
def get_sysmod_project(
    element_id: Annotated[str, "Element UUID of the SYSMOD project"],
    server_url:  Annotated[str, "SysML v2 server URL"] = "",
    project_id:  Annotated[str, "SysML v2 project UUID"] = "",
    commit_id:   Annotated[str, "Commit UUID"] = "",
) -> dict:
    """
    Get the name and documentation of a specific SYSMOD project element.
    Use get_sysmod_projects first to discover the element_id.
    """
    ctx = _ctx(server_url, project_id, commit_id)
    ctx["element_id"] = element_id
    return _post("/api/sysmod_project", ctx)


@mcp.tool()
def get_element(
    element_id: Annotated[str, "Element UUID to retrieve"],
    server_url:  Annotated[str, "SysML v2 server URL"] = "",
    project_id:  Annotated[str, "SysML v2 project UUID"] = "",
    commit_id:   Annotated[str, "Commit UUID"] = "",
) -> dict:
    """
    Retrieve any SysML v2 model element by its UUID.
    Returns the full element data including documentation if available.
    """
    ctx = _ctx(server_url, project_id, commit_id)
    ctx["element_id"] = element_id
    return _post("/api/element", ctx)


# ---------------------------------------------------------------------------
# SYSMOD Atlas / Overview
# ---------------------------------------------------------------------------

@mcp.tool()
def get_sysmod_atlas(
    load_all: Annotated[bool, "If True, actively check all artifact categories (slower but thorough)"] = True,
    server_url:        Annotated[str, "SysML v2 server URL"] = "",
    project_id:        Annotated[str, "SysML v2 project UUID"] = "",
    commit_id:         Annotated[str, "Commit UUID"] = "",
    sysmod_project_id: Annotated[str, "SYSMOD project element UUID"] = "",
) -> dict:
    """
    Return the SYSMOD Atlas — a completeness overview showing which SYSMOD artifacts
    exist in the model (problem statement, system idea, contexts, stakeholders,
    use cases, requirements, feature tree).

    Keys in the returned dict:
      PS       — Problem Statement
      SIC      — System Idea Context
      BFAC     — Brownfield (As-Is) Context
      SC       — System (Requirement) Context
      STAKE    — Stakeholders
      UC       — Use Cases
      RE       — Requirements
      FUC      — Functional Architecture Context
      LAC      — Logical Architecture Context
      PAC      — Product Architecture Context
      FEATURE  — Feature Tree

    Use this as the first tool to call when onboarding to a new SYSMOD project.
    """
    payload = {**_ctx(server_url, project_id, commit_id, sysmod_project_id), "loadAll": load_all}
    return _post("/api/sysmod-atlas", payload)


# ---------------------------------------------------------------------------
# SYSMOD Artifact tools (read)
# ---------------------------------------------------------------------------

@mcp.tool()
def get_problem_statement(
    server_url:        Annotated[str, "SysML v2 server URL"] = "",
    project_id:        Annotated[str, "SysML v2 project UUID"] = "",
    commit_id:         Annotated[str, "Commit UUID"] = "",
    sysmod_project_id: Annotated[str, "SYSMOD project element UUID"] = "",
) -> dict:
    """
    Retrieve the problem statement from the SYSMOD model.
    The problem statement (SYSMOD::Project::problemStatement) describes the core
    challenge the system must address, ideally starting with 'How can we…'.
    Returns: {id: element_uuid, body: text}
    """
    return _post("/api/problem-statement", _ctx(server_url, project_id, commit_id, sysmod_project_id))


@mcp.tool()
def get_system_idea(
    server_url:        Annotated[str, "SysML v2 server URL"] = "",
    project_id:        Annotated[str, "SysML v2 project UUID"] = "",
    commit_id:         Annotated[str, "Commit UUID"] = "",
    sysmod_project_id: Annotated[str, "SYSMOD project element UUID"] = "",
) -> dict:
    """
    Retrieve the system idea from the SYSMOD model.
    The system idea is a brief textual description of the envisioned system
    (the 'systemOfInterest' inside the systemIdeaContext).
    Returns: {body: text}
    """
    return _post("/api/system-idea", _ctx(server_url, project_id, commit_id, sysmod_project_id))


@mcp.tool()
def get_system_context(
    context_type: Annotated[
        str,
        "One of: BROWNFIELD | SYSTEMIDEA | SYSTEM | FUNCTIONAL | LOGICAL | PRODUCT"
    ],
    server_url:        Annotated[str, "SysML v2 server URL"] = "",
    project_id:        Annotated[str, "SysML v2 project UUID"] = "",
    commit_id:         Annotated[str, "Commit UUID"] = "",
    sysmod_project_id: Annotated[str, "SYSMOD project element UUID"] = "",
) -> dict:
    """
    Retrieve a SYSMOD system context diagram from the model.

    context_type values:
      BROWNFIELD  — existing (as-is) system landscape with external systems
      SYSTEMIDEA  — initial vision context showing the envisioned system
      SYSTEM      — requirement system context with system + actors
      FUNCTIONAL  — functional architecture context
      LOGICAL     — logical architecture context
      PRODUCT     — product / physical architecture context

    Returns: {context: element, system: system_of_interest, actors: [actor_elements]}
    """
    payload = {
        **_ctx(server_url, project_id, commit_id, sysmod_project_id),
        "context_type": context_type,
    }
    return _post("/api/sysmod-context", payload)


@mcp.tool()
def get_stakeholders(
    server_url:        Annotated[str, "SysML v2 server URL"] = "",
    project_id:        Annotated[str, "SysML v2 project UUID"] = "",
    commit_id:         Annotated[str, "Commit UUID"] = "",
    sysmod_project_id: Annotated[str, "SYSMOD project element UUID"] = "",
) -> dict | list:
    """
    Retrieve all project stakeholders from the SYSMOD model.
    Each stakeholder includes: name, description, contact, risk, effort, categories.
    """
    return _post("/api/stakeholders", _ctx(server_url, project_id, commit_id, sysmod_project_id))


@mcp.tool()
def get_requirements(
    server_url:        Annotated[str, "SysML v2 server URL"] = "",
    project_id:        Annotated[str, "SysML v2 project UUID"] = "",
    commit_id:         Annotated[str, "Commit UUID"] = "",
    sysmod_project_id: Annotated[str, "SYSMOD project element UUID"] = "",
) -> dict | list:
    """
    Retrieve system requirements from the SYSMOD model.
    Each requirement includes: identifier (shortName), name, uri, text,
    motivation, priority, obligation, stability.
    """
    return _post("/api/sysmod-requirements", _ctx(server_url, project_id, commit_id, sysmod_project_id))


@mcp.tool()
def get_use_cases(
    server_url:        Annotated[str, "SysML v2 server URL"] = "",
    project_id:        Annotated[str, "SysML v2 project UUID"] = "",
    commit_id:         Annotated[str, "Commit UUID"] = "",
    sysmod_project_id: Annotated[str, "SYSMOD project element UUID"] = "",
) -> dict | list:
    """
    Retrieve use cases from the SYSMOD model.
    Each use case includes: name, description, actors.
    """
    return _post("/api/sysmod-usecases", _ctx(server_url, project_id, commit_id, sysmod_project_id))


@mcp.tool()
def get_feature_tree(
    server_url:        Annotated[str, "SysML v2 server URL"] = "",
    project_id:        Annotated[str, "SysML v2 project UUID"] = "",
    commit_id:         Annotated[str, "Commit UUID"] = "",
    sysmod_project_id: Annotated[str, "SYSMOD project element UUID"] = "",
) -> dict:
    """
    Retrieve the feature tree in UVL (Universal Variability Language) format.
    The feature tree captures system variability — mandatory and optional features.
    Returns: {uvl_code: str}
    """
    return _post("/api/feature-tree-uvl", _ctx(server_url, project_id, commit_id, sysmod_project_id))


@mcp.tool()
def get_feature_bindings(
    server_url:        Annotated[str, "SysML v2 server URL"] = "",
    project_id:        Annotated[str, "SysML v2 project UUID"] = "",
    commit_id:         Annotated[str, "Commit UUID"] = "",
    sysmod_project_id: Annotated[str, "SYSMOD project element UUID"] = "",
) -> dict | list:
    """
    Retrieve feature binding dependencies from the SYSMOD model.
    Feature bindings (annotated with @FB) express dependencies between features.
    Each binding includes: id, type, client {name, id}, supplier {name, id}.
    """
    return _post("/api/feature-bindings", _ctx(server_url, project_id, commit_id, sysmod_project_id))


# ---------------------------------------------------------------------------
# Quality Checks
# ---------------------------------------------------------------------------

@mcp.tool()
def run_quality_checks(
    activated_views: Annotated[
        list[str],
        "Views to check, e.g. ['problem_statement', 'system_idea']. "
        "Available: problem_statement, system_idea",
    ],
    server_url:        Annotated[str, "SysML v2 server URL"] = "",
    project_id:        Annotated[str, "SysML v2 project UUID"] = "",
    commit_id:         Annotated[str, "Commit UUID"] = "",
    sysmod_project_id: Annotated[str, "SYSMOD project element UUID"] = "",
) -> dict | list:
    """
    Run automated SYSMOD model quality checks.
    Returns a list of check results, each with: id, title, description, status ('successful'|'failed').

    Example check IDs:
      SYSMOD-001 — Problem Statement present
      SYSMOD-002 — System Idea present
    """
    payload = {
        **_ctx(server_url, project_id, commit_id, sysmod_project_id),
        "activated_views": activated_views,
    }
    return _post("/api/quality-checks", payload)


# ---------------------------------------------------------------------------
# Write tools
# ---------------------------------------------------------------------------

@mcp.tool()
def save_problem_statement(
    text: Annotated[str, "The new problem statement text"],
    server_url:        Annotated[str, "SysML v2 server URL"] = "",
    project_id:        Annotated[str, "SysML v2 project UUID"] = "",
    commit_id:         Annotated[str, "Commit UUID"] = "",
    sysmod_project_id: Annotated[str, "SYSMOD project element UUID"] = "",
) -> dict:
    """
    Update the problem statement text in the SysML v2 model.
    Creates a new commit and returns: {status, message, commit_id}.
    Use this after refining the problem statement with the agent.
    """
    payload = {
        **_ctx(server_url, project_id, commit_id, sysmod_project_id),
        "text": text,
    }
    return _post("/api/problem-statement/save", payload)


# ---------------------------------------------------------------------------
# Cache management
# ---------------------------------------------------------------------------

@mcp.tool()
def warmup_cache(
    page_size: Annotated[int, "Number of elements to load per page (default 256)"] = 256,
    server_url: Annotated[str, "SysML v2 server URL"] = "",
    project_id: Annotated[str, "SysML v2 project UUID"] = "",
    commit_id:  Annotated[str, "Commit UUID"] = "",
) -> dict:
    """
    Pre-load all model elements into the Flask server's in-memory cache.
    Call this once before querying a large model to significantly speed up
    subsequent tool calls. Returns: {status, cached_elements}.
    """
    ctx = _ctx(server_url, project_id, commit_id)
    return _post("/api/cache/warmup", {
        "server_url": ctx["server_url"],
        "project_id": ctx["project_id"],
        "commit_id":  ctx["commit_id"],
        "page_size":  page_size,
    })


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="SYSMOD MCP Server")
    parser.add_argument(
        "--transport",
        choices=["stdio", "sse", "streamable-http"],
        default="stdio",
        help=(
            "Transport mode:\n"
            "  stdio            — for Claude Desktop / Cursor (default)\n"
            "  sse              — HTTP Server-Sent Events, for MCP Inspector\n"
            "  streamable-http  — streaming HTTP, for MCP Inspector (newer)\n"
        ),
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port to listen on for sse/streamable-http transports (default: 8000)",
    )
    args = parser.parse_args()

    if args.transport == "stdio":
        mcp.run(transport="stdio")
    else:
        mcp.run(transport=args.transport, port=args.port)
