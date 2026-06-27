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
