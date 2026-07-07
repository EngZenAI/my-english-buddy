from pydantic import BaseModel


class MediaTranscriptIn(BaseModel):
    url: str
    language: str = "en"


class TranscriptParseIn(BaseModel):
    text: str
    title: str = ""
