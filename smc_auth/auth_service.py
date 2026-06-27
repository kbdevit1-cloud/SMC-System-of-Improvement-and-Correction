from __future__ import annotations

import argparse
import json
import re
import secrets
import socket
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

CORPORATE_DOMAIN = '@globaleletronics.ind.br'
LOCAL_RE = re.compile(r'^[a-z0-9._-]{2,80}$')
PROFILES = {'master', 'admin', 'engenharia', 'producao', 'visualizador'}
ADMIN_PROFILES = {'master', 'admin'}
STATUS = {'pendente', 'aprovado', 'bloqueado'}

MSG_INVALID_DOMAIN = 'Acesso bloqueado. Use apenas e-mail corporativo @globaleletronics.ind.br.'
MSG_PENDING = 'Usuário pendente de aprovação. Solicite liberação ao administrador.'
MSG_BLOCKED = 'Usuário bloqueado. Entre em contato com o administrador.'
MSG_APPROVED = 'Acesso liberado.'
MSG_NOT_REGISTERED = 'E-mail corporativo não cadastrado. Clique em Solicitar acesso.'
MSG_REQUEST_SENT = 'Solicitação enviada. Aguarde aprovação do administrador.'


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def machine_name() -> str:
    try:
        return socket.gethostname()
    except Exception:
        return 'desconhecida'


@dataclass
class Session:
    token: str
    email: str
    nome: str | None
    perfil: str
    setor: str | None
    created_at: datetime
    expires_at: datetime

    def public(self) -> dict[str, Any]:
        return {
            'token': self.token,
            'email': self.email,
            'nome': self.nome,
            'perfil': self.perfil,
            'setor': self.setor,
            'created_at': self.created_at.isoformat(timespec='seconds'),
            'expires_at': self.expires_at.isoformat(timespec='seconds'),
        }


class AuthService:
    def __init__(self, db_path: str | Path = 'data/app.db', session_minutes: int = 480):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.session_minutes = session_minutes
        self.sessions: dict[str, Session] = {}
        self.init_db()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys = ON')
        conn.execute('PRAGMA journal_mode = WAL')
        return conn

    def init_db(self) -> None:
        with self.connect() as conn:
            conn.executescript('''
            CREATE TABLE IF NOT EXISTS usuarios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                setor TEXT,
                perfil TEXT NOT NULL DEFAULT 'visualizador',
                status TEXT NOT NULL DEFAULT 'pendente',
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
            ''')

    def normalize_user(self, raw: str | None) -> tuple[bool, str | None, str | None]:
        value = (raw or '').strip().lower()
        value = re.sub(r'\s+', '', value)
        if not value:
            return False, None, 'Informe seu usuário corporativo.'
        if '@' in value:
            local, _, domain = value.partition('@')
            if '@' + domain != CORPORATE_DOMAIN:
                return False, None, MSG_INVALID_DOMAIN
            value = local
        if not LOCAL_RE.fullmatch(value):
            return False, None, 'Usuário corporativo inválido.'
        return True, f'{value}{CORPORATE_DOMAIN}', None

    def log(self, usuario_email: str | None, acao: str, status: str, maquina: str | None = None, ip: str | None = None, detalhes: dict[str, Any] | None = None) -> None:
        with self.connect() as conn:
            conn.execute(
                'INSERT INTO logs_auditoria (usuario_email, acao, status, data_hora, maquina, ip, detalhes) VALUES (?, ?, ?, ?, ?, ?, ?)',
                ((usuario_email or '').lower() or None, acao, status, now_iso(), maquina or machine_name(), ip, json.dumps(detalhes or {}, ensure_ascii=False)),
            )

    def get_user(self, email: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute('SELECT * FROM usuarios WHERE lower(email) = lower(?)', (email.lower(),)).fetchone()
        return dict(row) if row else None

    def login(self, usuario: str, maquina: str | None = None, ip: str | None = None, windows_email: str | None = None) -> dict[str, Any]:
        ok, email, error = self.normalize_user(usuario)
        tentativa = (email or usuario or '').strip().lower()
        self.log(tentativa, 'tentativa de login', 'tentativa', maquina, ip, {'windows_email': windows_email})

        if not ok or not email:
            self.log(tentativa, 'login bloqueado por domínio inválido', 'bloqueado', maquina, ip, {'motivo': error})
            return {'ok': False, 'code': 'invalid_domain', 'message': MSG_INVALID_DOMAIN}

        user = self.get_user(email)
        if not user:
            # Regra obrigatória: validação/autenticação só ocorre se o e-mail existir na tabela usuarios.
            self.log(email, 'login bloqueado por usuário inexistente', 'bloqueado', maquina, ip, {'motivo': 'email_nao_existe_em_usuarios'})
            return {'ok': False, 'code': 'not_registered', 'message': MSG_NOT_REGISTERED, 'can_request_access': True}

        if user['status'] == 'pendente':
            self.log(email, 'login bloqueado por usuário pendente', 'bloqueado', maquina, ip)
            return {'ok': False, 'code': 'pending', 'message': MSG_PENDING, 'can_request_access': True}

        if user['status'] == 'bloqueado':
            self.log(email, 'login bloqueado por usuário bloqueado', 'bloqueado', maquina, ip)
            return {'ok': False, 'code': 'blocked', 'message': MSG_BLOCKED}

        if user['status'] != 'aprovado':
            return {'ok': False, 'code': 'invalid_status', 'message': 'Status inválido.'}

        token = secrets.token_urlsafe(32)
        created = datetime.now(timezone.utc)
        session = Session(token, user['email'], user.get('nome'), user['perfil'], user.get('setor'), created, created + timedelta(minutes=self.session_minutes))
        self.sessions[token] = session

        with self.connect() as conn:
            conn.execute('UPDATE usuarios SET ultimo_login = ?, maquina = ? WHERE lower(email) = lower(?)', (now_iso(), maquina or machine_name(), email))

        self.log(email, 'login aprovado', 'aprovado', maquina, ip, {'perfil': user['perfil'], 'setor': user.get('setor')})
        return {'ok': True, 'code': 'approved', 'message': MSG_APPROVED, 'session': session.public(), 'user': self.safe_user(user)}

    def safe_user(self, user: dict[str, Any]) -> dict[str, Any]:
        return {'email': user['email'], 'nome': user.get('nome'), 'perfil': user['perfil'], 'setor': user.get('setor'), 'status': user['status']}

    def get_current_user(self, token: str | None) -> dict[str, Any]:
        session = self.sessions.get(token or '')
        if not session or session.expires_at < datetime.now(timezone.utc):
            return {'ok': False, 'authenticated': False, 'message': 'Sessão inválida ou expirada.'}
        user = self.get_user(session.email)
        if not user or user['status'] != 'aprovado':
            self.sessions.pop(token or '', None)
            return {'ok': False, 'authenticated': False, 'message': 'Usuário não aprovado ou inexistente.'}
        return {'ok': True, 'authenticated': True, 'user': self.safe_user(user)}

    def request_access(self, nome: str, usuario: str, setor: str | None = None, observacao: str | None = None, maquina: str | None = None, ip: str | None = None) -> dict[str, Any]:
        ok, email, error = self.normalize_user(usuario)
        if not ok or not email:
            self.log(usuario, 'login bloqueado por domínio inválido', 'bloqueado', maquina, ip, {'origem': 'solicitacao_acesso', 'motivo': error})
            return {'ok': False, 'code': 'invalid_domain', 'message': MSG_INVALID_DOMAIN}

        nome = (nome or '').strip()
        if len(nome) < 2:
            return {'ok': False, 'code': 'invalid_name', 'message': 'Informe o nome do usuário.'}

        existing = self.get_user(email)
        if existing:
            if existing['status'] == 'aprovado':
                return {'ok': False, 'code': 'already_approved', 'message': 'Usuário já aprovado. Faça login.'}
            if existing['status'] == 'bloqueado':
                return {'ok': False, 'code': 'blocked', 'message': MSG_BLOCKED}
            return {'ok': True, 'code': 'already_pending', 'message': MSG_REQUEST_SENT}

        with self.connect() as conn:
            conn.execute(
                'INSERT INTO usuarios (nome, email, setor, perfil, status, criado_em, maquina, observacao) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                (nome, email, (setor or '').strip() or None, 'visualizador', 'pendente', now_iso(), maquina or machine_name(), (observacao or '').strip() or None),
            )
        self.log(email, 'solicitação de acesso criada', 'pendente', maquina, ip, {'nome': nome, 'setor': setor, 'observacao': observacao})
        return {'ok': True, 'code': 'request_created', 'message': MSG_REQUEST_SENT}

    def require_admin(self, token: str) -> tuple[dict[str, Any] | None, str | None]:
        current = self.get_current_user(token)
        if not current.get('ok'):
            return None, current.get('message')
        user = self.get_user(current['user']['email'])
        if not user or user['perfil'] not in ADMIN_PROFILES:
            return None, 'Acesso restrito a administradores.'
        return user, None

    def list_users(self, token: str, status: str | None = None) -> dict[str, Any]:
        admin, error = self.require_admin(token)
        if error:
            return {'ok': False, 'message': error}
        sql = 'SELECT id, nome, email, setor, perfil, status, criado_em, ultimo_login, maquina, observacao FROM usuarios'
        params: tuple[Any, ...] = ()
        if status:
            sql += ' WHERE status = ?'
            params = (status,)
        sql += ' ORDER BY CASE status WHEN \'pendente\' THEN 0 WHEN \'aprovado\' THEN 1 ELSE 2 END, criado_em DESC'
        with self.connect() as conn:
            users = [dict(r) for r in conn.execute(sql, params).fetchall()]
        return {'ok': True, 'users': users}

    def set_status(self, token: str, target_email: str, status: str, observacao: str | None = None) -> dict[str, Any]:
        admin, error = self.require_admin(token)
        if error:
            return {'ok': False, 'message': error}
        if status not in STATUS:
            return {'ok': False, 'message': 'Status inválido.'}
        target = self.get_user(target_email)
        if not target:
            return {'ok': False, 'message': 'Usuário não encontrado.'}
        if target['perfil'] == 'master' and admin['perfil'] != 'master':
            return {'ok': False, 'message': 'Admin não pode alterar usuário master.'}
        if target['email'].lower() == admin['email'].lower() and status == 'bloqueado':
            return {'ok': False, 'message': 'Você não pode bloquear o próprio usuário.'}
        with self.connect() as conn:
            conn.execute('UPDATE usuarios SET status = ?, observacao = COALESCE(NULLIF(?, \'\'), observacao) WHERE lower(email) = lower(?)', (status, observacao or '', target['email']))
        action = 'aprovação de usuário' if status == 'aprovado' else 'bloqueio de usuário' if status == 'bloqueado' else 'alteração de status'
        self.log(target['email'], action, status, detalhes={'admin': admin['email'], 'observacao': observacao})
        return {'ok': True, 'message': 'Status alterado.'}

    def update_profile(self, token: str, target_email: str, perfil: str) -> dict[str, Any]:
        perfil = (perfil or '').strip().lower()
        if perfil not in PROFILES:
            return {'ok': False, 'message': 'Perfil inválido.'}
        admin, error = self.require_admin(token)
        if error:
            return {'ok': False, 'message': error}
        target = self.get_user(target_email)
        if not target:
            return {'ok': False, 'message': 'Usuário não encontrado.'}
        if admin['perfil'] != 'master' and (target['perfil'] == 'master' or perfil in {'master', 'admin'}):
            return {'ok': False, 'message': 'Somente master pode criar/alterar admin ou master.'}
        old = target['perfil']
        with self.connect() as conn:
            conn.execute('UPDATE usuarios SET perfil = ? WHERE lower(email) = lower(?)', (perfil, target['email']))
        self.log(target['email'], 'alteração de perfil', 'ok', detalhes={'admin': admin['email'], 'perfil_anterior': old, 'perfil_novo': perfil})
        return {'ok': True, 'message': 'Perfil alterado.'}

    def logout(self, token: str | None, maquina: str | None = None, ip: str | None = None) -> dict[str, Any]:
        session = self.sessions.pop(token or '', None)
        if session:
            self.log(session.email, 'logout', 'ok', maquina, ip)
        return {'ok': True, 'message': 'Logout realizado.'}

    def create_master_user(self, nome: str, usuario: str, setor: str = 'Engenharia') -> dict[str, Any]:
        ok, email, error = self.normalize_user(usuario)
        if not ok or not email:
            return {'ok': False, 'message': error or MSG_INVALID_DOMAIN}
        with self.connect() as conn:
            existing = self.get_user(email)
            if existing:
                conn.execute('UPDATE usuarios SET nome = ?, setor = ?, perfil = ?, status = ? WHERE lower(email) = lower(?)', (nome, setor, 'master', 'aprovado', email))
            else:
                conn.execute('INSERT INTO usuarios (nome, email, setor, perfil, status, criado_em, maquina) VALUES (?, ?, ?, ?, ?, ?, ?)', (nome, email, setor, 'master', 'aprovado', now_iso(), machine_name()))
        self.log(email, 'criação/ajuste de usuário master', 'aprovado')
        return {'ok': True, 'message': 'Usuário master criado/aprovado.', 'email': email}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', default='data/app.db')
    parser.add_argument('--create-master', nargs=2, metavar=('NOME', 'USUARIO'))
    parser.add_argument('--setor', default='Engenharia')
    args = parser.parse_args()
    service = AuthService(args.db)
    if args.create_master:
        print(json.dumps(service.create_master_user(args.create_master[0], args.create_master[1], args.setor), ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
