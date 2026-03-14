# sysmod-sysmlv2-api-mcp

> A Flask-based REST API server, web UI, and **MCP (Model Context Protocol) server** for accessing and visualizing **SYSMOD** SysML v2 models.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Python](https://img.shields.io/badge/Python-3.8%2B-blue)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-REST%20API-green)](https://flask.palletsprojects.com/)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-purple)](https://modelcontextprotocol.io/)

> [!WARNING]
> **Work in Progress** — This project is under active development. Some features may be incomplete, use placeholder/dummy data, or behave unexpectedly. Contributions and feedback are welcome.

---

## Overview

**sysmod-sysmlv2-api-mcp** connects to a SysML v2 repository server and provides:

- 🔌 **REST API + Web UI** — interactive browser-based viewer and wizard for SYSMOD models  
- 🤖 **MCP Server** — exposes all SYSMOD artifacts as tools for AI agents (Claude, Cursor, GitHub Copilot, etc.)
- 🧠 **SYSMOD AI Agent** — an LLM can autonomously query problem statements, contexts, stakeholders, requirements, feature trees, and more directly from the SysML v2 model

```
┌─────────────────────┐   MCP (stdio/SSE)   ┌────────────────────────┐
│  SYSMOD AI Agent    │ ─────────────────→  │  sysmod_mcp_server.py  │
│ (Claude/Cursor/etc) │                     │  (FastMCP tools)       │
└─────────────────────┘                     └───────────┬────────────┘
                                                        │ HTTP REST
                                            ┌───────────▼────────────┐
          Browser ──────────────────────→   │  sysmod_api_server.py  │
                                            │  (Flask REST API)      │
                                            └───────────┬────────────┘
                                                        │ SysML v2 API
                                            ┌───────────▼────────────┐
                                            │  SysML v2 Repository   │
                                            └────────────────────────┘
```

---

## Features

### SYSMOD Viewer (`project.html`)

| Feature | Description |
|---|---|
| Project & Commit Selection | Browse SysML v2 projects and commits |
| SYSMOD Atlas | Completeness grid showing which artifacts exist |
| Problem Statement | Read and edit via SysML v2 API |
| System Idea | Displays description and AI-generated image |
| Context Diagrams | Brownfield, System Idea, Requirement, Functional, Logical, Product |
| Stakeholders | Lists stakeholders with attributes |
| Use Cases | Displays use cases from the model |
| Requirements | Lists system requirements with priorities and obligations |
| Feature Tree | UVL format with Mermaid graph visualization |
| Feature Binding Matrix | Interactive matrix for feature binding dependencies |
| Quality Checks | Automated SYSMOD model completeness checks |
| AI Suggestions | GPT-4o–powered suggestions to refine artifacts |
| Cache Warmup | Bulk element loading to speed up queries |

### SYSMOD Wizard (`sysmod-wizard.html`)

AI-assisted multi-step creation of new SYSMOD / SysML v2 models:

| Step | Name | Description |
|---|---|---|
| 1 | Project Setup | Define system name/description; generates SysML v2 scaffold |
| 2 | Brownfield Analysis | Upload documents; AI extracts existing system context |
| 3 | Problem Statement | AI generates concise problem statement |
| 4 | Stakeholders | AI suggests stakeholder attributes |
| 5 | System Idea | AI generates description and conceptual image |
| 6 | System Requirements | AI outputs SysML v2 requirements code |
| 7 | Use Cases | AI outputs SysML v2 use case definitions |
| 8 | Product Architecture | AI outputs initial product architecture code |

### SYSMOD MCP Server (`sysmod_mcp_server.py`)

Exposes 17 MCP tools — SYSMOD artifacts become directly queryable by any MCP-compatible AI agent:

| Category | Tools |
|---|---|
| **Discovery** | `get_projects`, `get_commits`, `get_sysmod_projects`, `get_sysmod_project`, `get_element` |
| **Overview** | `get_sysmod_atlas` |
| **Artifacts** | `get_problem_statement`, `get_system_idea`, `get_system_context`, `get_stakeholders`, `get_requirements`, `get_use_cases`, `get_feature_tree`, `get_feature_bindings` |
| **Quality** | `run_quality_checks` |
| **Write** | `save_problem_statement` |
| **Cache** | `warmup_cache` |

**Example agent prompts once connected:**
- *"Give me a summary of what this SYSMOD project is about."*
- *"Run quality checks and tell me what's missing."*
- *"Rewrite the problem statement following the 'How can we…' pattern and save it."*
- *"Walk me through all system contexts from brownfield to product architecture."*

---

## Architecture

```
sysmod-sysmlv2-api-mcp/
├── sysmod_api_server.py       # Main Flask application & REST API endpoints
├── sysmod_api_helpers.py      # SYSMOD-specific helper functions
├── sysmod_mcp_server.py       # MCP server (wraps Flask API as MCP tools)
├── pleml_api_server.py        # PLEML Flask Blueprint (feature tree & bindings)
├── pleml_api_helpers.py       # PLEML helper functions
├── html/
│   ├── index.html             # Project / Commit / SYSMOD Project selection
│   ├── project.html           # SYSMOD Viewer dashboard
│   └── sysmod-wizard.html     # AI-assisted model creation wizard
├── prompts/                   # AI prompt templates for wizard steps
├── uploads/                   # Uploaded reference documents (per system)
├── word/                      # Word macro templates
├── .env.example               # Environment variable template
└── requirements.txt
```

### Module Overview

| Module | Role |
|---|---|
| `sysmod_api_server.py` | Main Flask app; mounts `pleml_blueprint`, serves all SYSMOD REST endpoints |
| `sysmod_api_helpers.py` | SYSMOD model queries — problem statement, system idea, contexts, requirements, etc. |
| `sysmod_mcp_server.py` | MCP server facade; translates MCP tool calls to Flask REST calls |
| `pleml_api_server.py` | Flask Blueprint for all PLEML/feature endpoints; can run standalone on port 5001 |
| `pleml_api_helpers.py` | Feature tree (UVL) and feature binding helpers |

---

## Prerequisites

- **Python 3.8+**
- **Node.js / npm** (required only for `mcp dev` inspector UI)
- A running **SysML v2 API server** (e.g., [SysML v2 Reference Implementation](https://github.com/Systems-Modeling/SysML-v2-Release))
- An **OpenAI API key** *(optional — required only for AI wizard steps and suggestions)*

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/MBSE4U/sysmod-sysmlv2-api-mcp.git
cd sysmod-sysmlv2-api-mcp
```

### 2. Install Python dependencies

```bash
pip install -r requirements.txt
```

This installs Flask, requests, python-dotenv, anytree, werkzeug, mbse4u-sysml-helpers, and **mcp[cli]** (the MCP server SDK).

To enable PDF and Word document uploads in the wizard:
```bash
pip install pypdf python-docx
```

To enable AI features (OpenAI GPT-4o / DALL-E 3):
```bash
pip install openai
```

### 3. Configure environment variables

```bash
copy .env.example .env
```

Edit `.env`:

```env
# OpenAI (optional)
OPENAI_API_KEY=your_openai_api_key_here

# MCP Server — URL of the running Flask server
FLASK_BASE_URL=http://localhost:5000

# Default SysML v2 context (set these for zero-config MCP tool calls)
SYSML_SERVER_URL=http://localhost:9000
SYSML_PROJECT_ID=<your-project-uuid>
SYSML_COMMIT_ID=<your-commit-uuid>
SYSML_SYSMOD_PROJECT_ID=<your-sysmod-project-element-uuid>
```

> Setting the `SYSML_*` variables means the AI agent can call tools without needing to pass IDs every time.

---

## Usage

### Start the Flask server

```bash
python sysmod_api_server.py
```

Runs on `http://localhost:5000`. Open in browser to use the web UI.

---

## MCP Server Setup

The MCP server requires the Flask server to be running first.

### Option A — stdio (Claude Desktop / Cursor / VS Code)

Run the MCP server directly. It communicates via stdin/stdout with the AI client:

```bash
python sysmod_mcp_server.py
```

### Option B — SSE / HTTP (for testing with MCP Inspector)

Start the MCP server in HTTP mode so the browser inspector can connect:

```bash
# SSE transport on port 8000
python sysmod_mcp_server.py --transport sse --port 8000

# Streamable HTTP transport on port 8000 (newer)
python sysmod_mcp_server.py --transport streamable-http --port 8000
```

Then open the [MCP Inspector](https://inspector.tools.mcp.run/) in your browser, set the URL to `http://localhost:8000/sse` (or `/mcp` for streamable-http), and connect.

### Option C — mcp dev inspector (requires uv + Node.js/npm)

> [!NOTE]
> This requires `uv` ([install](https://docs.astral.sh/uv/)) and `npm` to be installed and on PATH.

**Windows — one-time setup:**
```powershell
# Install uv
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
# Add to PATH for this session (or add permanently via System Settings)
$env:PATH += ";$env:LOCALAPPDATA\Programs\uv\bin"
$env:PATH += ";$env:APPDATA\Python\Python313\Scripts"
```

**Launch inspector:**
```powershell
mcp dev sysmod_mcp_server.py --with requests --with python-dotenv
```

---

## Register with Claude Desktop

Add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sysmod": {
      "command": "python",
      "args": ["c:/path/to/sysmod-sysmlv2-api-mcp/sysmod_mcp_server.py"]
    }
  }
}
```

> The server reads all configuration from `.env` automatically. Restart Claude Desktop after editing.

---

## Register with Cursor

In **Cursor Settings → MCP Servers → Add**:

| Field | Value |
|---|---|
| Command | `python` |
| Args | `c:/path/to/sysmod-sysmlv2-api-mcp/sysmod_mcp_server.py` |

---

## API Endpoints

All Flask endpoints accept and return JSON (unless noted).

### SYSMOD Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/projects` | List projects on a SysML v2 server |
| `POST` | `/api/commits` | List commits for a project |
| `POST` | `/api/cache/warmup` | Bulk-load elements into cache |
| `POST` | `/api/sysmod_projects` | List SYSMOD projects in a commit |
| `POST` | `/api/sysmod_project` | Get SYSMOD project details |
| `POST` | `/api/element` | Get a model element by ID |
| `POST` | `/api/problem-statement` | Get the problem statement |
| `POST` | `/api/problem-statement/save` | Save an updated problem statement |
| `POST` | `/api/system-idea` | Get the system idea |
| `POST` | `/api/sysmod-context` | Get a context diagram (Brownfield, System, Functional, …) |
| `POST` | `/api/sysmod-requirements` | Get system requirements |
| `POST` | `/api/sysmod-usecases` | Get use cases |
| `POST` | `/api/stakeholders` | Get stakeholders |
| `POST` | `/api/quality-checks` | Run model quality checks |
| `POST` | `/api/sysmod-atlas` | Get SYSMOD Atlas completeness overview |
| `POST` | `/api/ai-suggestion_problem_statement` | AI-improved problem statement |
| `POST` | `/api/wizard/project-setup` | Wizard Step 1 — generate SysML v2 scaffold |
| `GET` | `/api/wizard/files` | List previously uploaded files |
| `POST` | `/api/wizard/brownfield` | Wizard Step 2 — brownfield analysis |
| `POST` | `/api/wizard/problem` | Wizard Step 3 — problem statement generation |
| `POST` | `/api/wizard/stakeholders` | Wizard Step 4 — stakeholder analysis |
| `POST` | `/api/wizard/system-idea` | Wizard Step 5 — system idea generation |
| `POST` | `/api/wizard/system-requirements` | Wizard Step 6 — requirements generation |
| `POST` | `/api/wizard/use-cases` | Wizard Step 7 — use case generation |
| `POST` | `/api/wizard/product-arch` | Wizard Step 8 — product architecture |

### PLEML Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/check-pleml` | Check if project contains a PLEML feature model |
| `POST` | `/api/feature-bindings` | Get feature binding dependencies (`@FB`) |
| `POST` | `/api/feature-bindings/toggle` | Create or delete a feature binding |
| `POST` | `/api/feature-tree-uvl` | Get the UVL feature tree |
| `POST` | `/api/feature-tree-sysml` | Get feature tree as Mermaid graph |

---

## Dependencies

| Package | Purpose |
|---|---|
| [`mbse4u-sysml-helpers`](https://pypi.org/project/mbse4u-sysml-helpers/) | SysML v2 API client (element queries, caching, metadata) |
| `flask` | Web framework and REST API |
| `requests` | HTTP client for SysML v2 API |
| `python-dotenv` | Load environment variables from `.env` |
| `anytree` | Tree data structure for model traversal |
| `mcp[cli]` | Model Context Protocol server SDK |
| `openai` *(optional)* | GPT-4o and DALL-E 3 for AI features |
| `pypdf` *(optional)* | PDF text extraction for document uploads |
| `python-docx` *(optional)* | Word document extraction for document uploads |

---

## Authors

- **Tim Weilkiens** — [MBSE4U](https://mbse4u.com)

---

## License

Licensed under the **Apache License 2.0**. See [LICENSE](LICENSE) for details.

---

## Related Projects

- [SYSMOD Methodology](https://mbse4u.com/sysmod/) — The MBSE methodology this tool supports
- [mbse4u-sysml-helpers on PyPI](https://pypi.org/project/mbse4u-sysml-helpers/) — The underlying SysML v2 Python helper library
- [SysML v2 Reference Implementation](https://github.com/Systems-Modeling/SysML-v2-Release) — The open-source SysML v2 API server
- [Model Context Protocol](https://modelcontextprotocol.io/) — The MCP specification
