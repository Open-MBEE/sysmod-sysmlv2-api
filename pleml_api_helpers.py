#
#   PLEML API Helpers
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

import mbse4u_sysmlv2_api_helpers as mbse4u_sysmlv2


# ---------------------------------------------------------------------------
# Feature Tree
# ---------------------------------------------------------------------------

def get_feature_tree_uvl(server_url, project_id, commit_id, sysmod_project_id):
    """
    Retrieves the textual UVL representation of the Feature Tree.
    """
    print("Getting UVL feature tree")
    id_map = mbse4u_sysmlv2.get_metadata_ids_by_name(server_url, project_id, commit_id, ['featureTree'])
    ft_id = id_map.get('featureTree')

    if not ft_id:
        return {"error": "Metadata 'featureTree' not found"}

    usage_map = mbse4u_sysmlv2.get_metadatausage_annotatedElement_ids(server_url, project_id, commit_id, {'featureTree': ft_id})
    annotated_ids = usage_map.get('featureTree', [])

    if not annotated_ids:
        return {"error": "No elements annotated with @featureTree found"}

    annotated_id = annotated_ids[0]

    # Get contained TextualRepresentation
    text_reps = mbse4u_sysmlv2.get_contained_elements(server_url, project_id, commit_id, annotated_id, 'TextualRepresentation')
    print(f"get_contained_elements: {len(text_reps)} matching elements found in 'TextualRepresentation'")
    if text_reps:
        return {"uvl_code": text_reps[0].get('body', '')}

    return {"uvl_code": "// No textual representation found."}


def check_pleml(server_url, project_id, commit_id):
    """
    Checks whether the SysML model contains a PLEML feature model
    (i.e. at least one element annotated with @featureTree).
    Returns a dict with key 'has_pleml' (bool) and optional details.
    """
    print(f"check_pleml called for project {project_id} / commit {commit_id}")
    id_map = mbse4u_sysmlv2.get_metadata_ids_by_name(server_url, project_id, commit_id, ['featureTree'])
    ft_id = id_map.get('featureTree')

    if not ft_id:
        return {"has_pleml": False, "reason": "Metadata definition 'featureTree' not found in model"}

    usage_map = mbse4u_sysmlv2.get_metadatausage_annotatedElement_ids(server_url, project_id, commit_id, {'featureTree': ft_id})
    annotated_ids = usage_map.get('featureTree', [])

    if not annotated_ids:
        return {"has_pleml": False, "reason": "No elements annotated with @featureTree found"}

    return {"has_pleml": True, "feature_tree_count": len(annotated_ids)}


# ---------------------------------------------------------------------------
# Feature Bindings
# ---------------------------------------------------------------------------

def get_feature_bindings_container(server_url, project_id, commit_id):
    """
    Retrieves the container for dependency relationships annotated with @featureBindings.
    """
    fb_metadata_id_map = mbse4u_sysmlv2.get_metadata_ids_by_name(server_url, project_id, commit_id, ['featureBindings'])
    print(f"# elements found: {len(fb_metadata_id_map)}: {fb_metadata_id_map}")
    fb_id = fb_metadata_id_map.get('featureBindings')

    if not fb_id:
        print("MetadataDefinition 'featureBindings' not found.")
        return []

    annotated_ids_map = mbse4u_sysmlv2.get_metadatausage_annotatedElement_ids(server_url, project_id, commit_id, {'featureBindings': fb_id})
    annotated_ids = annotated_ids_map.get('featureBindings', [])

    if not annotated_ids:
        print("No elements annotated with @featureBindings found.")
        return []

    return annotated_ids


def get_feature_bindings(server_url, project_id, commit_id):
    """
    Retrieves dependency relationships annotated with @FB.
    """
    query_url = mbse4u_sysmlv2.get_commit_url(server_url, project_id, commit_id)

    # 1. Find ID of MetadataDefinition "FB"
    fb_metadata_id_map = mbse4u_sysmlv2.get_metadata_ids_by_name(server_url, project_id, commit_id, ['FB'])
    print(f"# elements found: {len(fb_metadata_id_map)}: {fb_metadata_id_map}")
    fb_id = fb_metadata_id_map.get('FB')

    if not fb_id:
        print("MetadataDefinition 'FB' not found.")
        return []

    # 2. Find elements annotated with @FB
    annotated_ids_map = mbse4u_sysmlv2.get_metadatausage_annotatedElement_ids(server_url, project_id, commit_id, {'FB': fb_id})
    annotated_ids = annotated_ids_map.get('FB', [])

    if not annotated_ids:
        print("No elements annotated with @FB found.")
        return []

    bindings = []

    # 3. Process each annotated element
    for element_id in annotated_ids:
        element = mbse4u_sysmlv2.get_element_fromAPI(query_url, element_id)
        if not element:
            continue

        # Owner should be a dependency
        owner = element.get('owner')
        if not owner:
            continue
        feature_binding = mbse4u_sysmlv2.get_element_fromAPI(query_url, owner['@id'])
        if not feature_binding:
            continue

        entry = {
            'id': feature_binding.get('@id'),
            'type': feature_binding.get('@type'),
            'client': '',
            'supplier': ''
        }

        if feature_binding.get('client'):
            client_ref = feature_binding.get('client')[0]
            client_el = mbse4u_sysmlv2.get_element_fromAPI(query_url, client_ref['@id'])
            if client_el:
                entry['client'] = {'name': client_el.get('name') or client_el.get('declaredName') or "Unknown", 'id': client_el.get('@id')}

        if feature_binding.get('supplier'):
            supplier_ref = feature_binding.get('supplier')[0]
            supplier_el = mbse4u_sysmlv2.get_element_fromAPI(query_url, supplier_ref['@id'])
            if supplier_el:
                entry['supplier'] = {'name': supplier_el.get('name') or supplier_el.get('declaredName') or "Unknown", 'id': supplier_el.get('@id')}

        bindings.append(entry)

    return bindings


def create_feature_binding(server_url, project_id, commit_id, client_id, supplier_id):
    """
    Creates a new Dependency from client_id to supplier_id and annotates it with @FB.
    """
    print(f"Creating Feature Binding between {client_id} and {supplier_id}")

    feature_bindings_containers = get_feature_bindings_container(server_url, project_id, commit_id)
    if not feature_bindings_containers:
        print("Error: Feature Bindings Container not found.")
        return None
    feature_bindings_container_id = feature_bindings_containers[0]
    print(f"Feature Bindings Container ID: {feature_bindings_container_id}")

    # Implementation pending valid WRITE access pattern.
    return None


def delete_feature_binding(server_url, project_id, commit_id, binding_id):
    """
    Deletes the feature binding with the given ID.
    Returns True on success, False otherwise.
    """
    print(f"Deleting Feature Binding {binding_id}")
    # Implementation pending valid WRITE access pattern.
    return False
