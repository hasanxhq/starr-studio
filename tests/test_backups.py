"""Unit tests for starr_studio.backups (prune and manifest)."""

from starr_studio.backups import KEEP, list_backups, take_backup


def test_prune_leaves_the_newest_folders(tmp_path):
    root = tmp_path / "backups"
    base = tmp_path / "config"
    base.mkdir()
    (base / "a.yml").write_text("a\n")
    for n in range(KEEP + 2):
        take_backup(root, base, [base / "a.yml"], f"backup {n}")
    assert len(list_backups(root)) == KEEP