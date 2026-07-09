from typing import Literal

from pydantic import BaseModel


class AccountPasswordIn(BaseModel):
    current_password: str = ""
    new_password: str


class AccountIconIn(BaseModel):
    buddy_icon: Literal["classic", "cat"]
