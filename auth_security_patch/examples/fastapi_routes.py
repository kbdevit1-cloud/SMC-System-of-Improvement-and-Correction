"""Exemplo opcional para projetos com FastAPI.

Use as funções do AuthService no backend. Nunca confie apenas no JavaScript.
"""

from pathlib import Path
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from security.auth_service import AuthService

app = FastAPI()
auth = AuthService(Path("data/app.db"))


class LoginPayload(BaseModel):
    usuario: str


class RequestAccessPayload(BaseModel):
    nome: str
    usuario: str
    setor: str | None = None
    observacao: str | None = None


@app.post("/api/auth/login")
def login(payload: LoginPayload):
    return auth.login(usuario=payload.usuario)


@app.post("/api/auth/request-access")
def request_access(payload: RequestAccessPayload):
    return auth.request_access(
        nome=payload.nome,
        usuario=payload.usuario,
        setor=payload.setor,
        observacao=payload.observacao,
    )


@app.get("/api/auth/me")
def me(authorization: str | None = Header(default=None)):
    token = (authorization or "").replace("Bearer ", "", 1)
    result = auth.get_current_user(token)
    if not result.get("ok"):
        raise HTTPException(status_code=401, detail=result.get("message"))
    return result


@app.get("/api/protegido/dashboard")
def dashboard(authorization: str | None = Header(default=None)):
    token = (authorization or "").replace("Bearer ", "", 1)
    current = auth.get_current_user(token)
    if not current.get("ok"):
        raise HTTPException(status_code=401, detail="Acesso negado")
    return {"ok": True, "data": "dados protegidos"}
