from starr_studio.config_sections import _with_library_defaults, with_library_default

TEXT = """\
libraries:
  Movies:
    collection_files:
      - default: basic
    overlay_files:
      - default: resolution
        template_variables:
          horizontal_align: center
"""


def test_with_library_defaults_updates_several_entries_in_one_pass():
    result = _with_library_defaults(
        TEXT,
        "Movies",
        "overlay_files",
        [
            ("resolution", {"horizontal_align": "left", "vertical_align": "top"}),
            ("ribbon", {"horizontal_offset": 10}),
        ],
    )
    assert "default: ribbon" in result
    assert "horizontal_align: left" in result
    assert "horizontal_offset: 10" in result