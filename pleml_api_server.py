#
#   PLEML API Server - Feature Endpoints
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

from flask import Blueprint, Flask, request, jsonify
import traceback
import requests
from requests.exceptions import ReadTimeout, ConnectTimeout, ConnectionError
from functools import wraps
from werkzeug.exceptions import HTTPException

import pleml_api_helpers

# ---------------------------------------------------------------------------
# Blueprint
# ---------------------------------------------------------------------------
pleml_blueprint = Blueprint('pleml', __name__)

# ---------------------------------------------------------------------------
# Shared cache reference – will be set by the host application via
# init_pleml_cache() so both servers can share the same dict object.
# ---------------------------------------------------------------------------
_cache = {}

def init_pleml_cache(shared_cache: dict):
    """Call this once from the host app to share its cache with this module."""
    global _cache
    _cache = shared_cache


# ---------------------------------------------------------------------------
# Error decorator (local copy so this file is self-contained)
# ---------------------------------------------------------------------------
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
            return jsonify({"error": "The upstream SysML server returned an error."}), 502
        except HTTPException:
            raise
        except Exception as e:
            traceback.print_exc()
            return jsonify({"error": "An internal server error occurred."}), 500
    return wrapper


# ---------------------------------------------------------------------------
# /api/feature endpoints
# ---------------------------------------------------------------------------

#
# Get Feature Bindings
#
@pleml_blueprint.route('/api/feature-bindings', methods=['POST'])
@handle_errors
def api_feature_bindings():
    input_data = request.json
    server_url = input_data.get('server_url')
    project_id = input_data.get('project_id')
    commit_id = input_data.get('commit_id')

    if not all([server_url, project_id, commit_id]):
        raise ValueError("Required parameters missing.")

    bindings = pleml_api_helpers.get_feature_bindings(server_url, project_id, commit_id)
    return jsonify(bindings)

#
# Toggle Feature Binding (Create/Delete)
#
@pleml_blueprint.route('/api/feature-bindings/toggle', methods=['POST'])
@handle_errors
def api_feature_bindings_toggle():
    return jsonify({"error": "Feature binding writes are not implemented."}), 501

#
# Get Feature Tree (UVL format)
#
@pleml_blueprint.route('/api/feature-tree-uvl', methods=['POST'])
@handle_errors
def api_feature_tree_uvl():
    data = request.json
    server_url = data.get('server_url')
    project_id = data.get('project_id')
    commit_id = data.get('commit_id')
    sysmod_project_id = data.get('sysmod_project_id')

    cache_key = ('FEATURETREEUVL', server_url, project_id, commit_id, sysmod_project_id)
    if cache_key in _cache:
        return jsonify(_cache[cache_key])

    if not all([server_url, project_id, commit_id, sysmod_project_id]):
        return jsonify({"error": "Missing parameters"}), 400

    result = pleml_api_helpers.get_feature_tree_uvl(server_url, project_id, commit_id, sysmod_project_id)
    _cache[cache_key] = result
    if result:
        return jsonify(result)
    else:
        return None

#
# Get Feature Tree (SysML / matrix format)
#
@pleml_blueprint.route('/api/feature-tree-sysml', methods=['POST'])
def api_feature_tree_sysml():
    return jsonify({"error": "Feature tree matrix is not implemented."}), 501


#
# Check if the project contains a PLEML feature model
#
@pleml_blueprint.route('/api/check-pleml', methods=['POST'])
def api_check_pleml():
    data = request.json
    server_url = data.get('server_url')
    project_id = data.get('project_id')
    commit_id = data.get('commit_id')

    cache_key = ('CHECKPLEML', server_url, project_id, commit_id)
    if cache_key in _cache:
        return jsonify(_cache[cache_key])

    if not all([server_url, project_id, commit_id]):
        return jsonify({"error": "Missing parameters"}), 400

    result = pleml_api_helpers.check_pleml(server_url, project_id, commit_id)
    _cache[cache_key] = result

    if result:
        return jsonify(result)
    else:
        return None


# ---------------------------------------------------------------------------
# Stand-alone entry point (run this file directly for a PLeML-only server)
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    app = Flask(__name__)
    app.config['JSONIFY_PRETTYPRINT_REGULAR'] = True
    app.config['JSONIFY_MIMETYPE'] = 'application/json'
    app.register_blueprint(pleml_blueprint)
    app.run(debug=False, port=5001)
