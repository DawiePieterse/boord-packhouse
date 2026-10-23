"""Alembic environment for Boord Packhouse - Boord's env.py, trimmed.

- The database is db.packhouse_engine (or the `connectable` migrate.py and
  the tests pass in), not a URL in alembic.ini.
- render_as_batch=True, because SQLite cannot ALTER or DROP a column in
  place. Write migrations with `with op.batch_alter_table(...) as batch_op:`.
"""
import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlmodel import SQLModel

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import models  # noqa: E402,F401 - registers every table on the metadata
from db import packhouse_engine  # noqa: E402

config = context.config

# migrate.py sets this to False: inside the server, fileConfig() would replace
# uvicorn's logging and the app would go quiet.
if config.attributes.get("configure_logger", True) and config.config_file_name is not None:
    fileConfig(config.config_file_name)

connectable = config.attributes.get("connectable") or packhouse_engine
with connectable.connect() as connection:
    context.configure(
        connection=connection,
        target_metadata=SQLModel.metadata,
        render_as_batch=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()
