from io import BytesIO
from pathlib import Path
import pytest
from flask import Flask
from unittest.mock import patch
from sysmod_api_server import app, get_upload_root, resolve_existing_upload, sysmod_cache_key
import pleml_api_server

TEST_SERVER_URL = "http://localhost:9000"
TEST_PROJECT_ID = "test-project"
TEST_COMMIT_ID = "test-commit"

@pytest.fixture
def client():
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client

@pytest.fixture(autouse=True)
def clear_pleml_cache():
    """Clear the PLEML shared cache before each test."""
    pleml_api_server._cache.clear()


def test_check_pleml_success(client):
    """Test the /api/check-pleml endpoint with successful PLEML detection."""
    with patch('pleml_api_helpers.check_pleml') as mock_check:
        mock_check.return_value = {"has_pleml": True, "feature_tree_count": 1}

        response = client.post('/api/check-pleml', json={
            "server_url": TEST_SERVER_URL,
            "project_id": TEST_PROJECT_ID,
            "commit_id": TEST_COMMIT_ID
        })

        assert response.status_code == 200
        data = response.get_json()
        assert data == {"has_pleml": True, "feature_tree_count": 1}

def test_check_pleml_no_pleml(client):
    """Test the /api/check-pleml endpoint when no PLEML is found."""
    with patch('pleml_api_helpers.check_pleml') as mock_check:
        mock_check.return_value = {"has_pleml": False, "reason": "No elements annotated with @featureTree found"}

        response = client.post('/api/check-pleml', json={
            "server_url": TEST_SERVER_URL,
            "project_id": TEST_PROJECT_ID,
            "commit_id": TEST_COMMIT_ID
        })

        assert response.status_code == 200
        data = response.get_json()
        assert data == {"has_pleml": False, "reason": "No elements annotated with @featureTree found"}

def test_check_pleml_missing_params(client):
    """Test the /api/check-pleml endpoint with missing parameters."""
    response = client.post('/api/check-pleml', json={
        "server_url": TEST_SERVER_URL,
        "project_id": TEST_PROJECT_ID,
        # missing commit_id
    })

    assert response.status_code == 400
    data = response.get_json()
    assert "error" in data
    assert "Missing parameters" in data["error"]

def test_check_pleml_cached(client):
    """Test that /api/check-pleml uses cache when available."""
    with patch('pleml_api_helpers.check_pleml') as mock_check:
        mock_check.return_value = {"has_pleml": True}

        response1 = client.post('/api/check-pleml', json={
            "server_url": TEST_SERVER_URL,
            "project_id": TEST_PROJECT_ID,
            "commit_id": TEST_COMMIT_ID
        })
        assert response1.status_code == 200

        response2 = client.post('/api/check-pleml', json={
            "server_url": TEST_SERVER_URL,
            "project_id": TEST_PROJECT_ID,
            "commit_id": TEST_COMMIT_ID
        })

        assert response2.status_code == 200
        mock_check.assert_called_once()


def test_sysmod_atlas_light_check(client):
    with patch('mbse4u_sysmlv2_helpers.get_commit_url', return_value='http://localhost:9000/commit'), \
         patch('mbse4u_sysmlv2_helpers.get_contained_elements', return_value=[]), \
         patch('mbse4u_sysmlv2_helpers.get_elements_byKind_fromAPI', return_value=[]), \
         patch('mbse4u_sysmlv2_helpers.find_elements_specializing', return_value=[]):
        response = client.post('/api/sysmod-atlas', json={
            "server_url": TEST_SERVER_URL,
            "project_id": TEST_PROJECT_ID,
            "commit_id": TEST_COMMIT_ID,
            "sysmod_project_id": "test-sysmod-project",
            "loadAll": False,
        })

    assert response.status_code == 200
    assert response.get_json()["PROBLEMSTATEMENT"] is False


def test_check_pleml_cache_is_scoped_to_project(client):
    with patch('pleml_api_helpers.check_pleml', side_effect=[
        {"has_pleml": True}, {"has_pleml": False}
    ]) as mock_check:
        first = client.post('/api/check-pleml', json={
            "server_url": TEST_SERVER_URL,
            "project_id": "project-one",
            "commit_id": TEST_COMMIT_ID,
        })
        second = client.post('/api/check-pleml', json={
            "server_url": TEST_SERVER_URL,
            "project_id": "project-two",
            "commit_id": TEST_COMMIT_ID,
        })

    assert first.get_json()["has_pleml"] is True
    assert second.get_json()["has_pleml"] is False
    assert mock_check.call_count == 2


def test_sysmod_cache_key_contains_model_context():
    first = sysmod_cache_key('PROBLEMSTATEMENT', TEST_SERVER_URL, 'project-one', TEST_COMMIT_ID, 'model')
    second = sysmod_cache_key('PROBLEMSTATEMENT', TEST_SERVER_URL, 'project-two', TEST_COMMIT_ID, 'model')

    assert first != second


def test_standalone_pleml_cache_is_scoped_to_project(monkeypatch):
    isolated_cache = {}
    monkeypatch.setattr(pleml_api_server, '_cache', isolated_cache)
    standalone_app = Flask(__name__)
    standalone_app.register_blueprint(pleml_api_server.pleml_blueprint)

    with patch('pleml_api_helpers.check_pleml', side_effect=[
        {"has_pleml": True}, {"has_pleml": False}
    ]) as mock_check:
        client = standalone_app.test_client()
        first = client.post('/api/check-pleml', json={
            "server_url": TEST_SERVER_URL,
            "project_id": "project-one",
            "commit_id": TEST_COMMIT_ID,
        })
        second = client.post('/api/check-pleml', json={
            "server_url": TEST_SERVER_URL,
            "project_id": "project-two",
            "commit_id": TEST_COMMIT_ID,
        })

    assert first.get_json()["has_pleml"] is True
    assert second.get_json()["has_pleml"] is False
    assert mock_check.call_count == 2


def test_rejects_unallowlisted_sysml_server(client):
    with patch('mbse4u_sysmlv2_helpers.get_projects') as mock_get_projects:
        response = client.post('/api/projects', json={
            "server_url": "http://example.invalid"
        })

    assert response.status_code == 400
    mock_get_projects.assert_not_called()


def test_rejects_unallowlisted_sysml_server_port(client):
    with patch('mbse4u_sysmlv2_helpers.get_projects') as mock_get_projects:
        response = client.post('/api/projects', json={
            "server_url": "http://localhost:9001"
        })

    assert response.status_code == 400
    mock_get_projects.assert_not_called()


def test_existing_upload_path_cannot_escape_system_root(tmp_path):
    upload_root = tmp_path / 'uploads' / 'system'
    upload_root.mkdir(parents=True)
    outside_file = tmp_path / 'outside.txt'
    outside_file.write_text('not an upload', encoding='utf-8')

    assert resolve_existing_upload(upload_root, str(outside_file)) is None


def test_system_upload_root_stays_inside_upload_directory():
    upload_root = get_upload_root('../../outside')

    assert upload_root.parent == (Path(app.root_path) / 'uploads').resolve()


def test_wizard_rejects_unsupported_upload_type(client):
    response = client.post('/api/wizard/brownfield', data={
        'systemName': 'TestSystem',
        'files': (BytesIO(b'not an allowed document'), 'payload.exe'),
    }, content_type='multipart/form-data')

    assert response.status_code == 400


def test_feature_tree_matrix_reports_unimplemented(client):
    response = client.post('/api/feature-tree-sysml', json={})

    assert response.status_code == 501


def test_feature_binding_write_reports_unimplemented(client):
    response = client.post('/api/feature-bindings/toggle', json={})

    assert response.status_code == 501
