from pydantic import BaseModel


class SlangIn(BaseModel):
    word: str
    korean: str = ""
