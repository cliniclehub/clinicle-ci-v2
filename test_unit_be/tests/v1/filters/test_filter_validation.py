"""Unit tests for FilterService._validate_filter_structure."""

from app.v1.filters.services import SavedFilterService


def test_valid_filter_structure_passes():
    config = {
        "groupLogic": "AND",
        "groups": [
            {
                "logic": "OR",
                "conditions": [
                    {"field": "status", "operator": "eq", "value": "active"}
                ],
            }
        ],
    }
    assert SavedFilterService._validate_filter_structure(config) is True


def test_missing_groups_key_returns_false():
    config = {"groupLogic": "AND"}
    assert SavedFilterService._validate_filter_structure(config) is False


def test_missing_group_logic_key_returns_false():
    config = {"groups": []}
    assert SavedFilterService._validate_filter_structure(config) is False


def test_invalid_group_logic_value_returns_false():
    config = {"groupLogic": "NAND", "groups": []}
    assert SavedFilterService._validate_filter_structure(config) is False


def test_groups_not_list_returns_false():
    config = {"groupLogic": "AND", "groups": "notalist"}
    assert SavedFilterService._validate_filter_structure(config) is False


def test_group_missing_conditions_returns_false():
    config = {"groupLogic": "AND", "groups": [{"logic": "OR"}]}
    assert SavedFilterService._validate_filter_structure(config) is False


def test_group_missing_logic_returns_false():
    config = {"groupLogic": "AND", "groups": [{"conditions": []}]}
    assert SavedFilterService._validate_filter_structure(config) is False


def test_group_invalid_logic_returns_false():
    config = {
        "groupLogic": "AND",
        "groups": [{"logic": "XOR", "conditions": []}],
    }
    assert SavedFilterService._validate_filter_structure(config) is False


def test_condition_missing_required_key_returns_false():
    config = {
        "groupLogic": "AND",
        "groups": [
            {
                "logic": "AND",
                "conditions": [{"field": "status", "operator": "eq"}],
            }
        ],
    }
    assert SavedFilterService._validate_filter_structure(config) is False


def test_non_dict_input_returns_false():
    assert SavedFilterService._validate_filter_structure("notadict") is False
    assert SavedFilterService._validate_filter_structure(None) is False
    assert SavedFilterService._validate_filter_structure([]) is False


def test_empty_groups_list_is_valid():
    config = {"groupLogic": "OR", "groups": []}
    assert SavedFilterService._validate_filter_structure(config) is True
