from pydantic import BaseModel


class SaveWordIn(BaseModel):
    word: str
    korean: str = ""
    korean_detail: str = ""
    english_def: str = ""
    example: str = ""
    tag: str = ""
    slang_def: str = ""


class UpdateWordIn(BaseModel):
    korean_detail: str = ""
    english_def: str = ""
    example: str = ""
    tag: str = ""
    next_review: str = ""


class BulkUpdateItem(BaseModel):
    id: int
    word: str = ""
    korean: str = ""
    korean_detail: str = ""
    english_def: str = ""
    example: str = ""
    tag: str = ""
    next_review: str = ""


class BulkUpdateIn(BaseModel):
    items: list[BulkUpdateItem]


class IdsIn(BaseModel):
    ids: list[int]


class ImportItem(BaseModel):
    word: str
    korean: str = ""
    korean_detail: str = ""
    example: str = ""
    tag: str = ""


class ImportCommitIn(BaseModel):
    items: list[ImportItem]
    overwrite: bool = False


class LabelIn(BaseModel):
    name: str


class RenameLabelIn(BaseModel):
    old_name: str
    new_name: str
