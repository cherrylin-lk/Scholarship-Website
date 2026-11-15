import logging
import os
from .app import Application
from .repository import DynamoRepository
from .storage import S3Storage

logging.getLogger().setLevel(logging.INFO)
_app = None


def lambda_handler(event, context):
    global _app
    if _app is None:
        _app = Application(DynamoRepository(), os.environ['COGNITO_ISSUER'], os.environ['COGNITO_CLIENT_ID'], S3Storage())
    return _app.handle(event, context)
