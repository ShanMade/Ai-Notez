"""Keep test runs isolated from any real backend/data directory.

The settings module reads NOTEZ_DATA_DIR at import time, so it must be set before
the app modules are imported. Setting it here (before test collection) guarantees that.
"""
import os
import tempfile

os.environ.setdefault("NOTEZ_DATA_DIR", tempfile.mkdtemp(prefix="notez-test-data-"))
