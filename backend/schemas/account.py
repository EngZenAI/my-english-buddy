from pydantic import BaseModel


class AccountPasswordIn(BaseModel):
    current_password: str = ""
    new_password: str
