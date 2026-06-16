from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import argparse
import json
import re
import socket
import sqlite3
from pathlib import Path
from typing import Any, Iterable

from .session_store import SessionStore, SessionData

CORPORATE_DOMAIN = "@globaleletronics.ind.br"
STATUS_VALUES = {"pendente", "aprovado", "bloqueado"}
PROFILE_VALUES = {"master", "admin", "engenharia", "producao", "visualizador"}
ADMIN_PROFILES = {"master", "admin"}
LOCAL_PART_PATTERN = re.compile(r"^[a-z0-9._-]{2,80}$")

MSG_INVALID_DOMAIN = "Acesso bloqueado. Use apenas e-mail corporativo @globaleletronics.ind.br."
MSG_PENDING = "Usuário pendente de aprovação. Solicite liberação ao administrador."
MSG_BLOCKED = "Usuário bloqueado. Entre em contato com o administrador."
MSG_APPROVED = "Acesso liberado."
MSG_REQUEST_SENT = "Solicitação enviada. Aguarde aprovação do administrador."
MSG_NOT_REGISTERED = "E-mail corporativo não cadastrado. Clique em Solicitar acesso."


@dataclass(frozen=True)
class NormalizedEmail:
    ok: bool
    email: str | None = None
    usuario: str | None = None
    error: str | None = None
    typed_domain: str | None = None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def default_machine_name() -> str:
    try:
        return socket.gethostname()
    except Exception:
        return "desconhecida"


def normalize_corporate_user(raw_value: str | None) -> NormalizedEmail:
    """Normaliza entrada da tela.

    Regras:
    - A interface deve pedir apenas o usuário, ex.: joao.silva.
    - Se o usuário digitar o domínio corporativo por engano, aceitamos e removemos o domínio.
    - Se digitar qualquer outro domínio, bloqueamos. Não transformamos gmail/hotmail em corporativo.
    """
    value = (raw_value or "").strip().lower()
    value = re.sub(r"\s+", "", value)

    if not value:
        return NormalizedEmail(ok=False, error="Informe seu usuário corporativo.")

    if "@" in value:
        local, sep, domain = value.partition("@")
        typed_domain = sep + domain if sep else None
        if typed_domain != CORPORATE_DOMAIN:
            return NormalizedEmail(
                ok=False,
                error=MSG_INVALID_DOMAIN,
                typed_domain=typed_domain,
            )
        value = local

    if not LOCAL_PART_PATTERN.fullmatch(value):
        return NormalizedEmail(
            ok=False,
            error="Usuário corporativo inválido. Use apenas letras, números, ponto, hífen ou underline.",
        )

    return NormalizedEmail(ok=True, usuario=value, email=f"{value}{CORPORATE_DOMAIN}")


def normalize_full_email(email: str | None) -> str:
    value = (email or "").strip().lower()
    value = re.sub(r"\s+", "", value)
    return value


def is_corporate_email(email: str | None) -> bool:
    value = normalize_full_email(email)
    if not value.endswith(CORPORATE_DOMAIN):
        return False
    local = value[: -len(CORPORATE_DOMAIN)]
    return bool(LOCAL_PART_PATTERN.fullmatch(local))


class AuthError(Exception):
    pass


class PermissionDenied(AuthError):
    pass


class AuthService:
    """Serviço principal de autenticação, autorização e auditoria.

    Uso recomendado em app desktop pywebview:
        auth = AuthService("data/app.db")
        window = webview.create_window("Sistema", "index.html", js_api=auth)

    Todas as funções retornam dict serializável para funcionar direto no pywebview.
    """

    def __init__(self, db_path: str | Path, session_ttl_minutes: int = 480) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.sessions = SessionStore(ttl_minutes=session_ttl_minutes)
        self.init_db()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        return conn

    def init_db(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS usuarios (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nome TEXT,
                    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    setor TEXT,
                    perfil TEXT NOT NULL DEFAULT 'visualizador'
                        CHECK (perfil IN ('master', 'admin', 'engenharia', 'producao', 'visualizador')),
                    status TEXT NOT NULL DEFAULT 'pendente'
                        CHECK (status IN ('pendente', 'aprovado', 'bloqueado')),
                    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
                    ultimo_login TEXT,
                    maquina TEXT,
                    observacao TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
                CREATE INDEX IF NOT EXISTS idx_usuarios_status ON usuarios(status);
                CREATE INDEX IF NOT EXISTS idx_usuarios_perfil ON usuarios(perfil);

                CREATE TABLE IF NOT EXISTS logs_auditoria (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    usuario_email TEXT,
                    acao TEXT NOT NULL,
                    status TEXT NOT NULL,
                    data_hora TEXT NOT NULL DEFAULT (datetime('now')),
                    maquina TEXT,
                    ip TEXT,
                    detalhes TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_logs_usuario ON logs_auditoria(usuario_email);
                CREATE INDEX IF NOT EXISTS idx_logs_acao ON logs_auditoria(acao);
                CREATE INDEX IF NOT EXISTS idx_logs_data ON logs_auditoria(data_hora);
                """
            )

    def _row_to_dict(self, row: sqlite3.Row | None) -> dict[str, Any] | None:
        return dict(row) if row is not None else None

    def _json_details(self, details: dict[str, Any] | None) -> str | None:
        if details is None:
            return None
        return json.dumps(details, ensure_ascii=False, default=str)

    def log_event(
        self,
        *,
        usuario_email: str | None,
        acao: str,
        status: str,
        maquina: str | None = None,
        ip: str | None = None,
        detalhes: dict[str, Any] | None = None,
    ) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO logs_auditoria (usuario_email, acao, status, data_hora, maquina, ip, detalhes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    normalize_full_email(usuario_email) if usuario_email else None,
                    acao,
                    status,
                    utc_now_iso(),
                    maquina or default_machine_name(),
                    ip,
                    self._json_details(detalhes),
                ),
            )

    def get_user_by_email(self, email: str) -> dict[str, Any] | None:
        email = normalize_full_email(email)
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM usuarios WHERE lower(email) = lower(?)", (email,)).fetchone()
        return self._row_to_dict(row)

    def get_current_user(self, token: str | None) -> dict[str, Any]:
        session = self.sessions.get(token)
        if not session:
            return {"ok": False, "authenticated": False, "message": "Sessão inválida ou expirada."}

        user = self.get_user_by_email(session.email)
        if not user or user.get("status") != "aprovado":
            self.sessions.revoke(token)
            return {"ok": False, "authenticated": False, "message": "Sessão inválida ou usuário sem aprovação."}

        return {
            "ok": True,
            "authenticated": True,
            "user": {
                "email": user["email"],
                "nome": user.get("nome"),
                "perfil": user["perfil"],
                "setor": user.get("setor"),
                "status": user["status"],
            },
        }

    def _require_session(self, token: str | None) -> tuple[SessionData, dict[str, Any]]:
        session = self.sessions.get(token)
        if not session:
            raise PermissionDenied("Sessão inválida ou expirada.")
        user = self.get_user_by_email(session.email)
        if not user or user.get("status") != "aprovado":
            self.sessions.revoke(token)
            raise PermissionDenied("Usuário não aprovado ou inexistente.")
        return session, user

    def _require_admin(self, token: str | None) -> tuple[SessionData, dict[str, Any]]:
        session, user = self._require_session(token)
        if user.get("perfil") not in ADMIN_PROFILES:
            raise PermissionDenied("Acesso restrito a administradores.")
        return session, user

    def login(
        self,
        usuario: str,
        maquina: str | None = None,
        ip: str | None = None,
        windows_email: str | None = None,
    ) -> dict[str, Any]:
        normalized = normalize_corporate_user(usuario)
        attempted_email = normalized.email or normalize_full_email(usuario)

        self.log_event(
            usuario_email=attempted_email,
            acao="tentativa de login",
            status="tentativa",
            maquina=maquina,
            ip=ip,
            detalhes={"windows_email": windows_email, "entrada_normalizada": attempted_email},
        )

        if not normalized.ok or not normalized.email:
            self.log_event(
                usuario_email=attempted_email,
                acao="login bloqueado por domínio inválido",
                status="bloqueado",
                maquina=maquina,
                ip=ip,
                detalhes={"motivo": normalized.error, "windows_email": windows_email},
            )
            return {"ok": False, "code": "invalid_domain", "message": MSG_INVALID_DOMAIN}

        user = self.get_user_by_email(normalized.email)
        if not user:
            # Regra obrigatória: a autenticação/validação de acesso só pode
            # acontecer se o e-mail completo existir na tabela usuarios.
            # Usuário inexistente nunca recebe sessão; apenas pode solicitar acesso.
            self.log_event(
                usuario_email=normalized.email,
                acao="login bloqueado por usuário inexistente",
                status="bloqueado",
                maquina=maquina,
                ip=ip,
                detalhes={"motivo": "email_corporativo_nao_cadastrado"},
            )
            return {
                "ok": False,
                "code": "not_registered",
                "message": MSG_NOT_REGISTERED,
                "can_request_access": True,
                "email": normalized.email,
                "usuario": normalized.usuario,
            }

        if user["status"] == "pendente":
            self.log_event(
                usuario_email=normalized.email,
                acao="login bloqueado por usuário pendente",
                status="bloqueado",
                maquina=maquina,
                ip=ip,
            )
            return {"ok": False, "code": "pending", "message": MSG_PENDING, "can_request_access": True}

        if user["status"] == "bloqueado":
            self.log_event(
                usuario_email=normalized.email,
                acao="login bloqueado por usuário bloqueado",
                status="bloqueado",
                maquina=maquina,
                ip=ip,
            )
            return {"ok": False, "code": "blocked", "message": MSG_BLOCKED}

        if user["status"] != "aprovado":
            return {"ok": False, "code": "invalid_status", "message": "Status de usuário inválido."}

        with self.connect() as conn:
            conn.execute(
                "UPDATE usuarios SET ultimo_login = ?, maquina = ? WHERE lower(email) = lower(?)",
                (utc_now_iso(), maquina or default_machine_name(), normalized.email),
            )

        session = self.sessions.create(
            email=user["email"],
            nome=user.get("nome"),
            perfil=user["perfil"],
            setor=user.get("setor"),
            status=user["status"],
            maquina=maquina or default_machine_name(),
            ip=ip,
        )

        self.log_event(
            usuario_email=normalized.email,
            acao="login aprovado",
            status="aprovado",
            maquina=maquina,
            ip=ip,
            detalhes={"perfil": user["perfil"], "setor": user.get("setor")},
        )

        return {
            "ok": True,
            "code": "approved",
            "message": MSG_APPROVED,
            "session": session.to_public_dict(),
            "user": {
                "email": user["email"],
                "nome": user.get("nome"),
                "perfil": user["perfil"],
                "setor": user.get("setor"),
                "status": user["status"],
            },
        }

    def request_access(
        self,
        nome: str,
        usuario: str,
        setor: str | None = None,
        observacao: str | None = None,
        maquina: str | None = None,
        ip: str | None = None,
    ) -> dict[str, Any]:
        normalized = normalize_corporate_user(usuario)
        if not normalized.ok or not normalized.email:
            self.log_event(
                usuario_email=normalize_full_email(usuario),
                acao="login bloqueado por domínio inválido",
                status="bloqueado",
                maquina=maquina,
                ip=ip,
                detalhes={"origem": "solicitacao_acesso", "motivo": normalized.error},
            )
            return {"ok": False, "code": "invalid_domain", "message": MSG_INVALID_DOMAIN}

        nome = (nome or "").strip()
        setor = (setor or "").strip() or None
        observacao = (observacao or "").strip() or None

        if len(nome) < 2:
            return {"ok": False, "code": "invalid_name", "message": "Informe o nome do usuário."}

        existing = self.get_user_by_email(normalized.email)
        if existing:
            if existing["status"] == "aprovado":
                return {"ok": False, "code": "already_approved", "message": "Usuário já aprovado. Faça login."}
            if existing["status"] == "bloqueado":
                return {"ok": False, "code": "blocked", "message": MSG_BLOCKED}
            return {"ok": True, "code": "already_pending", "message": MSG_REQUEST_SENT}

        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO usuarios (nome, email, setor, perfil, status, criado_em, maquina, observacao)
                VALUES (?, ?, ?, 'visualizador', 'pendente', ?, ?, ?)
                """,
                (nome, normalized.email, setor, utc_now_iso(), maquina or default_machine_name(), observacao),
            )

        self.log_event(
            usuario_email=normalized.email,
            acao="solicitação de acesso criada",
            status="pendente",
            maquina=maquina,
            ip=ip,
            detalhes={"nome": nome, "setor": setor, "observacao": observacao},
        )
        return {"ok": True, "code": "request_created", "message": MSG_REQUEST_SENT}

    def logout(self, token: str | None, maquina: str | None = None, ip: str | None = None) -> dict[str, Any]:
        session = self.sessions.revoke(token)
        if session:
            self.log_event(
                usuario_email=session.email,
                acao="logout",
                status="ok",
                maquina=maquina or session.maquina,
                ip=ip or session.ip,
            )
        return {"ok": True, "message": "Logout realizado."}

    def list_users(
        self,
        token: str,
        status: str | None = None,
        perfil: str | None = None,
        setor: str | None = None,
        limit: int = 300,
    ) -> dict[str, Any]:
        try:
            self._require_admin(token)
        except PermissionDenied as exc:
            return {"ok": False, "message": str(exc)}

        filters: list[str] = []
        params: list[Any] = []
        if status:
            filters.append("status = ?")
            params.append(status)
        if perfil:
            filters.append("perfil = ?")
            params.append(perfil)
        if setor:
            filters.append("setor LIKE ?")
            params.append(f"%{setor}%")

        where = f"WHERE {' AND '.join(filters)}" if filters else ""
        limit = max(1, min(int(limit or 300), 1000))
        with self.connect() as conn:
            rows = conn.execute(
                f"""
                SELECT id, nome, email, setor, perfil, status, criado_em, ultimo_login, maquina, observacao
                FROM usuarios
                {where}
                ORDER BY CASE status WHEN 'pendente' THEN 0 WHEN 'aprovado' THEN 1 ELSE 2 END, criado_em DESC
                LIMIT ?
                """,
                (*params, limit),
            ).fetchall()
        return {"ok": True, "users": [dict(row) for row in rows]}

    def approve_user(self, token: str, target_email: str, observacao: str | None = None) -> dict[str, Any]:
        try:
            admin_session, admin_user = self._require_admin(token)
            target = self.get_user_by_email(target_email)
            if not target:
                return {"ok": False, "message": "Usuário não encontrado."}
            if target["perfil"] == "master" and admin_user["perfil"] != "master":
                return {"ok": False, "message": "Admin não pode alterar usuário master."}

            with self.connect() as conn:
                conn.execute(
                    "UPDATE usuarios SET status = 'aprovado', observacao = COALESCE(NULLIF(?, ''), observacao) WHERE lower(email) = lower(?)",
                    ((observacao or "").strip(), target["email"]),
                )

            self.log_event(
                usuario_email=target["email"],
                acao="aprovação de usuário",
                status="aprovado",
                maquina=admin_session.maquina,
                ip=admin_session.ip,
                detalhes={"admin": admin_user["email"], "observacao": observacao},
            )
            return {"ok": True, "message": "Usuário aprovado."}
        except PermissionDenied as exc:
            return {"ok": False, "message": str(exc)}

    def block_user(self, token: str, target_email: str, observacao: str | None = None) -> dict[str, Any]:
        try:
            admin_session, admin_user = self._require_admin(token)
            target = self.get_user_by_email(target_email)
            if not target:
                return {"ok": False, "message": "Usuário não encontrado."}
            if target["perfil"] == "master" and admin_user["perfil"] != "master":
                return {"ok": False, "message": "Admin não pode bloquear usuário master."}
            if target["email"].lower() == admin_user["email"].lower():
                return {"ok": False, "message": "Você não pode bloquear o próprio usuário."}

            with self.connect() as conn:
                conn.execute(
                    "UPDATE usuarios SET status = 'bloqueado', observacao = COALESCE(NULLIF(?, ''), observacao) WHERE lower(email) = lower(?)",
                    ((observacao or "").strip(), target["email"]),
                )

            self.log_event(
                usuario_email=target["email"],
                acao="bloqueio de usuário",
                status="bloqueado",
                maquina=admin_session.maquina,
                ip=admin_session.ip,
                detalhes={"admin": admin_user["email"], "observacao": observacao},
            )
            return {"ok": True, "message": "Usuário bloqueado."}
        except PermissionDenied as exc:
            return {"ok": False, "message": str(exc)}

    def update_user_profile(self, token: str, target_email: str, perfil: str) -> dict[str, Any]:
        perfil = (perfil or "").strip().lower()
        if perfil not in PROFILE_VALUES:
            return {"ok": False, "message": "Perfil inválido."}

        try:
            admin_session, admin_user = self._require_admin(token)
            target = self.get_user_by_email(target_email)
            if not target:
                return {"ok": False, "message": "Usuário não encontrado."}

            if admin_user["perfil"] != "master" and (target["perfil"] == "master" or perfil in {"master", "admin"}):
                return {"ok": False, "message": "Somente master pode criar/alterar admin ou master."}

            old_profile = target["perfil"]
            with self.connect() as conn:
                conn.execute("UPDATE usuarios SET perfil = ? WHERE lower(email) = lower(?)", (perfil, target["email"]))

            self.log_event(
                usuario_email=target["email"],
                acao="alteração de perfil",
                status="ok",
                maquina=admin_session.maquina,
                ip=admin_session.ip,
                detalhes={"admin": admin_user["email"], "perfil_anterior": old_profile, "perfil_novo": perfil},
            )
            return {"ok": True, "message": "Perfil alterado."}
        except PermissionDenied as exc:
            return {"ok": False, "message": str(exc)}

    def update_user_sector(self, token: str, target_email: str, setor: str | None) -> dict[str, Any]:
        try:
            admin_session, admin_user = self._require_admin(token)
            target = self.get_user_by_email(target_email)
            if not target:
                return {"ok": False, "message": "Usuário não encontrado."}
            if target["perfil"] == "master" and admin_user["perfil"] != "master":
                return {"ok": False, "message": "Admin não pode alterar usuário master."}

            old_sector = target.get("setor")
            new_sector = (setor or "").strip() or None
            with self.connect() as conn:
                conn.execute("UPDATE usuarios SET setor = ? WHERE lower(email) = lower(?)", (new_sector, target["email"]))

            self.log_event(
                usuario_email=target["email"],
                acao="alteração de setor",
                status="ok",
                maquina=admin_session.maquina,
                ip=admin_session.ip,
                detalhes={"admin": admin_user["email"], "setor_anterior": old_sector, "setor_novo": new_sector},
            )
            return {"ok": True, "message": "Setor alterado."}
        except PermissionDenied as exc:
            return {"ok": False, "message": str(exc)}

    def list_logs(self, token: str, usuario_email: str | None = None, limit: int = 300) -> dict[str, Any]:
        try:
            session, admin_user = self._require_admin(token)
            if admin_user["perfil"] not in ADMIN_PROFILES:
                raise PermissionDenied("Acesso restrito a administradores.")
        except PermissionDenied as exc:
            return {"ok": False, "message": str(exc)}

        limit = max(1, min(int(limit or 300), 1000))
        params: list[Any] = []
        where = ""
        if usuario_email:
            where = "WHERE lower(usuario_email) = lower(?)"
            params.append(normalize_full_email(usuario_email))

        with self.connect() as conn:
            rows = conn.execute(
                f"""
                SELECT id, usuario_email, acao, status, data_hora, maquina, ip, detalhes
                FROM logs_auditoria
                {where}
                ORDER BY id DESC
                LIMIT ?
                """,
                (*params, limit),
            ).fetchall()
        return {"ok": True, "logs": [dict(row) for row in rows]}

    def create_master_user(self, nome: str, usuario: str, setor: str = "Engenharia", observacao: str | None = None) -> dict[str, Any]:
        """Criação inicial/local do primeiro master.

        Use apenas no setup inicial ou migração. Não exponha essa função diretamente no frontend.
        """
        normalized = normalize_corporate_user(usuario)
        if not normalized.ok or not normalized.email:
            return {"ok": False, "message": normalized.error or MSG_INVALID_DOMAIN}
        existing = self.get_user_by_email(normalized.email)
        if existing:
            with self.connect() as conn:
                conn.execute(
                    "UPDATE usuarios SET nome = ?, setor = ?, perfil = 'master', status = 'aprovado', observacao = COALESCE(NULLIF(?, ''), observacao) WHERE lower(email) = lower(?)",
                    ((nome or "").strip(), setor, observacao or "", normalized.email),
                )
        else:
            with self.connect() as conn:
                conn.execute(
                    """
                    INSERT INTO usuarios (nome, email, setor, perfil, status, criado_em, maquina, observacao)
                    VALUES (?, ?, ?, 'master', 'aprovado', ?, ?, ?)
                    """,
                    ((nome or "").strip(), normalized.email, setor, utc_now_iso(), default_machine_name(), observacao),
                )
        self.log_event(
            usuario_email=normalized.email,
            acao="criação/ajuste de usuário master",
            status="aprovado",
            maquina=default_machine_name(),
            detalhes={"origem": "setup_inicial"},
        )
        return {"ok": True, "message": "Usuário master criado/aprovado.", "email": normalized.email}


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Setup inicial da autenticação corporativa.")
    parser.add_argument("--db", required=True, help="Caminho do banco SQLite, exemplo: data/app.db")
    parser.add_argument("--create-master", nargs=2, metavar=("NOME", "USUARIO"), help="Cria/aprova um usuário master inicial")
    parser.add_argument("--setor", default="Engenharia")
    args = parser.parse_args(list(argv) if argv is not None else None)

    service = AuthService(args.db)
    if args.create_master:
        nome, usuario = args.create_master
        result = service.create_master_user(nome=nome, usuario=usuario, setor=args.setor, observacao="Setup inicial via CLI")
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
