# sysmod-sysmlv2-api

> A Flask-based server and web UI for accessing and visualizing **SYSMOD** SysML v2 models via the SysML v2 API.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Python](https://img.shields.io/badge/Python-3.8%2B-blue)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-REST%20API-green)](https://flask.palletsprojects.com/)


> [!WARNING]
> **Work in Progress** — This project is under active development. Some features may be incomplete, use placeholder/dummy data, or behave unexpectedly. Contributions and feedback are welcome.

---

## Overview

**sysmod-sysmlv2-api** is a demonstrator application for the [SYSMOD methodology](https://mbse4u.com/sysmod/) that connects to a SysML v2 repository server and provides a rich, interactive web-based viewer and wizard for your SysML v2 models.

Key highlights:

- 🔌 **Connects to any SysML v2 API-compliant server** (e.g., SysML v2 Reference Implementation)
- 📊 **SYSMOD Viewer** — browse projects, commits, and SYSMOD model content (problem statements, system idea, contexts, stakeholders, use cases, requirements, feature trees, and more)
- 🧙 **SYSMOD Wizard** — step-by-step AI-assisted creation of new SysML v2 / SYSMOD models from scratch
- 🤖 **OpenAI Integration** — AI-powered suggestions for problem statements, system requirements, stakeholders, and architecture
- 📦 **Built on `mbse4u-sysml-helpers`** — reuses the [MBSE4U SysML v2 Python API helper library](https://pypi.org/project/mbse4u-sysml-helpers/)

---

## Features

### SYSMOD Viewer (`project.html`)

| Feature | Description |
|---|---|
| Project & Commit Selection | Browse SysML v2 projects and commits from a configured server |
| SYSMOD Project Overview | Displays the SYSMOD Atlas status grid with model completeness indicators |
| Problem Statement | Read and edit the problem statement directly via the SysML v2 API |
| System Idea | Displays the system idea description and AI-generated image |
| Context Diagrams | Visualizes Brownfield, System Idea, Requirement, Functional, Logical, and Product contexts |
| Stakeholders | Lists project stakeholders with attributes |
| Use Cases | Displays use cases from the model |
| Requirements | Lists system requirements with identifiers, priorities, and obligations |
| Feature Tree | Renders the feature tree in UVL format with Mermaid graph visualization |
| Feature Binding Matrix | Interactive matrix to manage feature binding dependencies |
| Quality Checks | Automated checks for SYSMOD model completeness |
| AI Suggestions | OpenAI GPT-4o–powered suggestions to refine the problem statement |
| Cache Warmup | Bulk element loading to speed up subsequent queries |

### SYSMOD Wizard (`sysmod-wizard.html`)

A guided, multi-step wizard for AI-assisted creation of new SYSMOD / SysML v2 models:

| Step | Name | Description |
|---|---|---|
| 1 | Project Setup | Define the system name and description; generates SysML v2 model scaffold |
| 2 | Brownfield Analysis | Upload existing documents; AI extracts context and existing system information |
| 3 | Problem Statement | Describe the problem; AI generates a concise problem statement |
| 4 | Stakeholders | Identify stakeholders; AI suggests stakeholder attributes |
| 5 | System Idea | Define the system idea; AI generates description and conceptual image |
| 6 | System Requirements | Generate system requirements from prior context; AI outputs SysML v2 code |
| 7 | Use Cases | Generate use case definitions; AI outputs SysML v2 code |
| 8 | Product Architecture | Generate initial product architecture; AI outputs SysML v2 code |

---

## Architecture

```
sysmod-sysmlv2-api/
├── sysmod_api_server.py       # Main Flask application & REST API endpoints
├── sysmod_api_helpers.py      # SYSMOD-specific helper functions (queries, parsing)
├── html/
│   ├── index.html             # Project / Commit / SYSMOD Project selection page
│   ├── project.html           # SYSMOD Viewer dashboard
│   └── sysmod-wizard.html     # AI-assisted model creation wizard
├── prompts/                   # AI prompt templates for wizard steps
│   ├── sysmod-model-template.txt
│   ├── brownfield-prompt.txt
│   ├── problem-statement-prompt.txt
│   ├── stakeholders-prompt.txt
│   ├── system-idea-prompt.txt
│   ├── system-requirements-prompt.txt
│   ├── use-cases-prompt.txt
│   └── product-arch-prompt.txt
├── uploads/                   # Uploaded reference documents (per system name)
├── word/                      # Word macro templates
└── .env                       # Environment variables (API keys, not tracked)
```

---

## Prerequisites

- **Python 3.8+**
- A running **SysML v2 API server** (e.g., the [SysML v2 Reference Implementation](https://github.com/Systems-Modeling/SysML-v2-Release))
- An **OpenAI API key** (optional, required only for AI-assisted wizard steps and AI suggestions)

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/MBSE4U/sysmod-sysmlv2-api.git
cd sysmod-sysmlv2-api
```

### 2. Install the MBSE4U SysML v2 helpers library

This project depends on the [`mbse4u-sysml-helpers`](https://pypi.org/project/mbse4u-sysml-helpers/) Python package, which provides the low-level SysML v2 API client functions.

```bash
pip install mbse4u-sysml-helpers
```

### 3. Install remaining Python dependencies

Install all required packages using the provided `requirements.txt`:

```bash
pip install -r requirements.txt
```

To enable PDF and Word document uploads in the wizard, also install:

```bash
pip install pypdf python-docx
```

To enable AI features (OpenAI GPT-4o / DALL-E 3), install:

```bash
pip install openai
```

### 4. Configure environment variables

Copy the example environment file and fill in your values:

```bash
copy .env.example .env
```

Then edit `.env`:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

> **Note:** The OpenAI API key can also be entered directly in the web UI within the wizard or viewer settings, without needing a `.env` file.

---

## Usage

### Start the server

```bash
python sysmod_api_server.py
```

The server starts on `http://localhost:5000` by default (Flask debug mode).

### Open the web UI

Navigate to `http://localhost:5000` in your browser.

1. **Enter the SysML v2 server URL** (e.g., `http://localhost:9000`)
2. **Click "Get Projects"** to retrieve available projects from the server
3. **Select a project** and **select a commit**
4. **Select a SYSMOD project** — the viewer will open automatically

Or click **"Start Creation Wizard"** to create a new SYSMOD model from scratch.

---

## API Endpoints

The Flask server exposes the following REST API endpoints (all accept/return JSON unless noted):

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/projects` | List projects on a SysML v2 server |
| `POST` | `/api/commits` | List commits for a project |
| `POST` | `/api/cache/warmup` | Bulk-load elements into the in-memory cache |
| `POST` | `/api/sysmod_projects` | List SYSMOD projects in a commit |
| `POST` | `/api/sysmod_project` | Get SYSMOD project details (name, documentation) |
| `POST` | `/api/element` | Get a generic model element by ID |
| `POST` | `/api/problem-statement` | Get the problem statement |
| `POST` | `/api/problem-statement/save` | Save an updated problem statement |
| `POST` | `/api/system-idea` | Get the system idea description |
| `POST` | `/api/sysmod-context` | Get a SYSMOD context diagram (Brownfield, System, Functional, …) |
| `POST` | `/api/requirements` | Get system requirements |
| `POST` | `/api/usecases` | Get use cases |
| `POST` | `/api/stakeholders` | Get stakeholders |
| `POST` | `/api/feature-bindings` | Get feature binding dependencies |
| `POST` | `/api/feature-bindings/toggle` | Create or delete a feature binding |
| `POST` | `/api/feature-tree-uvl` | Get the UVL feature tree |
| `POST` | `/api/quality-checks` | Run SYSMOD model quality checks |
| `POST` | `/api/sysmod-atlas` | Get SYSMOD Atlas status overview |
| `POST` | `/api/ai-suggestion_problem_statement` | Get an AI-improved problem statement |
| `POST` | `/api/wizard/project-setup` | Wizard Step 1 — generate SysML v2 project scaffold |
| `GET`  | `/api/wizard/files` | List previously uploaded files for a system |
| `POST` | `/api/wizard/brownfield` | Wizard Step 2 — brownfield analysis with AI |
| `POST` | `/api/wizard/problem` | Wizard Step 3 — problem statement generation |
| `POST` | `/api/wizard/stakeholders` | Wizard Step 4 — stakeholder analysis |
| `POST` | `/api/wizard/system-idea` | Wizard Step 5 — system idea generation with image |
| `POST` | `/api/wizard/system-requirements` | Wizard Step 6 — system requirements generation |
| `POST` | `/api/wizard/use-cases` | Wizard Step 7 — use case generation |
| `POST` | `/api/wizard/product-arch` | Wizard Step 8 — product architecture generation |

---

## Dependencies

| Package | Purpose |
|---|---|
| [`mbse4u-sysml-helpers`](https://pypi.org/project/mbse4u-sysml-helpers/) | SysML v2 API client helpers (element queries, caching, metadata) |
| `flask` | Web framework and REST API server |
| `requests` | HTTP client for SysML v2 API communication |
| `python-dotenv` | Load environment variables from `.env` |
| `anytree` | Tree data structure for model traversal |
| `openai` *(optional)* | GPT-4o and DALL-E 3 integration for AI features |
| `pypdf` *(optional)* | PDF text extraction for document uploads |
| `python-docx` *(optional)* | Word document text extraction for document uploads |

---

## Authors

- **Tim Weilkiens** — [MBSE4U](https://mbse4u.com)

---

## License

This project is licensed under the **Apache License 2.0**.
See the [LICENSE](LICENSE) file for details.

---

## Related Projects

- [SYSMOD Methodology](https://mbse4u.com/sysmod/) — The MBSE methodology this tool supports
- [mbse4u-sysml-helpers on PyPI](https://pypi.org/project/mbse4u-sysml-helpers/) — The underlying SysML v2 Python API helper library
- [SysML v2 Reference Implementation](https://github.com/Systems-Modeling/SysML-v2-Release) — The open-source SysML v2 API server
