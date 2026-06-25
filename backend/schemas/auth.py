from pydantic import BaseModel


class PasswordResetRequest(BaseModel):
    email: str


class PasswordResetVerify(BaseModel):
    email: str
    code: str


class PasswordResetConfirm(BaseModel):
    email: str
    code: str
    password: str
