from __future__ import annotations

import csv
import json
import smtplib
from zipfile import BadZipFile

import httpx
import requests
from gtts.tts import gTTSError
from langchain_core.exceptions import OutputParserException
from openpyxl.utils.exceptions import InvalidFileException
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

JSON_PARSE_ERRORS = (json.JSONDecodeError, TypeError, ValueError)
DATA_COERCION_ERRORS = (TypeError, ValueError)
RECORD_MAPPING_ERRORS = (KeyError, TypeError, ValueError)
HTTP_JSON_ERRORS = (
    requests.RequestException,
    ValueError,
    KeyError,
    IndexError,
    TypeError,
)
SQLALCHEMY_ERRORS = (SQLAlchemyError,)

LLM_PROVIDER_ERRORS = (
    httpx.HTTPError,
    requests.RequestException,
    ImportError,
    OSError,
    RuntimeError,
    ValueError,
)
QUIZ_LLM_ERRORS = (
    OSError,
    RuntimeError,
    ValueError,
    OutputParserException,
    ValidationError,
)
AGENT_PLAN_ERRORS = (
    RuntimeError,
    ValueError,
    json.JSONDecodeError,
)
AGENT_JOB_ERRORS = (
    SQLAlchemyError,
    KeyError,
    TypeError,
    ValueError,
)

HTML_PARSE_ERRORS = (AssertionError, ValueError)
DATE_PARSE_ERRORS = (TypeError, ValueError, IndexError, OverflowError)
PAGE_IMAGE_ERRORS = (
    requests.RequestException,
    AssertionError,
    ValueError,
)
FEED_FETCH_ERRORS = (
    requests.RequestException,
    ValueError,
)
ARTICLE_REFRESH_ERRORS = (
    requests.RequestException,
    SQLAlchemyError,
    ValueError,
    OSError,
)
ARTICLE_REFRESH_JOB_ERRORS = (
    SQLAlchemyError,
    RuntimeError,
    ValueError,
)

FILE_IMPORT_ERRORS = (
    csv.Error,
    UnicodeError,
    OSError,
    BadZipFile,
    InvalidFileException,
    ValueError,
)
EMAIL_SEND_ERRORS = (OSError, smtplib.SMTPException)
GTTS_ERRORS = (gTTSError, OSError, ValueError)
GOOGLE_AVATAR_SYNC_ERRORS = (
    httpx.HTTPError,
    ValueError,
    KeyError,
    TypeError,
)
ROLEPLAY_RUNTIME_ERRORS = (
    requests.RequestException,
    SQLAlchemyError,
    OSError,
    RuntimeError,
    ValueError,
    KeyError,
    IndexError,
    TypeError,
)
ROLEPLAY_CONTEXT_ERRORS = (
    SQLAlchemyError,
    TypeError,
    ValueError,
)
