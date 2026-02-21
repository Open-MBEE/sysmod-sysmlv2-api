#
#   Simple Flask server for the SYSMOD Methodology
#
#    Copyright 2025 Tim Weilkiens
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

from flask import Flask, send_from_directory, request, jsonify, Response
import requests
import os
import werkzeug
from anytree import NodeMixin, RenderTree
import sys
import re
import io
import json
import csv
import traceback
import importlib
from typing import Optional
from functools import wraps
from dotenv import load_dotenv

load_dotenv() # Load environment variables from .env file


import sysmod_api_helpers 
import mbse4u_sysmlv2_api_helpers as mbse4u_sysmlv2
from enum import Enum
from pleml_api_server import pleml_blueprint, init_pleml_cache

class SysmodContextKinds(Enum):
    BROWNFIELD = 'SYSMOD::Project::brownfieldSystemContext'
    SYSTEMIDEA = 'SYSMOD::Project::systemIdeaContext'
    SYSTEM = 'SYSMOD::Project::requirementSystemContext'
    FUNCTIONAL = 'SYSMOD::Project::functionalSystemContext'
    LOGICAL = 'SYSMOD::Project::logicalSystemContext'
    PRODUCT = 'SYSMOD::Project::productSystemContext'

# OpenAI Configuration
# These keys should ideally be loaded from environment variables or a secure configuration management system,
# not hardcoded or passed directly in every request for security reasons.
# For demonstration purposes, they might be set here or expected in the request body of specific API calls.
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "") # Example: Load from environment variable
OPENAI_ORG_ID = os.environ.get("OPENAI_ORG_ID", "") # Example: Load from environment variable

app = Flask(__name__, static_folder='html')
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = True  # Optional: Pretty print JSON
app.config['JSONIFY_MIMETYPE'] = 'application/json'

# Global SYSMOD Cache
# Value: Dict[sysmod_element, element_data]
SYSMOD_CACHE = {}

# Register the PLeML blueprint (provides all /api/feature endpoints)
app.register_blueprint(pleml_blueprint)
init_pleml_cache(SYSMOD_CACHE)

@app.route('/')
def serve_index():
    return send_from_directory(app.static_folder, 'index.html')

# Serve static files (including images)
@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory(app.static_folder, filename)

################################################################################################################
#
# Decorator to handle errors in routes
#
from requests.exceptions import ReadTimeout, ConnectTimeout, ConnectionError

# ... imports ...

def handle_errors(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except ReadTimeout:
            print(f"ReadTimeout in {func.__name__}")
            return jsonify({"error": "The server took too long to respond (Read Timeout). Please try again later or check your network connection."}), 504
        except ConnectTimeout:
            print(f"ConnectTimeout in {func.__name__}")
            return jsonify({"error": "Could not connect to the server (Connection Timeout). Please check the Server URL and your network."}), 504
        except ConnectionError:
            print(f"ConnectionError in {func.__name__}")
            return jsonify({"error": "Network error occurred. Failed to connect to the server."}), 503
        except requests.HTTPError as e:
            print(f"HTTP Error in {func.__name__}: {e}")
            return jsonify({"error": f"HTTP error: {str(e)}"}), 500
        except Exception as e:
            traceback.print_exc()
            print(f"Error in {func.__name__}: {e}")
            return jsonify({"error": str(e)}), 500
    return wrapper

################################################################################################################
#
# API Endpoints
#

#
# Cache Warmup
#
@app.route('/api/cache/warmup', methods=['POST'])
@handle_errors
def api_cache_warmup():
    input_data = request.json
    print(f"/api/cache/warmup called with data: {input_data}")
    
    server_url = input_data.get('server_url')
    project_id = input_data.get('project_id')
    commit_id = input_data.get('commit_id')
    page_size = input_data.get('page_size', 256)
    
    if not all([server_url, project_id, commit_id]):
        raise ValueError("Required parameters missing.")
        
    count = mbse4u_sysmlv2.load_model_cache(server_url, project_id, commit_id, page_size)
    return jsonify({"status": "success", "cached_elements": count})

#
# Retrieve List of Projects on a given Server
#
@app.route('/api/projects', methods=['POST'])
@handle_errors
def api_projects():
    input_data = request.json
    print(f"/api/projects called with data: {input_data}")
    server_url = input_data.get('server_url')
    if not server_url:
        return jsonify({"error": "server_url is required"}), 400
        
    page_size = input_data.get('page_size', 256)

    # Call the utility function
    projects = mbse4u_sysmlv2.get_projects(server_url, page_size)
    print(f"{len(projects)} projects found.")
    return jsonify(projects)

#
# Retrieve List of Commits for a given ProjectID
#
@app.route('/api/commits', methods=['POST'])
@handle_errors
def api_commits():
    input_data = request.json
    print(f"/api/commits called with data: {input_data}")

    # Extract input values
    server_url = input_data.get('server_url')
    project_id = input_data.get('project_id', "").split(' ')[0]  # Safely split and handle edge cases

    # Fetch commits using the utility function
    commits = mbse4u_sysmlv2.get_commits(server_url, project_id)
    print(f"{len(commits)} commits found.")
    return jsonify(commits)

#
# Get SYSMOD Projects
#
@app.route('/api/sysmod_projects', methods=['POST'])
@handle_errors
def api_sysmod_projects():
    input_data = request.json
    print(f"/api/sysmod_projects called with data: {input_data}")

    # Required inputs
    server_url = input_data.get('server_url')
    project_id = input_data.get('project_id')
    commit_id = input_data.get('commit_id')

    if not server_url or not project_id or not commit_id:
        raise ValueError("Server_url, project_id, and commit_id are required.")

    simplified_projects = sysmod_api_helpers.get_sysmod_projects(server_url, project_id, commit_id)
            
    print(f"Returning {len(simplified_projects)} simplified projects.")
    return jsonify(simplified_projects)

#
# Get Project Details (Name + Documentation)
#
@app.route('/api/sysmod_project', methods=['POST'])
@handle_errors
def api_sysmod_project():
    input_data = request.json
    print(f"\n/api/sysmod_project called with data: {input_data}")

    server_url = input_data.get('server_url')
    project_id = input_data.get('project_id')
    commit_id = input_data.get('commit_id')
    sysmod_project_id = input_data.get('element_id')

    if 'PROJECT_ID' in SYSMOD_CACHE and SYSMOD_CACHE['PROJECT_ID'] == sysmod_project_id:
        if 'PROJECT' in SYSMOD_CACHE:
            print("Returning cached project") 
            return jsonify(SYSMOD_CACHE['PROJECT'])
    else:
        SYSMOD_CACHE.clear()

    if not all([server_url, project_id, commit_id, sysmod_project_id]):
        raise ValueError("server_url, project_id, commit_id, and sysmod_project_id are required.")

    response_data = sysmod_api_helpers.get_sysmod_project(server_url, project_id, commit_id, sysmod_project_id)
    print(f"Returning sysmod project: {response_data}")
    SYSMOD_CACHE['PROJECT_ID'] = sysmod_project_id
    SYSMOD_CACHE['PROJECT'] = response_data
    return jsonify(response_data)


#
# Get Generic Element by ID
#
@app.route('/api/element', methods=['POST'])
@handle_errors
def api_element():
    input_data = request.json
    print(f"/api/element called with data: {input_data}")

    server_url = input_data.get('server_url')
    project_id = input_data.get('project_id')
    commit_id = input_data.get('commit_id')
    element_id = input_data.get('element_id')

    if not all([server_url, project_id, commit_id, element_id]):
        raise ValueError("server_url, project_id, commit_id, and element_id are required.")

    query_url = f"{server_url}/projects/{project_id}/commits/{commit_id}"
    element = mbse4u_sysmlv2.get_element_fromAPI(query_url, element_id)
    
    # Enrich with documentation if not present as a property or object
    if element and ('documentation' not in element):
        doc_text = mbse4u_sysmlv2.get_element_documentation(server_url, project_id, commit_id, element_id)
        if doc_text:
            element['documentation'] = doc_text
    
    return jsonify(element)

#
# Get Problem Statement
#
@app.route('/api/problem-statement', methods=['POST'])
@handle_errors
def api_problem_statement():
    input_data = request.json
    print(f"\n/api/problem-statement called with data: {input_data}")

    if 'PROBLEMSTATEMENT' in SYSMOD_CACHE:
        print("Returning cached problem statement") 
        return jsonify(SYSMOD_CACHE['PROBLEMSTATEMENT'])

    server_url = input_data.get('server_url')
    project_id = input_data.get('project_id')
    commit_id = input_data.get('commit_id')
    sysmod_project_id = input_data.get('sysmod_project_id') # This is the project element ID

    if not all([server_url, project_id, commit_id, sysmod_project_id]):
        raise ValueError("server_url, project_id, commit_id, and sysmod_project_id are required.")

    problem_stmt = sysmod_api_helpers.get_problem_statement(server_url, project_id, commit_id, sysmod_project_id)
    if problem_stmt:
        print(f"Returning problem statement: {problem_stmt}")   
        SYSMOD_CACHE['PROBLEMSTATEMENT'] = problem_stmt
        return jsonify(problem_stmt)
    else:
        return jsonify({"error": "Problem statement not found"}), 404

#
# Save Problem Statement
#
@app.route('/api/problem-statement/save', methods=['POST'])
@handle_errors
def api_save_problem_statement():
    input_data = request.json
    print(f"/api/problem-statement/save called with data: {input_data}")

    server_url = input_data.get('server_url')
    project_id = input_data.get('project_id')
    commit_id = input_data.get('commit_id')
    sysmod_project_id = input_data.get('sysmod_project_id')
    new_text = input_data.get('text')

    if not all([server_url, project_id, commit_id, sysmod_project_id]):
        raise ValueError("server_url, project_id, commit_id, and sysmod_project_id are required.")

    # Prepare for saving logic (Stub)
    print(f"Would save new problem statement: '{new_text}' to project {sysmod_project_id}")
    problem_stmt = sysmod_api_helpers.get_problem_statement(server_url, project_id, commit_id, sysmod_project_id)
    print(f"Current problem statement: '{problem_stmt}'")
    new_commit_id = mbse4u_sysmlv2.update_model_element(server_url, project_id, commit_id, problem_stmt.get('id'), "body", new_text)
    print(f"New commit ID: {new_commit_id}")
    return jsonify({"status": "success", "message": "Problem statement saved (simulation).", "commit_id": new_commit_id})

#
# Get System Idea
#
@app.route('/api/system-idea', methods=['POST'])
@handle_errors
def api_system_idea():
    input_data = request.json
    print(f"/api/system-idea called with data: {input_data}")

    server_url = input_data.get('server_url')
    project_id = input_data.get('project_id')
    commit_id = input_data.get('commit_id')
    sysmod_project_id = input_data.get('sysmod_project_id')

    if not all([server_url, project_id, commit_id, sysmod_project_id]):
        raise ValueError("server_url, project_id, commit_id, and sysmod_project_id are required.")

    sys_idea_doc = sysmod_api_helpers.get_system_idea(server_url, project_id, commit_id, sysmod_project_id)
    
    return jsonify(sys_idea_doc)

#
# Get Brownfield Context
#
@app.route('/api/sysmod-context', methods=['POST'])
@handle_errors
def api_context():
    input_data = request.json
    server_url = input_data.get('server_url')
    project_id = input_data.get('project_id')
    commit_id = input_data.get('commit_id')
    sysmod_project_id = input_data.get('sysmod_project_id')
    context_type = input_data.get('context_type')

    print(f"\n/api/sysmod-context called with data: {input_data}")

    if context_type in SYSMOD_CACHE:
        print("Returning cached context") 
        return jsonify(SYSMOD_CACHE[context_type])

    if not context_type in SysmodContextKinds._member_map_:
        print(f"Unknown context type: {context_type}")
        return jsonify({"error": f"Unknown context type: {context_type}"}), 400

    if not all([server_url, project_id, commit_id, sysmod_project_id]):
        raise ValueError("Required parameters missing.")

    context = sysmod_api_helpers.get_context(server_url, project_id, commit_id, sysmod_project_id, SysmodContextKinds[context_type].value)
    SYSMOD_CACHE[context_type] = context
    return jsonify(context)

#
# Get Requirements
#
@app.route('/api/sysmod-requirements', methods=['POST'])
@handle_errors
def api_requirements():
    input_data = request.json
    print(f"/api/sysmod-requirements called with data: {input_data}")
    
    server_url = input_data.get('server_url')
    project_id = input_data.get('project_id')
    commit_id = input_data.get('commit_id')
    sysmod_project_id = input_data.get('sysmod_project_id')
    
    if not all([server_url, project_id, commit_id, sysmod_project_id]):
         raise ValueError("server_url, project_id, commit_id, and sysmod_project_id are required.")

    requirements = sysmod_api_helpers.get_sysmod_requirements(server_url, project_id, commit_id, sysmod_project_id)
    
    return jsonify(requirements)

#
# Get Use Cases
#
@app.route('/api/sysmod-usecases', methods=['POST'])
@handle_errors
def api_usecases():
    input_data = request.json
    print(f"/api/sysmod-usecases called with data: {input_data}")
    
    server_url = input_data.get('server_url')
    project_id = input_data.get('project_id')
    commit_id = input_data.get('commit_id')
    sysmod_project_id = input_data.get('sysmod_project_id')
    
    if not all([server_url, project_id, commit_id, sysmod_project_id]):
         raise ValueError("server_url, project_id, commit_id, and sysmod_project_id are required.")

    usecases = sysmod_api_helpers.get_sysmod_usecases(server_url, project_id, commit_id, sysmod_project_id)
    
    return jsonify(usecases)

#
# Get Stakeholders
#
@app.route('/api/stakeholders', methods=['POST'])
@handle_errors
def api_stakeholders():
    input_data = request.json
    server_url = input_data.get('server_url')
    project_id = input_data.get('project_id')
    commit_id = input_data.get('commit_id')
    sysmod_project_id = input_data.get('sysmod_project_id')

    if not all([server_url, project_id, commit_id, sysmod_project_id]):
        raise ValueError("Required parameters missing.")

    #if 'STAKEHOLDERS' in SYSMOD_CACHE:
    #    return jsonify(SYSMOD_CACHE['STAKEHOLDERS'])

    stakeholders = sysmod_api_helpers.get_stakeholders(server_url, project_id, commit_id, sysmod_project_id)
    if stakeholders:
        SYSMOD_CACHE['STAKEHOLDERS'] = stakeholders
        print(f"Stakeholders: {stakeholders}")  
        return jsonify(stakeholders)
    else:
        return None

# /api/feature endpoints are provided by pleml_api_server.py (pleml_blueprint)

@app.route('/api/quality-checks', methods=['POST'])
def api_quality_checks():
    data = request.json
    print(f"\n/api/quality-checks called with data: {data}")
    
    server_url = data.get('server_url')
    project_id = data.get('project_id')
    commit_id = data.get('commit_id')
    sysmod_project_id = data.get('sysmod_project_id')
    activated_views = data.get('activated_views', [])
    
    print(f"Context: {project_id} / {commit_id} / {sysmod_project_id}")
    print(f"Active views for quality check: {activated_views}")
    
    quality_checks = []
    
    if not all([server_url, project_id, commit_id, sysmod_project_id]):
        quality_checks.append({
            "id": "VIEWER-000",
            "title": "Missing Parameters",
            "description": "One of the parameters is missing: server_url, project_id, commit_id, sysmod_project_id",
            "status": "failed"
        })
        return jsonify(quality_checks)

    if 'problem_statement' in activated_views:
        problem_stmt = None
        if 'PROBLEMSTATEMENT' in SYSMOD_CACHE:
            problem_stmt = SYSMOD_CACHE['PROBLEMSTATEMENT']
        else:
            problem_stmt = sysmod_api_helpers.get_problem_statement(server_url, project_id, commit_id, sysmod_project_id)   
            SYSMOD_CACHE['PROBLEMSTATEMENT'] = problem_stmt

        if not problem_stmt:
            quality_checks.append({
                "id": "SYSMOD-001",
                "title": "Missing Problem Statement",
                "description": "The model does not contain a problem statement.",
                "status": "failed"
        })
        else:
            quality_checks.append({
                "id": "SYSMOD-001",
                "title": "Problem Statement",
                "description": "The model contains a problem statement.",
                "status": "successful"
        })
    
    if 'system_idea' in activated_views:
        sys_idea_doc = sysmod_api_helpers.get_system_idea(server_url, project_id, commit_id, sysmod_project_id)
        if not sys_idea_doc:
            quality_checks.append({
                "id": "SYSMOD-002",
                "title": "Missing System Idea",
                "description": "The model does not contain a system idea.",
                "status": "failed"
        })
        else:
            quality_checks.append({
                "id": "SYSMOD-002",
                "title": "System Idea",
                "description": "The model contains a system idea.",
                "status": "successful"
        })
       
    return jsonify(quality_checks)

#
# SYSMOD Status
#
@app.route('/api/sysmod-atlas', methods=['POST'])
@handle_errors
def api_sysmod_atlas():
    input_data = request.json
    print(f"/api/sysmod-atlas called with data: {input_data}")
    
    server_url = input_data.get('server_url')
    project_id = input_data.get('project_id')
    commit_id = input_data.get('commit_id')
    sysmod_project_id = input_data.get('sysmod_project_id')
    loadAll = input_data.get('loadAll')
    
    if not all([server_url, project_id, commit_id, sysmod_project_id]):
         return jsonify({"error": "Missing parameters"}), 400

    print(f"Getting SYSMOD atlas for project {sysmod_project_id}")
    query_url = mbse4u_sysmlv2.get_commit_url(server_url, project_id, commit_id)
    
    atlas = {
        "FEATURE": False,
        "BROWNFIELD": False,
        "STAKEHOLDERS": False,
        "PROBLEMSTATEMENT": False,
        "SYSTEMIDEA": False,
        "SYSTEM": False,
        "USECASES": False,
        "REQUIREMENTS": False,
        "FUNCTIONAL": False,
        "LOGICAL": False,
        "PRODUCT": False
    }

    # 1. FEATURE (Feature Tree)
    if 'FEATURETREEUVL' in SYSMOD_CACHE:
        atlas["FEATURE"] = True 
    elif loadAll:
        feature_tree_uvl = sysmod_api_helpers.get_feature_tree_uvl(server_url, project_id, commit_id, sysmod_project_id)
        if feature_tree_uvl:
            atlas["FEATURE"] = True
            SYSMOD_CACHE['FEATURETREEUVL'] = feature_tree_uvl

    # 2. Check Context Kinds
    
    # Mapping from Enum Name to Frontend Grid ID Suffix
    kind_to_grid_map = {
        'BROWNFIELD': 'BFAC',
        'SYSTEMIDEA': 'SIC',
        'SYSTEM': 'SC',
        'FUNCTIONAL': 'FUC',
        'LOGICAL': 'LAC',
        'PRODUCT': 'PAC'
    }

    for kind in SysmodContextKinds:
        # Determine the key used in the Atlas dictionary (must match frontend IDs)
        atlas_key = kind_to_grid_map.get(kind.name, kind.name)
        
        # Check Cache using the Enum Name (as stored in api_context)
        cache_key = kind.name
        
        if cache_key in SYSMOD_CACHE:
            atlas[atlas_key] = True
        elif loadAll:
            try:
                # We pass the Enum Value (qualified name) to get_context
                ctx_data = sysmod_api_helpers.get_context(server_url, project_id, commit_id, sysmod_project_id, kind.value)
                if ctx_data:
                    atlas[atlas_key] = True
                    SYSMOD_CACHE[cache_key] = ctx_data
            except Exception as e:
                print(f"Error loading {kind.name}: {e}")
        else:
            # Fallback Light Check (Original Layout)
            def check_specialization(qualified_name):
                return mbse4u_sysmlv2.find_elements_specializing(server_url, project_id, commit_id, part_usages, qualified_name)
                
            if not atlas.get(atlas_key):
                if check_specialization(kind.value):
                    atlas[atlas_key] = True

    # 3. STAKEHOLDERS
    if 'STAKEHOLDERS' in SYSMOD_CACHE:
        atlas["STAKE"] = True
    elif loadAll:
        stakeholders = sysmod_api_helpers.get_stakeholders(server_url, project_id, commit_id, sysmod_project_id)
        if stakeholders:
            atlas["STAKE"] = True
            SYSMOD_CACHE['STAKEHOLDERS'] = stakeholders
    else:
        # Light Check
        if mbse4u_sysmlv2.find_elements_specializing(server_url, project_id, commit_id, part_usages, 'projectStakeholders'):
            atlas["STAKE"] = True
        else:
            for p in part_usages:
                children = mbse4u_sysmlv2.get_contained_elements(server_url, project_id, commit_id, p['@id'], 'PartUsage')
                if mbse4u_sysmlv2.find_elements_specializing(server_url, project_id, commit_id, children, 'projectStakeholders'):
                    atlas["STAKE"] = True
                    break

    # 4. PROBLEM STATEMENT
    if 'PROBLEMSTATEMENT' in SYSMOD_CACHE:
        atlas["PS"] = True
    elif loadAll:
        ps = sysmod_api_helpers.get_problem_statement(server_url, project_id, commit_id, sysmod_project_id)
        if ps:
            atlas["PS"] = True
            SYSMOD_CACHE['PROBLEMSTATEMENT'] = ps
    else:
        # Light Check
        concern_usages = mbse4u_sysmlv2.get_contained_elements(server_url, project_id, commit_id, sysmod_project_id, 'ConcernUsage')
        if mbse4u_sysmlv2.find_elements_specializing(server_url, project_id, commit_id, concern_usages, 'problemStatement'):
             atlas["PS"] = True
        else:
             all_req_usages = mbse4u_sysmlv2.get_elements_byKind_fromAPI(server_url, project_id, commit_id, 'RequirementUsage')
             if mbse4u_sysmlv2.find_elements_specializing(server_url, project_id, commit_id, all_req_usages, 'problemStatement'):
                 atlas["PS"] = True

    # 5. USE CASES
    if 'USECASES' in SYSMOD_CACHE:
        atlas["UC"] = True
    elif loadAll:
        ucs = sysmod_api_helpers.get_sysmod_usecases(server_url, project_id, commit_id, sysmod_project_id)
        if ucs:
            atlas["UC"] = True
            SYSMOD_CACHE['USECASES'] = ucs
    else:
        # Light Check
        uc_usages = mbse4u_sysmlv2.get_contained_elements(server_url, project_id, commit_id, sysmod_project_id, 'UseCaseUsage')
        if mbse4u_sysmlv2.find_elements_specializing(server_url, project_id, commit_id, uc_usages, 'useCase'):
             atlas["UC"] = True
        else:
             all_ucs = mbse4u_sysmlv2.get_elements_byKind_fromAPI(server_url, project_id, commit_id, 'UseCaseUsage')
             if mbse4u_sysmlv2.find_elements_specializing(server_url, project_id, commit_id, all_ucs, 'useCase'):
                  atlas["UC"] = True
            
    # 6. REQUIREMENTS
    if 'REQUIREMENTS' in SYSMOD_CACHE:
        atlas["RE"] = True
    elif loadAll:
        reqs = sysmod_api_helpers.get_sysmod_requirements(server_url, project_id, commit_id, sysmod_project_id)
        if reqs:
            atlas["RE"] = True
            SYSMOD_CACHE['REQUIREMENTS'] = reqs
    else:
        # Light Check
        req_usages_generic = mbse4u_sysmlv2.get_contained_elements(server_url, project_id, commit_id, sysmod_project_id, 'RequirementUsage')
        if req_usages_generic:
             atlas["RE"] = True
        else:
            all_reqs = mbse4u_sysmlv2.get_elements_byKind_fromAPI(server_url, project_id, commit_id, 'RequirementUsage')
            if mbse4u_sysmlv2.find_elements_specializing(server_url, project_id, commit_id, all_reqs, 'requirement'):
                atlas["RE"] = True
            
    return jsonify(atlas)

#
# AI Suggestion Endpoint
#
@app.route('/api/ai-suggestion_problem_statement', methods=['POST'])
@handle_errors 
def api_ai_suggestion_problem_statement():
    input_data = request.json
    print(f"/api/ai-suggestion_problem_statement called with data: {input_data}")
    
    text = input_data.get('text', '')
    
    api_key = input_data.get('api_key')
    org_id = input_data.get('org_id')
    
    if not api_key:
         return jsonify({"suggestion": "Error: OpenAI API Key not provided. Please set it in the 'AI Configuration' settings."}), 400

    prompt = f"""
Please rewrite the following Problem Statement to make it clearer, more concise, and sharply focused on the problem itself rather than the solution.
The rewritten statement must:
- Begin with the phrase "How can we…"
- Be short and impactful, suitable as an elevator pitch that can be explained in 30 seconds or less
- Preserve all original content and meaning
- You may rephrase or restructure the text for clarity
- Do not remove any information
- Avoid introducing solutions, technologies, or implementation details    

    Draft Problem Statement:
    "{text}"
    
    Revised Problem Statement:
    """

    suggestion = sysmod_api_helpers.call_ai(prompt, api_key, org_id)
    
    return jsonify({"suggestion": suggestion})


#
# Wizard: Project Setup (Step 1)
#
@app.route('/api/wizard/project-setup', methods=['POST'])
@handle_errors
def api_wizard_project_setup():
    input_data = request.json
    print(f"/api/wizard/project-setup called with data: {input_data}")
    
    name = input_data.get('name', 'MySystem')
    description = input_data.get('description', '')

    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', name):
        name_val = f"'{name}'"
        # For quoted names, we can't easily adhere to the "start with lower case" rule for the identifier part,
        # but we can try to sanitize it for the derived names.
        # Let's just use the sanitized version for derived names.
        sanitized_name = re.sub(r'[^a-zA-Z0-9_]', '_', name)
        if sanitized_name and sanitized_name[0].isdigit():
             sanitized_name = "_" + sanitized_name
        name_lower = sanitized_name[0].lower() + sanitized_name[1:] if sanitized_name else "mySystem"        
    else:
        name_val = name
        name_lower = name[0].lower() + name[1:] if name else "mySystem"

    model_template_path = os.path.join(app.root_path, 'prompts', 'sysmod-model-template.txt')
    print(f"Loading model template from: {model_template_path}")
    try:
        with open(model_template_path, 'r', encoding='utf-8') as f:
            model_template = f.read()
        print(f"Model template loaded: {model_template}")
        model_code = model_template.format(
            name=name_val,
            name_lower=name_lower,
            description=description,
        )
    except Exception as e:
        print(f"Error loading model template: {type(e).__name__}: {e}")
        return jsonify({"status": "error", "message": f"Error loading model template: {str(e)}"}), 500

    return jsonify({"code": model_code})

def read_upload_file_content(file_path, filename):
    """Helper to read content from uploaded files (txt, pdf, docx)."""
    ext = filename.lower()
    content = ""
    try:
        if ext.endswith(('.txt', '.md', '.sysml', '.json', '.xml', '.csv')):
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
        elif ext.endswith('.pdf'):
            try:
                from pypdf import PdfReader
                reader = PdfReader(file_path)
                for page in reader.pages:
                    content += page.extract_text() + "\n"
            except ImportError:
                 return "[Error: pypdf library not installed]"
        elif ext.endswith('.docx'):
            try:
                import docx
                doc = docx.Document(file_path)
                for para in doc.paragraphs:
                    content += para.text + "\n"
            except ImportError:
                 return "[Error: python-docx library not installed]"
        else:
            return "(Content not read, binary format)"
        return content
    except Exception as e:
        print(f"Error reading {filename}: {e}")
        return f"[Error reading file: {str(e)}]"

@app.route('/api/wizard/files', methods=['GET'])
@handle_errors
def api_wizard_get_files():
    system_name = request.args.get('systemName', 'MySystem')
    upload_root = os.path.join(app.root_path, 'uploads', system_name)
    
    files_list = []
    if os.path.exists(upload_root):
        for root, dirs, files in os.walk(upload_root):
            for file in files:
                # Get relative path from upload_root
                abs_path = os.path.join(root, file)
                rel_path = os.path.relpath(abs_path, upload_root)
                # Convert backslashes to forward slashes for consistency
                rel_path = rel_path.replace('\\', '/')
                size = os.path.getsize(abs_path)
                files_list.append({
                    "name": rel_path,
                    "size": size
                })
    
    return jsonify({"files": files_list})

@app.route('/api/wizard/brownfield', methods=['POST'])
@handle_errors
def api_wizard_brownfield():
    system_name = request.form.get('systemName', 'MySystem')
    description = request.form.get('description', '')
    files = request.files.getlist('files')
    sysml_code = request.form.get('sysmlCode', '')

    print(f"/api/wizard/brownfield called. System: {system_name}, Files: {len(files)}")
    print(f"Description: {description}")
    
    upload_root = os.path.join(app.root_path, 'uploads', system_name)
    upload_dir = os.path.join(upload_root, 'brownfield')
    os.makedirs(upload_dir, exist_ok=True)
    
    saved_files = []
    file_contents = ""
    
    # Process new uploads
    for file in files:
        if file.filename:
            filename = werkzeug.utils.secure_filename(file.filename)
            file_path = os.path.join(upload_dir, filename)
            file.save(file_path)
            saved_files.append(filename)
            
            content = read_upload_file_content(file_path, filename)
            file_contents += f"\n--- File (Uploaded): {filename} ---\n{content}\n"

    # Process existing selected files
    existing_files = request.form.getlist('existingFiles')
    for rel_path in existing_files:
        # Prevent traversal
        if '..' in rel_path or rel_path.startswith('/'):
            continue
            
        file_path = os.path.join(upload_root, rel_path)
        if os.path.exists(file_path):
             filename = os.path.basename(rel_path)
             content = read_upload_file_content(file_path, filename)
             file_contents += f"\n--- File (Existing): {filename} ---\n{content}\n"

    # Compute name_val for prompt template, similar to helper logic
    import re
    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', system_name):
        name_val = f"'{system_name}'"
    else:
        name_val = system_name

    # Construct the AI prompt
    prompt_path = os.path.join(app.root_path, 'prompts', 'brownfield-prompt.txt')
    try:
        with open(prompt_path, 'r', encoding='utf-8') as f:
            prompt_template = f.read()

        prompt = prompt_template.format(
            name_val=name_val,
            description=description,
            file_contents=file_contents,
            sysml_code=sysml_code
        )
    except Exception as e:
        print(f"Error loading prompt: {e}")
        return jsonify({"status": "error", "message": f"Error loading prompt: {str(e)}"}), 500
    suggestion = ""
    # Call AI if API Key is available
    api_key = os.environ.get("OPENAI_API_KEY") or request.form.get('api_key')
    if api_key:
        print("Calling AI for Brownfield analysis...")
        suggestion = sysmod_api_helpers.clean_ai_response(sysmod_api_helpers.call_ai(prompt, api_key))
    else:
        print("No OpenAI API Key found. Skipping AI analysis.")
        suggestion = "AI analysis skipped (API Key missing)."
    
    return jsonify({
        "status": "success",
        "message": f"Saved {len(saved_files)} files.",
        "files": saved_files,
        "ai_suggestion": suggestion
    })


@app.route('/api/wizard/problem', methods=['POST'])
@handle_errors
def api_wizard_problem():
    system_name = request.form.get('systemName', 'MySystem')
    description = request.form.get('description', '')
    sysml_code = request.form.get('sysmlCode', '')
    files = request.files.getlist('files')
    
    print(f"/api/wizard/problem called. System: {system_name}, Files: {len(files)}")
    
    upload_root = os.path.join(app.root_path, 'uploads', system_name)
    upload_dir = os.path.join(upload_root, 'problem')
    os.makedirs(upload_dir, exist_ok=True)
    
    saved_files = []
    file_contents = ""
    
    # Process new uploads
    for file in files:
        if file.filename:
            filename = werkzeug.utils.secure_filename(file.filename)
            file_path = os.path.join(upload_dir, filename)
            file.save(file_path)
            saved_files.append(filename)
            
            content = read_upload_file_content(file_path, filename)
            file_contents += f"\n--- File (Uploaded): {filename} ---\n{content}\n"

    # Process existing selected files
    existing_files = request.form.getlist('existingFiles')
    for rel_path in existing_files:
        if '..' in rel_path or rel_path.startswith('/'):
            continue
        file_path = os.path.join(upload_root, rel_path)
        if os.path.exists(file_path):
             filename = os.path.basename(rel_path)
             content = read_upload_file_content(file_path, filename)
             file_contents += f"\n--- File (Existing): {filename} ---\n{content}\n"

    # Compute name_val for prompt template, similar to helper logic
    import re
    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', system_name):
        name_val = f"'{system_name}'"
    else:
        name_val = system_name

    prompt_path = os.path.join(app.root_path, 'prompts', 'problem-statement-prompt.txt')
    try:
        with open(prompt_path, 'r', encoding='utf-8') as f:
            prompt_template = f.read()

        prompt = prompt_template.format(
            name=name_val,
            description=description,
            file_contents=file_contents,
            sysml_code=sysml_code
        )
    except Exception as e:
        print(f"Error loading prompt: {e}")
        return jsonify({"status": "error", "message": f"Error loading prompt: {str(e)}"}), 500

    problem_statement = ""
    api_key = os.environ.get("OPENAI_API_KEY") or request.form.get('api_key')
    
    if api_key:
        print("Calling AI for Problem Statement analysis...")
        problem_statement = sysmod_api_helpers.clean_ai_response(sysmod_api_helpers.call_ai(prompt, api_key))
        problem_statement_sysml_model = sysml_code.replace("INSERT PROBLEM STATEMENT HERE", problem_statement)
        image_prompt = f"Create a photo realistic image of the following problem statement. Avoid violation of guardrails and feel free to change the image accordingly: {problem_statement}."
        image_url = sysmod_api_helpers.generate_image(image_prompt, api_key)
    else:
        print("No OpenAI API Key found.")
        problem_statement = "AI analysis skipped (API Key missing)."
    
    return jsonify({
        "status": "success",
        "message": f"Saved {len(saved_files)} files.",
        "files": saved_files,
        "problem_statement": problem_statement,
        "problem_statement_sysml_model": problem_statement_sysml_model,
        "image_url": image_url
    })

@app.route('/api/wizard/stakeholders', methods=['POST'])
@handle_errors
def api_wizard_stakeholders():
    system_name = request.form.get('systemName', 'MySystem')
    description = request.form.get('description', '')
    sysml_code = request.form.get('sysmlCode', '')
    files = request.files.getlist('files')
    existing_files = request.form.getlist('existingFiles')
    
    print(f"/api/wizard/stakeholders called. System: {system_name}, New Files: {len(files)}, Existing Files: {len(existing_files)}")
    
    upload_root = os.path.join(app.root_path, 'uploads', system_name)
    upload_dir = os.path.join(upload_root, 'stakeholders')
    os.makedirs(upload_dir, exist_ok=True)
    
    saved_files = []
    file_contents = ""
    
    # Process new uploads
    for file in files:
        if file.filename:
            filename = werkzeug.utils.secure_filename(file.filename)
            file_path = os.path.join(upload_dir, filename)
            file.save(file_path)
            saved_files.append(filename)
            
            content = read_upload_file_content(file_path, filename)
            file_contents += f"\n--- File (Uploaded): {filename} ---\n{content}\n"

    # Process existing selected files
    for rel_path in existing_files:
        if '..' in rel_path or rel_path.startswith('/'):
            continue
        file_path = os.path.join(upload_root, rel_path)
        if os.path.exists(file_path):
             filename = os.path.basename(rel_path)
             content = read_upload_file_content(file_path, filename)
             file_contents += f"\n--- File (Existing): {filename} ---\n{content}\n"

    # Compute name_val for prompt template, similar to helper logic
    import re
    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', system_name):
        name_val = f"'{system_name}'"
    else:
        name_val = system_name

    prompt_path = os.path.join(app.root_path, 'prompts', 'stakeholders-prompt.txt')
    try:
        with open(prompt_path, 'r', encoding='utf-8') as f:
            prompt_template = f.read()

        prompt = prompt_template.format(
            name_val=name_val,
            description=description,
            file_contents=file_contents,
            sysml_code=sysml_code
        )
    except Exception as e:
        print(f"Error loading prompt: {e}")
        return jsonify({"status": "error", "message": f"Error loading prompt: {str(e)}"}), 500

    suggestion = ""
    api_key = os.environ.get("OPENAI_API_KEY") or request.form.get('api_key')
    
    print(f"Stakeholder Prompt: {prompt}")

    if api_key:
        print("Calling AI for Stakeholder Analysis...")
        suggestion = sysmod_api_helpers.clean_ai_response(sysmod_api_helpers.call_ai(prompt, api_key))
    else:
        print("No OpenAI API Key found.")
        suggestion = "AI analysis skipped (API Key missing)."
    
    return jsonify({
        "status": "success",
        "message": f"Processed {len(saved_files) + len(existing_files)} files ({len(saved_files)} new, {len(existing_files)} existing).",
        "files": saved_files,
        "ai_suggestion": suggestion
    })

@app.route('/api/wizard/system-idea', methods=['POST'])
@handle_errors
def api_wizard_system_idea():
    system_name = request.form.get('systemName', 'MySystem')
    description = request.form.get('description', '')
    sysml_code = request.form.get('sysmlCode', '')
    files = request.files.getlist('files')
    existing_files = request.form.getlist('existingFiles')
    
    print(f"/api/wizard/system-idea called. System: {system_name}, New Files: {len(files)}, Existing Files: {len(existing_files)}")
    
    upload_root = os.path.join(app.root_path, 'uploads', system_name)
    upload_dir = os.path.join(upload_root, 'system-idea')
    os.makedirs(upload_dir, exist_ok=True)
    
    saved_files = []
    file_contents = ""
    
    for file in files:
        if file.filename:
            filename = werkzeug.utils.secure_filename(file.filename)
            file_path = os.path.join(upload_dir, filename)
            file.save(file_path)
            saved_files.append(filename)
            content = read_upload_file_content(file_path, filename)
            file_contents += f"\n--- File (Uploaded): {filename} ---\n{content}\n"

    existing_files = request.form.getlist('existingFiles')
    for rel_path in existing_files:
        if '..' in rel_path or rel_path.startswith('/'):
            continue
        file_path = os.path.join(upload_root, rel_path)
        if os.path.exists(file_path):
             filename = os.path.basename(rel_path)
             content = read_upload_file_content(file_path, filename)
             file_contents += f"\n--- File (Existing): {filename} ---\n{content}\n"

    import re
    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', system_name):
        name_val = f"'{system_name}'"
    else:
        name_val = system_name

    prompt_path = os.path.join(app.root_path, 'prompts', 'system-idea-prompt.txt')
    try:
        with open(prompt_path, 'r', encoding='utf-8') as f:
            prompt_template = f.read()

        prompt = prompt_template.format(
            name=name_val,
            description=description,
            file_contents=file_contents,
            sysml_code=sysml_code
        )
    except Exception as e:
        print(f"Error loading prompt: {e}")
        return jsonify({"status": "error", "message": f"Error loading prompt: {str(e)}"}), 500

    suggestion = ""
    api_key = os.environ.get("OPENAI_API_KEY") or request.form.get('api_key')
      
    if api_key:
        print("Calling AI for System Idea Analysis...")
        ai_response = sysmod_api_helpers.clean_ai_response(sysmod_api_helpers.call_ai(prompt, api_key))
        
        # Parse Description and SysML
        description_text = ""
        sysml_model = ""
        
        if "DESCRIPTION:" in ai_response and "SYSML:" in ai_response:
             parts = ai_response.split("SYSML:")
             sysml_model = parts[1].strip()
             desc_part = parts[0].split("DESCRIPTION:")[1]
             description_text = desc_part.strip()
        else:
             # Fallback if AI didn't follow format strictly
             sysml_model = ai_response
             description_text = description # Use user input as fallback
             
             # Attempt to extract from SysML doc comment: doc systemIdea /* ... */
             import re
             doc_match = re.search(r"doc\s+systemIdea\s*/\*\s*(.*?)\s*\*/", sysml_model, re.DOTALL)
             if doc_match:
                 description_text = doc_match.group(1).strip()
             
        print(f"System Idea Description: {description_text}")
        # Generate Image
        image_prompt = f"Create a photo realistic image of the following system idea. Avoid violation of guardrails and feel free to change the image accordingly: {description_text}"
        image_url = sysmod_api_helpers.generate_image(image_prompt, api_key)

        suggestion = sysml_model
    else:
        print("No OpenAI API Key found.")
        suggestion = "AI analysis skipped (API Key missing)."
        description_text = ""
        image_url = ""
    
    return jsonify({
        "status": "success",
        "message": f"Processed {len(saved_files) + len(existing_files)} files ({len(saved_files)} new, {len(existing_files)} existing).",
        "files": saved_files,
        "ai_suggestion": suggestion,
        "system_idea_description": description_text,
        "image_url": image_url
    })

@app.route('/api/wizard/system-requirements', methods=['POST'])
@handle_errors
def api_wizard_system_requirements():
    system_name = request.form.get('systemName', 'MySystem')
    description = request.form.get('description', '')
    sysml_code = request.form.get('sysmlCode', '')
    files = request.files.getlist('files')
    existing_files = request.form.getlist('existingFiles')
    
    print(f"/api/wizard/system-requirements called. System: {system_name}, New Files: {len(files)}, Existing Files: {len(existing_files)}")
    
    upload_root = os.path.join(app.root_path, 'uploads', system_name)
    upload_dir = os.path.join(upload_root, 'system-requirements')
    os.makedirs(upload_dir, exist_ok=True)
    
    saved_files = []
    file_contents = ""
    
    # Process new uploads
    for file in files:
        if file.filename:
            filename = werkzeug.utils.secure_filename(file.filename)
            file_path = os.path.join(upload_dir, filename)
            file.save(file_path)
            saved_files.append(filename)
            content = read_upload_file_content(file_path, filename)
            file_contents += f"\n--- File (Uploaded): {filename} ---\n{content}\n"

    # Process existing selected files
    for rel_path in existing_files:
        if '..' in rel_path or rel_path.startswith('/'):
            continue
        file_path = os.path.join(upload_root, rel_path)
        if os.path.exists(file_path):
             filename = os.path.basename(rel_path)
             content = read_upload_file_content(file_path, filename)
             file_contents += f"\n--- File (Existing): {filename} ---\n{content}\n"

    # Compute name_val for prompt template, similar to helper logic
    import re
    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', system_name):
        name_val = f"'{system_name}'"
    else:
        name_val = system_name

    prompt_path = os.path.join(app.root_path, 'prompts', 'system-requirements-prompt.txt')
    try:
        with open(prompt_path, 'r', encoding='utf-8') as f:
            prompt_template = f.read()

        prompt = prompt_template.format(
            name=name_val,
            description=description,
            file_contents=file_contents,
            sysml_code=sysml_code
        )
    except Exception as e:
        print(f"Error loading prompt: {e}")
        return jsonify({"status": "error", "message": f"Error loading prompt: {str(e)}"}), 500

    suggestion = ""
    api_key = os.environ.get("OPENAI_API_KEY") or request.form.get('api_key')
    
    if api_key:
        print("Calling AI for System Requirements Analysis...")
        suggestion = sysmod_api_helpers.clean_ai_response(sysmod_api_helpers.call_ai(prompt, api_key))
    else:
        print("No OpenAI API Key found.")
        suggestion = "AI analysis skipped (API Key missing)."
    
    return jsonify({
        "status": "success",
        "message": f"Processed {len(saved_files) + len(existing_files)} files ({len(saved_files)} new, {len(existing_files)} existing).",
        "files": saved_files,
        "ai_suggestion": suggestion
    })

@app.route('/api/wizard/use-cases', methods=['POST'])
@handle_errors
def api_wizard_use_cases():
    system_name = request.form.get('systemName', 'MySystem')
    description = request.form.get('description', '')
    sysml_code = request.form.get('sysmlCode', '')
    files = request.files.getlist('files')
    existing_files = request.form.getlist('existingFiles')
    
    print(f"/api/wizard/use-cases called. System: {system_name}, New Files: {len(files)}, Existing Files: {len(existing_files)}")
    
    upload_root = os.path.join(app.root_path, 'uploads', system_name)
    upload_dir = os.path.join(upload_root, 'use-cases')
    os.makedirs(upload_dir, exist_ok=True)
    
    saved_files = []
    file_contents = ""
    
    for file in files:
        if file.filename:
            filename = werkzeug.utils.secure_filename(file.filename)
            file_path = os.path.join(upload_dir, filename)
            file.save(file_path)
            saved_files.append(filename)
            content = read_upload_file_content(file_path, filename)
            file_contents += f"\n--- File (Uploaded): {filename} ---\n{content}\n"

    existing_files = request.form.getlist('existingFiles')
    for rel_path in existing_files:
        if '..' in rel_path or rel_path.startswith('/'):
            continue
        file_path = os.path.join(upload_root, rel_path)
        if os.path.exists(file_path):
             filename = os.path.basename(rel_path)
             content = read_upload_file_content(file_path, filename)
             file_contents += f"\n--- File (Existing): {filename} ---\n{content}\n"

    import re
    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', system_name):
        name_val = f"'{system_name}'"
    else:
        name_val = system_name

    prompt_path = os.path.join(app.root_path, 'prompts', 'use-cases-prompt.txt')
    try:
        with open(prompt_path, 'r', encoding='utf-8') as f:
            prompt_template = f.read()

        prompt = prompt_template.format(
            name=name_val,
            name_lower=name_val.lower(),
            description=description,
            file_contents=file_contents,
            sysml_code=sysml_code
        )
    except Exception as e:
        print(f"Error loading prompt: {type(e).__name__}: {e}")
        return jsonify({"status": "error", "message": f"Error loading prompt: {type(e).__name__}: {str(e)}"}), 500

    suggestion = ""
    api_key = os.environ.get("OPENAI_API_KEY") or request.form.get('api_key')
    

    print(f"Use CasePrompt: {prompt}")

    if api_key:
        print("Calling AI for Use Case Analysis...")
        suggestion = sysmod_api_helpers.clean_ai_response(sysmod_api_helpers.call_ai(prompt, api_key))
    else:
        print("No OpenAI API Key found.")
        suggestion = "AI analysis skipped (API Key missing)."
    
    return jsonify({
        "status": "success",
        "message": f"Processed {len(saved_files) + len(existing_files)} files ({len(saved_files)} new, {len(existing_files)} existing).",
        "files": saved_files,
        "ai_suggestion": suggestion
    })

@app.route('/api/wizard/product-arch', methods=['POST'])
@handle_errors
def api_wizard_product_arch():
    system_name = request.form.get('systemName', 'MySystem')
    description = request.form.get('description', '')
    sysml_code = request.form.get('sysmlCode', '')
    files = request.files.getlist('files')
    existing_files = request.form.getlist('existingFiles')
    
    print(f"/api/wizard/product-arch called. System: {system_name}, New Files: {len(files)}, Existing Files: {len(existing_files)}")
    
    upload_root = os.path.join(app.root_path, 'uploads', system_name)
    upload_dir = os.path.join(upload_root, 'product-arch')
    os.makedirs(upload_dir, exist_ok=True)
    
    saved_files = []
    file_contents = ""
    
    # Process new uploads
    for file in files:
        if file.filename:
            filename = werkzeug.utils.secure_filename(file.filename)
            file_path = os.path.join(upload_dir, filename)
            file.save(file_path)
            saved_files.append(filename)
            content = read_upload_file_content(file_path, filename)
            file_contents += f"\n--- File (Uploaded): {filename} ---\n{content}\n"

    # Process existing selected files
    for rel_path in existing_files:
        if '..' in rel_path or rel_path.startswith('/'):
            continue
        file_path = os.path.join(upload_root, rel_path)
        if os.path.exists(file_path):
             filename = os.path.basename(rel_path)
             content = read_upload_file_content(file_path, filename)
             file_contents += f"\n--- File (Existing): {filename} ---\n{content}\n"

    # Compute name_val for prompt template, similar to helper logic
    import re
    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', system_name):
        name_val = f"'{system_name}'"
    else:
        name_val = system_name

    prompt_path = os.path.join(app.root_path, 'prompts', 'product-arch-prompt.txt')
    try:
        with open(prompt_path, 'r', encoding='utf-8') as f:
            prompt_template = f.read()

        prompt = prompt_template.format(
            name=name_val,
            name_val=name_val,
            description=description,
            file_contents=file_contents,
            sysml_code=sysml_code
        )
    except Exception as e:
        print(f"Error loading prompt: {e}")
        return jsonify({"status": "error", "message": f"Error loading prompt: {str(e)}"}), 500

    suggestion = ""
    api_key = os.environ.get("OPENAI_API_KEY") or request.form.get('api_key')
    
    if api_key:
        print("Calling AI for Product Architecture Analysis...")
        suggestion = sysmod_api_helpers.clean_ai_response(sysmod_api_helpers.call_ai(prompt, api_key))
    else:
        print("No OpenAI API Key found.")
        suggestion = "AI analysis skipped (API Key missing)."
    
    return jsonify({
        "status": "success",
        "message": f"Processed {len(saved_files) + len(existing_files)} files ({len(saved_files)} new, {len(existing_files)} existing).",
        "files": saved_files,
        "ai_suggestion": suggestion
    })



if __name__ == '__main__':
    app.run(debug=True)
