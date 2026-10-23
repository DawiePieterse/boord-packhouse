"""Dev entrypoint on PACKHOUSE_PORT (8060), clear of the other Boord apps.
"""
import os

import uvicorn

import config

uvicorn.run("main:app", host="127.0.0.1", port=config.PACKHOUSE_PORT,
            app_dir=os.path.dirname(os.path.abspath(__file__)))
