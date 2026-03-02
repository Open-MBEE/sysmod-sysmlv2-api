# SYSMOD Word Template — Setup Guide

## What You Have

| File | Purpose |
|------|---------|
| `word/SYSMOD_Report.bas` | VBA macro module — import this into Word |
| `word/SYSMODTemplate.docm` | The macro-enabled Word template |

---

## Step 1 — Create the Word Template Structure

Open Microsoft Word and create a new blank document (or open the existing `SYSMODTemplate.docm`).

### 1.1 Cover Page

Set up the first page as a cover page:
- Insert a **Rectangle** shape covering the full page, fill color `#002060` (dark navy)
- On top of the shape add a **Text Box** with:
  - Title area: place bookmark `BM_ProjectName` (populated with project name)
  - Below title: `SYSMOD Project Specification`
  - Footer line: `MBSE4U · mbse4u.com`
- Font: **Calibri Light**, white color
- Insert a **Page Break** after the cover page

### 1.2 Document Header and Footer

Go to **Insert → Header → Edit Header**:
- Left side: type the literal text `[[PROJECT]]` — the macro replaces this automatically
- Right side: Insert the MBSE4U logo (if available)

Go to **Footer**:
- Left: `SYSMOD Project Specification`
- Right: Insert **Page Number**

### 1.3 Table of Contents

After the cover page, add:
1. **Heading 1**: `Table of Contents`
2. Insert → Table of Contents → Automatic

---

## Step 2 — Insert All Bookmarks

For each content section below, place the cursor on a blank paragraph and insert a bookmark via **Insert → Bookmark → name → Add**.

> [!IMPORTANT]
> Bookmarks must be placed on **empty paragraphs**. Do not put two bookmarks on the same paragraph.

### Cover Page Bookmarks

| Bookmark | Content |
|----------|---------|
| `BM_ProjectName` | Project name (large title) |
| `BM_ProjectTitle` | Project name used elsewhere on the cover |
| `BM_CommitId` | SysML commit ID |
| `BM_CommitDate` | Commit date (fetched from the SysML server) |
| `BM_GeneratedDate` | Document generation timestamp |

### Chapter Bookmarks

| Chapter | Heading Text | Bookmark Name |
|---------|-------------|---------------|
| 1 — Project Overview | `1   Project Overview` | `BM_ProjectDoc` |
| 2 — Problem Statement | `2   Problem Statement` | `BM_ProblemStatement` |
| 3 — System Idea | `3   System Idea` | `BM_SystemIdea` |
| 4 — Stakeholders | `4   Stakeholders` | `BM_Stakeholders` |
| 5 — Use Cases | `5   Use Cases` | `BM_UseCases` |
| 6 — Requirements | `6   System Requirements` | `BM_Requirements` |
| 7 — Brownfield | `7   Brownfield Context` | `BM_Brownfield` |
| 8 — System Context | `8   System Context` | `BM_System` |
| 9 — Functional | `9   Functional Context` | `BM_Functional` |
| 10 — Logical | `10  Logical Architecture` | `BM_Logical` |
| 11 — Product | `11  Product Architecture` | `BM_Product` |

---

## Step 3 — Professional Styling Tips

### Heading Colors
1. Right-click a **Heading 1** paragraph → **Modify Style**
2. Set font to **Calibri Light 16pt**, color `#002060`, spacing before: 18pt, after: 6pt

### Chapter Intro Box (Shading)
Below each Heading 1, add a paragraph with:
- Background shading: `#E2EEFF` (light blue)
- Left indent: 0.5cm
- Font: *Italic*, color `#002060`

Example intro texts:
- Problem Statement: *"This chapter captures the problem the system addresses."*
- Stakeholders: *"These are the parties affected by or involved with the system."*
- Requirements: *"The following requirements define what the system must achieve."*

### Table Style (Requirements chapter)
The macro inserts a Word `"Table Grid"` table with:
- Header row: navy background (`#002060`), white bold text
- Banded rows enabled

---

## Step 4 — Import the VBA Module

1. Open `SYSMODTemplate.docm` in Word
2. Press **Alt + F11** to open the VBA editor
3. In the Project Explorer, right-click your document → **Import File...**
4. Select `word/SYSMOD_Report.bas`
5. Close the VBA editor
6. Save the document as `.docm` (macro-enabled)

> [!NOTE]
> Every time `SYSMOD_Report.bas` is updated, you must re-import it: delete the old module first, then import the new file.

### Add Buttons to the Ribbon (optional but recommended)

Go to **File → Options → Customize Ribbon**:
- Add a new **Custom Group** in the **Home** tab, name it `SYSMOD`
- Add two macro buttons:
  - `ConfigureSysMOD` → rename to "Configure"
  - `UpdateFromSysMOD` → rename to "Update from Model"

---

## Step 5 — Running the Macro

1. Open your `SYSMODTemplate.docm`
2. Run **ConfigureSysMOD** (or use the ribbon button). You will be prompted for:
   - **SYSMOD API Server URL** — the Flask server (e.g. `http://127.0.0.1:5000`)
   - **SysML v2 API Server URL** — the SysML v2 REST server (e.g. `http://localhost:9000`)
   - **SysML Project ID** — UUID of the SysML project
   - **Commit ID** — UUID of the commit to report on
   - **SYSMOD Project Element ID** — UUID of the SYSMOD project element
3. **Save the document** (Ctrl+S) — settings are stored as document variables
4. Run **UpdateFromSysMOD** — a progress bar appears in the Word status bar while all chapters are populated

> [!TIP]
> Running **UpdateFromSysMOD** repeatedly is safe — each run fully replaces the previous content. No manual cleanup needed.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Bookmark not found" in debug | Check spelling in **Insert → Bookmark** list |
| Empty chapter sections | Verify Flask server is running and all IDs are correct |
| `Connection error` dialog | Confirm `http://127.0.0.1:5000` is reachable in a browser |
| TLS / binary garbage in server log | The URL must start with `http://`, not `https://` |
| Text accumulates instead of replacing | Re-import the latest `.bas` — the fix is in `ReplaceBookmarkContent` |
| Requirements table not appearing | Ensure `BM_Requirements` bookmark is on an **empty paragraph** |
| `[[PROJECT]]` not replaced in header | The header must contain the literal text `[[PROJECT]]` — bookmarks are not used in headers |

---

## API Reference

### Endpoints called by the macro

| Endpoint | Description |
|----------|-------------|
| `POST /api/sysmod_project` | Project name and documentation |
| `POST /api/commits` | Commit list (used to resolve commit date) |
| `POST /api/problem-statement` | Problem statement text |
| `POST /api/system-idea` | System idea description |
| `POST /api/stakeholders` | Stakeholder list |
| `POST /api/sysmod-usecases` | Use case list |
| `POST /api/sysmod-requirements` | Requirements list |
| `POST /api/sysmod-context` | Context diagrams (BROWNFIELD / SYSTEM / FUNCTIONAL / LOGICAL / PRODUCT) |

### Standard payload (all endpoints except `/api/sysmod_project` and `/api/commits`)

```json
{
  "server_url": "http://localhost:9000",
  "project_id": "<SysML project UUID>",
  "commit_id": "<commit UUID>",
  "sysmod_project_id": "<SYSMOD element UUID>"
}
```

`/api/sysmod_project` uses `"element_id"` instead of `"sysmod_project_id"`.  
`/api/commits` only needs `"server_url"` and `"project_id"`.  
`/api/sysmod-context` additionally requires `"context_type"`.
