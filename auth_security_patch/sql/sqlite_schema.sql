-- SQLite local: usuários corporativos + logs de auditoria.
-- Use este arquivo se preferir migrar manualmente em vez de usar AuthService.init_db().

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
    observacao TEXT,
    CHECK (lower(email) LIKE '%@globaleletronics.ind.br')
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
