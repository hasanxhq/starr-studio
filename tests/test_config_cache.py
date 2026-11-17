from unittest.mock import patch

import pytest

from starr_studio import ready_made
from starr_studio.kometa_files import _yaml as config_yaml
from tests.test_config_read import CONFIG, kometa, reader


def test_config_read_parses_each_file_once(kometa):
    parses = 0

    def counting_parse(text: str):
        nonlocal parses
        parses += 1
        return config_yaml().load(text)

    with patch("starr_studio.kometa_files._parse_yaml_text", side_effect=counting_parse):
        r = reader(kometa)
        r.read()
        after_first = parses
        r.read()
    assert after_first >= 5
    assert parses == after_first


def test_config_read_sees_file_changes(kometa):
    path = kometa / "config" / "config.yml"
    path.write_text(CONFIG)
    assert reader(kometa).read().libraries[0].settings["remove_overlays"] is False
    path.write_text(CONFIG.replace("remove_overlays: false", "remove_overlays: true"))
    assert reader(kometa).read().libraries[0].settings["remove_overlays"] is True


def test_config_read_mutation_does_not_affect_next_read(kometa):
    first = reader(kometa).read()
    first.libraries[0].template_variables["injected"] = True
    first.libraries[0].collection_files[0].files[0].collections.append({"name": "nope"})
    second = reader(kometa).read()
    assert "injected" not in second.libraries[0].template_variables
    assert not any(c.get("name") == "nope" for c in second.libraries[0].collection_files[0].files[0].collections)


def test_ready_made_categories_parse_defaults_once():
    from tests.test_ready_made import FIXTURES_ROOT

    parses = 0
    yaml = ready_made._yaml()
    real_load = yaml.load

    def counting_load(stream):
        nonlocal parses
        parses += 1
        return real_load(stream)

    ready_made._categories_cached.cache_clear()
    with patch("starr_studio.ready_made._yaml", lambda: yaml):
        with patch.object(yaml, "load", counting_load):
            ready_made.categories(FIXTURES_ROOT, "movie")
            first = parses
            ready_made.categories(FIXTURES_ROOT, "movie")
    assert first > 0
    assert parses == first