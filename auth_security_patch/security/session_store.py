from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import secrets
import threading
from typing import Any


@dataclass
class SessionData:
    token: str
    email: str
    nome: str | None
    perfil: str
    setor: str | None
    status: str
    created_at: datetime
    expires_at: datetime
    maquina: str | None = None
    ip: str | None = None

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "token": self.token,
            "email": self.email,
            "nome": self.nome,
            "perfil": self.perfil,
            "setor": self.setor,
            "status": self.status,
            "created_at": self.created_at.isoformat(),
            "expires_at": self.expires_at.isoformat(),
            "maquina": self.maquina,
            "ip": self.ip,
        }


class SessionStore:
    """Sessões em memória, leves e com expiração.

    Para app desktop/pywebview, isso evita persistir token sensível em arquivo.
    No frontend, guarde o token apenas em sessionStorage e limpe no logout.
    """

    def __init__(self, ttl_minutes: int = 480) -> None:
        self.ttl_minutes = ttl_minutes
        self._sessions: dict[str, SessionData] = {}
        self._lock = threading.RLock()

    def create(
        self,
        *,
        email: str,
        nome: str | None,
        perfil: str,
        setor: str | None,
        status: str,
        maquina: str | None = None,
        ip: str | None = None,
    ) -> SessionData:
        now = datetime.now(timezone.utc)
        token = secrets.token_urlsafe(32)
        session = SessionData(
            token=token,
            email=email,
            nome=nome,
            perfil=perfil,
            setor=setor,
            status=status,
            created_at=now,
            expires_at=now + timedelta(minutes=self.ttl_minutes),
            maquina=maquina,
            ip=ip,
        )
        with self._lock:
            self._sessions[token] = session
        return session

    def get(self, token: str | None) -> SessionData | None:
        if not token:
            return None
        with self._lock:
            session = self._sessions.get(token)
            if not session:
                return None
            if session.expires_at <= datetime.now(timezone.utc):
                self._sessions.pop(token, None)
                return None
            return session

    def validate(self, token: str | None) -> bool:
        return self.get(token) is not None

    def revoke(self, token: str | None) -> SessionData | None:
        if not token:
            return None
        with self._lock:
            return self._sessions.pop(token, None)

    def cleanup_expired(self) -> int:
        now = datetime.now(timezone.utc)
        removed = 0
        with self._lock:
            expired = [token for token, session in self._sessions.items() if session.expires_at <= now]
            for token in expired:
                self._sessions.pop(token, None)
                removed += 1
        return removed
