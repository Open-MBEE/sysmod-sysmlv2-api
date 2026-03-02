Attribute VB_Name = "SYSMOD_Report"
Option Explicit

' =============================================================================
'  SYSMOD Report Macro
'  Fetches data from the SYSMOD Viewer Flask API and populates
'  a structured project specification document.
'
'  Usage:
'    1. Run ConfigureSysMOD  --> Enter Server URL, Project/Commit/SysMOD IDs
'    2. Run UpdateFromSysMOD --> Populates all chapters from the API
'
'  Bookmarks expected in the document:
'    BM_ProjectName    - cover page title
'    BM_ProjectTitle   - project name in body / cover (replaces [[PROJECT]] placeholder)
'    BM_ProjectDoc     - project description
'    BM_CommitId       - commit ID (replaces [[PROJECT_COMMIT_ID]])
'    BM_CommitDate     - commit date (replaces [[PROJECT_DATE]])
'    BM_ProblemStatement
'    BM_SystemIdea
'    BM_Stakeholders
'    BM_UseCases
'    BM_Requirements
'    BM_Brownfield
'    BM_System
'    BM_Functional
'    BM_Logical
'    BM_Product
'    BM_GeneratedDate
'  Headers: use [[PROJECT]] as a text placeholder; updated via Find/Replace.
' =============================================================================

Const DEFAULT_SYSMOD_SERVER_URL As String = "http://127.0.0.1:5000/"
Const DEFAULT_SYSML_URL As String = "http://localhost:9000"

' =============================================================================
'  PUBLIC ENTRY POINTS
' =============================================================================

'
' Run ConfigureSysMOD once to store connection settings in the document.
'
Sub ConfigureSysMOD()
    Dim sysmodServerUrl As String, sysmlServerUrl As String
    Dim projectId As String, commitId As String, sysmodProjectId As String

    ' Load existing values
    On Error Resume Next
    sysmodServerUrl = ActiveDocument.Variables("SysMOD_ServerURL").Value
    sysmlServerUrl  = ActiveDocument.Variables("SysMOD_SysMLServerURL").Value
    projectId       = ActiveDocument.Variables("SysMOD_ProjectID").Value
    commitId        = ActiveDocument.Variables("SysMOD_CommitID").Value
    sysmodProjectId = ActiveDocument.Variables("SysMOD_SysMODProjectID").Value
    On Error GoTo 0

    If sysmodServerUrl = ""       Then sysmodServerUrl       = DEFAULT_SYSMOD_SERVER_URL
    If sysmlServerUrl = "" Then sysmlServerUrl = DEFAULT_SYSML_URL

    ' Prompt
    sysmodServerUrl = InputBox("SYSMOD API Server URL:" & vbCrLf & "e.g. http://localhost:5000", _
                        "SYSMOD Configuration", sysmodServerUrl)
    If sysmodServerUrl = "" Then Exit Sub
    sysmodServerUrl = ValidateHttpUrl(sysmodServerUrl, "SYSMOD API Server")
    If sysmodServerUrl = "" Then Exit Sub

    sysmlServerUrl = InputBox("SysML v2 API Server URL:" & vbCrLf & "e.g. http://localhost:9000", _
                              "SYSMOD Configuration", sysmlServerUrl)
    If sysmlServerUrl = "" Then Exit Sub
    sysmlServerUrl = ValidateHttpUrl(sysmlServerUrl, "SysML v2 API Server")
    If sysmlServerUrl = "" Then Exit Sub

    projectId = InputBox("SysML Project ID (UUID):", "SYSMOD Configuration", projectId)
    If projectId = "" Then Exit Sub

    commitId = InputBox("Commit ID (UUID):", "SYSMOD Configuration", commitId)
    If commitId = "" Then Exit Sub

    sysmodProjectId = InputBox("SYSMOD Project Element ID:", "SYSMOD Configuration", sysmodProjectId)
    If sysmodProjectId = "" Then Exit Sub

    ' Save
    ActiveDocument.Variables("SysMOD_ServerURL").Value        = sysmodServerUrl
    ActiveDocument.Variables("SysMOD_SysMLServerURL").Value  = sysmlServerUrl
    ActiveDocument.Variables("SysMOD_ProjectID").Value       = projectId
    ActiveDocument.Variables("SysMOD_CommitID").Value        = commitId
    ActiveDocument.Variables("SysMOD_SysMODProjectID").Value = sysmodProjectId

    MsgBox "Configuration saved successfully!" & vbCrLf & vbCrLf & _
           "SYSMOD Server URL:    " & sysmodServerUrl & vbCrLf & _
           "SysML URL:    " & sysmlServerUrl & vbCrLf & _
           "Project ID:   " & projectId & vbCrLf & _
           "Commit ID:    " & commitId & vbCrLf & _
           "Element ID:   " & sysmodProjectId, _
           vbInformation, "SYSMOD Configuration Saved"
End Sub


'
' Main macro: fetches all SYSMOD data and populates the document.
'
Sub UpdateFromSysMOD()
    Dim sysmodServerUrl As String, sysmlServerUrl As String
    Dim projectId As String, commitId As String, sysmodProjectId As String

    ' --- Load config ---
    On Error Resume Next
    sysmodServerUrl        = ActiveDocument.Variables("SysMOD_ServerURL").Value
    sysmlServerUrl  = ActiveDocument.Variables("SysMOD_SysMLServerURL").Value
    projectId       = ActiveDocument.Variables("SysMOD_ProjectID").Value
    commitId        = ActiveDocument.Variables("SysMOD_CommitID").Value
    sysmodProjectId = ActiveDocument.Variables("SysMOD_SysMODProjectID").Value
    On Error GoTo 0

    ' --- Sanitize URLs: strip trailing slash, silently correct https -> http ---
    sysmodServerUrl = SanitizeUrl(sysmodServerUrl)
    sysmlServerUrl  = SanitizeUrl(sysmlServerUrl)

    ' --- Guard: ask if not configured ---
    If sysmodServerUrl = "" Or sysmlServerUrl = "" Or projectId = "" Or commitId = "" Or sysmodProjectId = "" Then
        Dim answer As Integer
        answer = MsgBox("SYSMOD is not configured yet." & vbCrLf & _
                        "Would you like to configure it now?", _
                        vbQuestion + vbYesNo, "SYSMOD Not Configured")
        If answer = vbYes Then ConfigureSysMOD
        Exit Sub
    End If

    ' --- Progress indicator ---
    Const TOTAL_STEPS As Integer = 13
    ShowProgress 0, TOTAL_STEPS, "Starting..."

    Dim basePayload As String
    basePayload = BuildBasePayload(sysmlServerUrl, projectId, commitId, sysmodProjectId)

    Dim responseJson As String
    Dim ok As Boolean

    ' --- 1. Project Name & Overview ---
    ShowProgress 1, TOTAL_STEPS, "Project name & overview"
    Dim projPayload As String
    projPayload = "{""server_url"": """ & sysmlServerUrl & """, " & _
                   """project_id"": """ & projectId & """, " & _
                   """commit_id"": """ & commitId & """, " & _
                   """element_id"": """ & sysmodProjectId & """}"
    ' Note: /api/sysmod_project uses "element_id" (not "sysmod_project_id") for the SYSMOD element
    responseJson = HTTPPost(sysmodServerUrl & "/api/sysmod_project", projPayload)
    If responseJson <> "" Then
        Dim projName As String, projDoc As String
        projName = ExtractJSONString(responseJson, "name")
        projDoc  = ExtractJSONString(responseJson, "documentation")
        If projName <> "" Then
            ok = ReplaceBookmarkContent("BM_ProjectName", projName)  ' cover title
            ok = ReplaceBookmarkContent("BM_ProjectTitle", projName) ' body placeholder
            UpdateHeaders "[[PROJECT]]", projName                    ' header text
        End If
        If projDoc <> "" Then
            ok = ReplaceBookmarkContent("BM_ProjectDoc", projDoc)
        Else
            ok = ReplaceBookmarkContent("BM_ProjectDoc", "(No project description found in model.)")
        End If
    End If

    ' --- Commit metadata ---
    ShowProgress 2, TOTAL_STEPS, "Commit ID"
    ok = ReplaceBookmarkContent("BM_CommitId", commitId)

    ' Commit date - fetch from /api/commits
    ShowProgress 3, TOTAL_STEPS, "Commit date"
    Dim commitPayload As String
    commitPayload = "{""server_url"": """ & sysmlServerUrl & """, " & _
                    """project_id"": """ & projectId & """}"
    Dim commitsJson As String
    commitsJson = HTTPPost(sysmodServerUrl & "/api/commits", commitPayload)
    If commitsJson <> "" Then
        Dim commitItems() As String
        commitItems = SplitJSONArray(commitsJson)
        Dim ci As Integer
        Dim commitDate As String
        commitDate = ""
        For ci = 0 To UBound(commitItems)
            If InStr(commitItems(ci), commitId) > 0 Then
                commitDate = ExtractJSONString(commitItems(ci), "created")
                If commitDate = "" Then commitDate = ExtractJSONString(commitItems(ci), "timestamp")
                Exit For
            End If
        Next ci
        If commitDate = "" Then commitDate = commitId
        ok = ReplaceBookmarkContent("BM_CommitDate", commitDate)
    Else
        ok = ReplaceBookmarkContent("BM_CommitDate", commitId)
    End If

    ' --- 2. Problem Statement ---
    ShowProgress 4, TOTAL_STEPS, "Problem statement"
    responseJson = HTTPPost(sysmodServerUrl & "/api/problem-statement", basePayload)
    If responseJson <> "" And InStr(responseJson, """error""") = 0 Then
        Dim psBody As String
        psBody = ExtractJSONString(responseJson, "body")
        If psBody = "" Then psBody = ExtractJSONArrayString(responseJson, "body")
        If psBody = "" Then psBody = ExtractJSONString(responseJson, "documentation")
        If psBody = "" Then psBody = "(No problem statement found in model.)"
        ok = ReplaceBookmarkContent("BM_ProblemStatement", psBody)
    Else
        ok = ReplaceBookmarkContent("BM_ProblemStatement", "(No problem statement found in model.)")
    End If

    ' TODO: Re-enable sections 3-11 once connection is verified working
'    ' --- 3. System Idea ---
'    ShowProgress 5, TOTAL_STEPS, "System idea"
'    responseJson = HTTPPost(sysmodServerUrl & "/api/system-idea", basePayload)
'    If responseJson <> "" And InStr(responseJson, """error""") = 0 Then
'        Dim sysIdeaDoc As String
'        sysIdeaDoc = ExtractJSONString(responseJson, "documentation")
'        If sysIdeaDoc = "" Then sysIdeaDoc = ExtractJSONString(responseJson, "body")
'        If sysIdeaDoc = "" Then sysIdeaDoc = "(No system idea description found in model.)"
'        ok = ReplaceBookmarkContent("BM_SystemIdea", sysIdeaDoc)
'    Else
'        ok = ReplaceBookmarkContent("BM_SystemIdea", "(No system idea found in model.)")
'    End If
'
'    ' --- 4. Stakeholders ---
'    ShowProgress 6, TOTAL_STEPS, "Stakeholders"
'    responseJson = HTTPPost(sysmodServerUrl & "/api/stakeholders", basePayload)
'    ok = PopulateListBookmark("BM_Stakeholders", responseJson, "name", "documentation")
'
'    ' --- 5. Use Cases ---
'    ShowProgress 7, TOTAL_STEPS, "Use cases"
'    responseJson = HTTPPost(sysmodServerUrl & "/api/sysmod-usecases", basePayload)
'    ok = PopulateListBookmark("BM_UseCases", responseJson, "name", "documentation")
'
'    ' --- 6. Requirements ---
'    ShowProgress 8, TOTAL_STEPS, "Requirements"
'    responseJson = HTTPPost(sysmodServerUrl & "/api/sysmod-requirements", basePayload)
'    ok = PopulateRequirementsTable("BM_Requirements", responseJson)
'
'    ' --- 7. Brownfield Context ---
'    ShowProgress 9, TOTAL_STEPS, "Brownfield context"
'    responseJson = HTTPPost(sysmodServerUrl & "/api/sysmod-context", BuildContextPayload(sysmlServerUrl, projectId, commitId, sysmodProjectId, "BROWNFIELD"))
'    ok = PopulateContextBookmark("BM_Brownfield", responseJson)
'
'    ' --- 8. System Context ---
'    ShowProgress 10, TOTAL_STEPS, "System context"
'    responseJson = HTTPPost(sysmodServerUrl & "/api/sysmod-context", BuildContextPayload(sysmlServerUrl, projectId, commitId, sysmodProjectId, "SYSTEM"))
'    ok = PopulateContextBookmark("BM_System", responseJson)
'
'    ' --- 9. Functional Context ---
'    ShowProgress 11, TOTAL_STEPS, "Functional context"
'    responseJson = HTTPPost(sysmodServerUrl & "/api/sysmod-context", BuildContextPayload(sysmlServerUrl, projectId, commitId, sysmodProjectId, "FUNCTIONAL"))
'    ok = PopulateContextBookmark("BM_Functional", responseJson)
'
'    ' --- 10. Logical Architecture ---
'    ShowProgress 12, TOTAL_STEPS, "Logical architecture"
'    responseJson = HTTPPost(sysmodServerUrl & "/api/sysmod-context", BuildContextPayload(sysmlServerUrl, projectId, commitId, sysmodProjectId, "LOGICAL"))
'    ok = PopulateContextBookmark("BM_Logical", responseJson)
'
'    ' --- 11. Product Architecture ---
'    ShowProgress 13, TOTAL_STEPS, "Product architecture"
'    responseJson = HTTPPost(sysmodServerUrl & "/api/sysmod-context", BuildContextPayload(sysmlServerUrl, projectId, commitId, sysmodProjectId, "PRODUCT"))
'    ok = PopulateContextBookmark("BM_Product", responseJson)


    ' --- Update generation date ---
    ok = ReplaceBookmarkContent("BM_GeneratedDate", "Generated: " & Format(Now(), "DD MMMM YYYY, hh:mm"))

    ' --- Done ---
    ShowProgress TOTAL_STEPS, TOTAL_STEPS, "Complete!"
    Application.StatusBar = False
    MsgBox "Document updated successfully from SYSMOD Viewer!" & vbCrLf & vbCrLf & _
           "Project: " & ActiveDocument.Variables("SysMOD_ProjectID").Value, _
           vbInformation, "SYSMOD Update Complete"
End Sub


' =============================================================================
'  PAYLOAD BUILDERS
' =============================================================================

Function BuildBasePayload(serverUrl As String, projectId As String, _
                           commitId As String, sysmodProjectId As String) As String
    BuildBasePayload = "{""server_url"": """ & serverUrl & """, " & _
                        """project_id"": """ & projectId & """, " & _
                        """commit_id"": """ & commitId & """, " & _
                        """sysmod_project_id"": """ & sysmodProjectId & """}"
End Function

Function BuildContextPayload(serverUrl As String, projectId As String, _
                              commitId As String, sysmodProjectId As String, _
                              contextType As String) As String
    BuildContextPayload = "{""server_url"": """ & serverUrl & """, " & _
                           """project_id"": """ & projectId & """, " & _
                           """commit_id"": """ & commitId & """, " & _
                           """sysmod_project_id"": """ & sysmodProjectId & """, " & _
                           """context_type"": """ & contextType & """}"
End Function


' =============================================================================
'  DOCUMENT POPULATION HELPERS
' =============================================================================

'
' Replaces the text content at a named bookmark.
' Returns True if bookmark was found, False otherwise.
'
Function ReplaceBookmarkContent(bookmarkName As String, content As String) As Boolean
    If Not ActiveDocument.Bookmarks.Exists(bookmarkName) Then
        Debug.Print "WARNING: Bookmark '" & bookmarkName & "' not found."
        ReplaceBookmarkContent = False
        Exit Function
    End If

    Dim bm As Bookmark
    Set bm = ActiveDocument.Bookmarks(bookmarkName)
    Dim rng As Range
    Set rng = bm.Range

    ' Replace all existing content in one shot.
    ' The JSON parser already converts \n escape sequences to vbCrLf,
    ' so assigning directly keeps the range covering ALL inserted text.
    ' (Line-by-line insertion caused the bookmark to only cover the first
    '  line, leaving subsequent paragraphs orphaned on re-runs.)
    rng.Text = content

    ' Re-anchor bookmark over the full replaced content
    ActiveDocument.Bookmarks.Add bookmarkName, rng
    ReplaceBookmarkContent = True
End Function


'
' Populates a bookmark with a bulleted list from a JSON array.
' Each entry uses nameKey as the bullet label and docKey as description.
'
Function PopulateListBookmark(bookmarkName As String, jsonArray As String, _
                               nameKey As String, docKey As String) As Boolean
    If Not ActiveDocument.Bookmarks.Exists(bookmarkName) Then
        Debug.Print "WARNING: Bookmark '" & bookmarkName & "' not found."
        PopulateListBookmark = False
        Exit Function
    End If

    Dim bm As Bookmark
    Set bm = ActiveDocument.Bookmarks(bookmarkName)
    Dim rng As Range
    Set rng = bm.Range
    rng.Text = ""

    If jsonArray = "" Or InStr(jsonArray, "[") = 0 Then
        rng.Text = "(No data found in model.)"
        ActiveDocument.Bookmarks.Add bookmarkName, rng
        PopulateListBookmark = False
        Exit Function
    End If

    ' Parse items from JSON array
    Dim items() As String
    items = SplitJSONArray(jsonArray)

    If UBound(items) < 0 Then
        rng.Text = "(No items found.)"
        ActiveDocument.Bookmarks.Add bookmarkName, rng
        PopulateListBookmark = False
        Exit Function
    End If

    Dim firstPara As Boolean
    firstPara = True
    Dim baseRng As Range
    Set baseRng = rng.Duplicate

    Dim idx As Integer
    For idx = 0 To UBound(items)
        Dim itemJson As String
        itemJson = items(idx)
        Dim itemName As String, itemDoc As String
        itemName = ExtractJSONString(itemJson, nameKey)
        itemDoc  = ExtractJSONString(itemJson, docKey)

        Dim lineText As String
        If itemName <> "" Then
            lineText = itemName
            If itemDoc <> "" Then lineText = lineText & ": " & itemDoc
        ElseIf itemDoc <> "" Then
            lineText = itemDoc
        Else
            lineText = "(unnamed element)"
        End If

        If firstPara Then
            baseRng.Text = lineText
            baseRng.Style = ActiveDocument.Styles("List Bullet")
            firstPara = False
        Else
            Dim newRng As Range
            Set newRng = baseRng.Duplicate
            newRng.Collapse wdCollapseEnd
            newRng.InsertParagraphAfter
            newRng.MoveStart wdParagraph, 1
            newRng.Text = lineText
            newRng.Style = ActiveDocument.Styles("List Bullet")
            Set baseRng = newRng
        End If
    Next idx

    ' Restore bookmark
    Set rng = ActiveDocument.Bookmarks(bookmarkName).Range
    ActiveDocument.Bookmarks.Add bookmarkName, rng
    PopulateListBookmark = True
End Function

'
' Populates a requirements bookmark with a numbered table:
' ID | Name | Text
'
Function PopulateRequirementsTable(bookmarkName As String, jsonArray As String) As Boolean
    If Not ActiveDocument.Bookmarks.Exists(bookmarkName) Then
        Debug.Print "WARNING: Bookmark '" & bookmarkName & "' not found."
        PopulateRequirementsTable = False
        Exit Function
    End If

    Dim bm As Bookmark
    Set bm = ActiveDocument.Bookmarks(bookmarkName)
    Dim rng As Range
    Set rng = bm.Range
    rng.Text = ""

    If jsonArray = "" Or InStr(jsonArray, "[") = 0 Then
        rng.Text = "(No requirements found in model.)"
        ActiveDocument.Bookmarks.Add bookmarkName, rng
        PopulateRequirementsTable = False
        Exit Function
    End If

    Dim items() As String
    items = SplitJSONArray(jsonArray)

    If UBound(items) < 0 Then
        rng.Text = "(No requirements found.)"
        ActiveDocument.Bookmarks.Add bookmarkName, rng
        PopulateRequirementsTable = False
        Exit Function
    End If

    ' Create table: Header + one row per requirement
    Dim tbl As Table
    Set tbl = ActiveDocument.Tables.Add(rng, UBound(items) + 2, 3)

    ' Style the table
    tbl.Style = "Table Grid"
    tbl.ApplyStyleFirstColumn = False
    tbl.ApplyStyleLastRow = False
    tbl.ApplyStyleRowBands = True

    ' Set column widths (approx)
    tbl.Columns(1).Width = CentimetersToPoints(2.5)
    tbl.Columns(2).Width = CentimetersToPoints(5)
    tbl.Columns(3).Width = CentimetersToPoints(9)

    ' Header row
    With tbl.Rows(1)
        .HeadingFormat = True
        .Range.Shading.BackgroundPatternColor = RGB(0, 32, 96)  ' Dark navy
        .Cells(1).Range.Text = "#"
        .Cells(2).Range.Text = "Requirement"
        .Cells(3).Range.Text = "Description"
        Dim hCell As Cell
        For Each hCell In .Cells
            hCell.Range.Font.Color = RGB(255, 255, 255)
            hCell.Range.Font.Bold = True
        Next hCell
    End With

    ' Data rows
    Dim rowIdx As Integer
    For rowIdx = 0 To UBound(items)
        Dim itemJson As String
        itemJson = items(rowIdx)
        Dim reqNum As String, reqName As String, reqBody As String
        reqNum  = CStr(rowIdx + 1)
        reqName = ExtractJSONString(itemJson, "name")
        reqBody = ExtractJSONString(itemJson, "body")
        If reqBody = "" Then reqBody = ExtractJSONString(itemJson, "documentation")
        If reqName = "" Then reqName = "(unnamed)"
        If reqBody = "" Then reqBody = "(no description)"

        With tbl.Rows(rowIdx + 2)
            .Cells(1).Range.Text = reqNum
            .Cells(2).Range.Text = reqName
            .Cells(3).Range.Text = reqBody
            ' Zebra striping via table banded style
        End With
    Next rowIdx

    ' Re-anchor bookmark after table
    ActiveDocument.Bookmarks.Add bookmarkName, tbl.Range
    PopulateRequirementsTable = True
End Function

'
' Populates a context bookmark with a description and a list of elements.
'
Function PopulateContextBookmark(bookmarkName As String, jsonData As String) As Boolean
    If Not ActiveDocument.Bookmarks.Exists(bookmarkName) Then
        Debug.Print "WARNING: Bookmark '" & bookmarkName & "' not found."
        PopulateContextBookmark = False
        Exit Function
    End If

    Dim bm As Bookmark
    Set bm = ActiveDocument.Bookmarks(bookmarkName)
    Dim rng As Range
    Set rng = bm.Range
    rng.Text = ""

    If jsonData = "" Or InStr(jsonData, """error""") > 0 Then
        rng.Text = "(Context not yet modeled.)"
        ActiveDocument.Bookmarks.Add bookmarkName, rng
        PopulateContextBookmark = False
        Exit Function
    End If

    ' Top-level documentation of the context
    Dim ctxDoc As String
    ctxDoc = ExtractJSONString(jsonData, "documentation")
    If ctxDoc = "" Then ctxDoc = ExtractJSONString(jsonData, "name")

    Dim baseRng As Range
    Set baseRng = rng.Duplicate

    If ctxDoc <> "" Then
        baseRng.Text = ctxDoc
        baseRng.Style = ActiveDocument.Styles("Normal")
    End If

    ' Elements list (if the response is an array or has "elements")
    Dim elementsJson As String
    elementsJson = ExtractJSONBlock(jsonData, "elements")

    If elementsJson <> "" Then
        Dim items() As String
        items = SplitJSONArray(elementsJson)
        Dim idx As Integer
        For idx = 0 To UBound(items)
            Dim itemName As String, itemDoc As String
            itemName = ExtractJSONString(items(idx), "name")
            itemDoc  = ExtractJSONString(items(idx), "documentation")
            Dim lineText As String
            lineText = itemName
            If itemDoc <> "" Then lineText = lineText & ": " & itemDoc

            Dim newRng As Range
            Set newRng = baseRng.Duplicate
            newRng.Collapse wdCollapseEnd
            newRng.InsertParagraphAfter
            newRng.MoveStart wdParagraph, 1
            newRng.Text = lineText
            newRng.Style = ActiveDocument.Styles("List Bullet")
            Set baseRng = newRng
        Next idx
    End If

    ActiveDocument.Bookmarks.Add bookmarkName, rng
    PopulateContextBookmark = True
End Function

'
' Updates [[PROJECT]] (or any placeholder) in headers and footers only.
' Body content uses bookmarks instead - see ReplaceBookmarkContent.
'
Sub UpdateHeaders(placeholder As String, replacement As String)
    Dim sec As Section
    For Each sec In ActiveDocument.Sections
        Dim hf As HeaderFooter
        For Each hf In sec.Headers
            If hf.Exists Then
                With hf.Range.Find
                    .Text = placeholder
                    .Replacement.Text = replacement
                    .MatchCase = True
                    .Execute Replace:=wdReplaceAll
                End With
            End If
        Next hf
        For Each hf In sec.Footers
            If hf.Exists Then
                With hf.Range.Find
                    .Text = placeholder
                    .Replacement.Text = replacement
                    .MatchCase = True
                    .Execute Replace:=wdReplaceAll
                End With
            End If
        Next hf
    Next sec
End Sub



' Renders a visual progress bar in the Word status bar using Unicode block characters.
' Displays:  SYSMOD ║████████████░░░░░░░░║ 62% · Problem statement
'
Sub ShowProgress(currentStep As Integer, totalSteps As Integer, stepName As String)
    Const BAR_WIDTH As Integer = 20
    Dim pct As Integer
    Dim filled As Integer
    If totalSteps > 0 Then
        pct = Int((currentStep / totalSteps) * 100)
        filled = Int((CDbl(currentStep) / totalSteps) * BAR_WIDTH)
    End If
    If filled > BAR_WIDTH Then filled = BAR_WIDTH

    Dim bar As String
    bar = String(filled, ChrW(9608)) & String(BAR_WIDTH - filled, ChrW(9617))

    Application.StatusBar = "SYSMOD " & ChrW(9553) & bar & ChrW(9553) & " " & pct & "% " & Chr(183) & " " & stepName
End Sub


' =============================================================================
'  JSON HELPERS
' =============================================================================

'
' Validates a server URL. Warns if https:// is used (causes TLS errors with plain HTTP servers)
' and offers to correct it to http://. Returns corrected URL, or "" if user cancels.
'
Function ValidateHttpUrl(url As String, serverLabel As String) As String
    Dim cleaned As String
    cleaned = Trim(url)

    ' Strip trailing slash for consistency
    If Right(cleaned, 1) = "/" Then cleaned = Left(cleaned, Len(cleaned) - 1)

    If LCase(Left(cleaned, 8)) = "https://" Then
        Dim ans As Integer
        ans = MsgBox(serverLabel & " URL uses 'https://' but the server runs plain HTTP." & vbCrLf & vbCrLf & _
                     "Shall I change it to 'http://' automatically?", _
                     vbQuestion + vbYesNoCancel, "URL Protocol Warning")
        Select Case ans
            Case vbYes
                cleaned = "http://" & Mid(cleaned, 9)
            Case vbNo
                ' Keep as-is (user knows best)
            Case vbCancel
                ValidateHttpUrl = ""
                Exit Function
        End Select
    End If

    ValidateHttpUrl = cleaned
End Function

'
' Silently sanitizes a URL: strips trailing slash and corrects https:// -> http://.
' Used at runtime (no user prompt). For interactive use see ValidateHttpUrl.
'
Function SanitizeUrl(url As String) As String
    Dim cleaned As String
    cleaned = Trim(url)
    If Right(cleaned, 1) = "/" Then cleaned = Left(cleaned, Len(cleaned) - 1)
    If LCase(Left(cleaned, 8)) = "https://" Then
        cleaned = "http://" & Mid(cleaned, 9)
    End If
    SanitizeUrl = cleaned
End Function

'
' HTTP POST – returns response body as string, or "" on failure.
'
Function HTTPPost(url As String, jsonBody As String) As String
    Dim http As Object
    Set http = CreateObject("MSXML2.XMLHTTP.6.0")

    On Error GoTo ErrorHandler

    http.Open "POST", url, False
    http.setRequestHeader "Content-Type", "application/json"
    http.setRequestHeader "Accept", "application/json"
    http.send jsonBody

    If http.Status = 200 Then
        HTTPPost = http.responseText
    Else
        Debug.Print "HTTP " & http.Status & " from " & url & ": " & http.statusText
        HTTPPost = ""
    End If
    Exit Function

ErrorHandler:
    MsgBox "Connection error calling: " & url & vbCrLf & vbCrLf & Err.Description, _
           vbCritical, "SYSMOD Connection Error"
    HTTPPost = ""
End Function

'
' Extracts a string value for a given key from flat or moderately nested JSON.
' Handles: "key": "value"  and  "key": null
'
Function ExtractJSONString(jsonStr As String, key As String) As String
    Dim searchStr As String
    searchStr = """" & key & """: """

    Dim startPos As Long
    startPos = InStr(jsonStr, searchStr)

    If startPos = 0 Then
        ExtractJSONString = ""
        Exit Function
    End If

    startPos = startPos + Len(searchStr)

    ' Find closing quote, skip escaped quotes (\")
    Dim pos As Long
    pos = startPos
    Dim result As String
    result = ""
    Do While pos <= Len(jsonStr)
        Dim ch As String
        ch = Mid(jsonStr, pos, 1)
        If ch = "\" Then
            ' Escape sequence: grab next char
            Dim nextCh As String
            nextCh = Mid(jsonStr, pos + 1, 1)
            Select Case nextCh
                Case "n":  result = result & vbCrLf
                Case "t":  result = result & vbTab
                Case """": result = result & """"
                Case "\": result = result & "\"
                Case "r":  ' carriage return, skip
                Case Else: result = result & nextCh
            End Select
            pos = pos + 2
        ElseIf ch = """" Then
            ' End of string
            ExtractJSONString = Trim(result)
            Exit Function
        Else
            result = result & ch
            pos = pos + 1
        End If
    Loop

    ExtractJSONString = Trim(result)
End Function

'
' Extracts the first string element from a JSON array value for a given key.
' Handles: "key": ["value", ...]
' Joins multiple array elements with newline if present.
'
Function ExtractJSONArrayString(jsonStr As String, key As String) As String
    ' Find "key": [
    Dim searchStr As String
    searchStr = """" & key & """: ["
    Dim startPos As Long
    startPos = InStr(jsonStr, searchStr)
    If startPos = 0 Then
        ExtractJSONArrayString = ""
        Exit Function
    End If
    startPos = startPos + Len(searchStr)

    ' Find the opening quote of the first string element
    Dim quotePos As Long
    quotePos = InStr(startPos, jsonStr, """")
    If quotePos = 0 Then
        ExtractJSONArrayString = ""
        Exit Function
    End If

    ' Now extract the string starting after the opening quote
    ' Reuse ExtractJSONString logic by building a fake snippet
    ' Simply find matching closing quote, honoring escape sequences
    Dim pos As Long
    pos = quotePos + 1
    Dim result As String
    result = ""
    Dim combined As String
    combined = ""

    Do While pos <= Len(jsonStr)
        Dim ch As String
        ch = Mid(jsonStr, pos, 1)
        If ch = "\" Then
            Dim nextCh As String
            nextCh = Mid(jsonStr, pos + 1, 1)
            Select Case nextCh
                Case "n":  result = result & vbCrLf
                Case "t":  result = result & vbTab
                Case """": result = result & """"
                Case "\": result = result & "\"
                Case "r":  ' skip
                Case Else: result = result & nextCh
            End Select
            pos = pos + 2
        ElseIf ch = """" Then
            ' End of this array element string
            If combined <> "" Then combined = combined & vbCrLf
            combined = combined & Trim(result)
            result = ""
            ' Skip whitespace and comma, look for next "  or  ]
            Dim nextPos As Long
            nextPos = pos + 1
            Do While nextPos <= Len(jsonStr)
                Dim nc As String
                nc = Mid(jsonStr, nextPos, 1)
                If nc = "]" Then GoTo DoneArrayParse
                If nc = """" Then
                    pos = nextPos  ' start of next element
                    result = ""
                    Exit Do
                End If
                nextPos = nextPos + 1
            Loop
            pos = nextPos + 1
        Else
            result = result & ch
            pos = pos + 1
        End If
    Loop

DoneArrayParse:
    ExtractJSONArrayString = combined
End Function

'
' Extracts a JSON object block for a given key:
'   "key": { ... }
' Returns the inner content including braces.
'
Function ExtractJSONBlock(jsonStr As String, key As String) As String
    Dim searchStr As String
    searchStr = """" & key & """: {"

    Dim startPos As Long
    startPos = InStr(jsonStr, searchStr)
    If startPos = 0 Then
        ExtractJSONBlock = ""
        Exit Function
    End If

    startPos = startPos + Len(searchStr) - 1  ' include opening {

    ' Balance braces to find matching }
    Dim depth As Integer
    depth = 0
    Dim pos As Long
    pos = startPos
    Do While pos <= Len(jsonStr)
        Dim ch As String
        ch = Mid(jsonStr, pos, 1)
        If ch = "{" Then depth = depth + 1
        If ch = "}" Then
            depth = depth - 1
            If depth = 0 Then
                ExtractJSONBlock = Mid(jsonStr, startPos, pos - startPos + 1)
                Exit Function
            End If
        End If
        pos = pos + 1
    Loop

    ExtractJSONBlock = ""
End Function

'
' Splits a JSON array string into individual item strings.
' Returns an array of item JSON strings.
' Input: the full JSON (e.g. [{"name":"a",...}, {"name":"b",...}])
'
Function SplitJSONArray(jsonStr As String) As String()
    Dim result() As String
    Dim count As Integer
    count = 0
    ReDim result(0)

    ' Find array bounds
    Dim startPos As Long
    startPos = InStr(jsonStr, "[")
    Dim endPos As Long
    endPos = InStrRev(jsonStr, "]")

    If startPos = 0 Or endPos = 0 Or endPos <= startPos Then
        SplitJSONArray = result
        Exit Function
    End If

    Dim inner As String
    inner = Mid(jsonStr, startPos + 1, endPos - startPos - 1)
    inner = Trim(inner)

    If inner = "" Then
        SplitJSONArray = result
        Exit Function
    End If

    ' Walk through and split by top-level { }
    Dim pos As Long
    pos = 1
    Dim depth As Integer
    depth = 0
    Dim itemStart As Long
    itemStart = 0

    Do While pos <= Len(inner)
        Dim ch As String
        ch = Mid(inner, pos, 1)
        Select Case ch
            Case "{"
                If depth = 0 Then itemStart = pos
                depth = depth + 1
            Case "}"
                depth = depth - 1
                If depth = 0 And itemStart > 0 Then
                    Dim item As String
                    item = Mid(inner, itemStart, pos - itemStart + 1)
                    If count > UBound(result) Then ReDim Preserve result(count)
                    result(count) = Trim(item)
                    count = count + 1
                    itemStart = 0
                End If
        End Select
        pos = pos + 1
    Loop

    If count = 0 Then
        ReDim result(0)
    Else
        ReDim Preserve result(count - 1)
    End If

    SplitJSONArray = result
End Function
