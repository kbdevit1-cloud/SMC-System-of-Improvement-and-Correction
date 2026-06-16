"""Exemplo de integração com pywebview.

Ajuste os caminhos conforme a estrutura real do seu projeto.
Não crie outra janela/WebView para login; exponha esta API na janela principal.
"""

from pathlib import Path
import webview

from security.auth_service import AuthService


BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data" / "app.db"


class AppApi:
    def __init__(self) -> None:
        self.auth = AuthService(DB_PATH)

    # Auth API usada pelo frontend/auth/auth-ui.js
    def login(self, usuario: str, maquina: str | None = None, ip: str | None = None, windows_email: str | None = None):
        return self.auth.login(usuario=usuario, maquina=maquina, ip=ip, windows_email=windows_email)

    def request_access(self, nome: str, usuario: str, setor: str | None = None, observacao: str | None = None, maquina: str | None = None, ip: str | None = None):
        return self.auth.request_access(nome=nome, usuario=usuario, setor=setor, observacao=observacao, maquina=maquina, ip=ip)

    def get_current_user(self, token: str):
        return self.auth.get_current_user(token)

    def logout(self, token: str):
        return self.auth.logout(token)

    def list_users(self, token: str, status: str | None = None, perfil: str | None = None, setor: str | None = None):
        return self.auth.list_users(token=token, status=status, perfil=perfil, setor=setor)

    def approve_user(self, token: str, target_email: str, observacao: str | None = None):
        return self.auth.approve_user(token=token, target_email=target_email, observacao=observacao)

    def block_user(self, token: str, target_email: str, observacao: str | None = None):
        return self.auth.block_user(token=token, target_email=target_email, observacao=observacao)

    def update_user_profile(self, token: str, target_email: str, perfil: str):
        return self.auth.update_user_profile(token=token, target_email=target_email, perfil=perfil)

    def update_user_sector(self, token: str, target_email: str, setor: str | None):
        return self.auth.update_user_sector(token=token, target_email=target_email, setor=setor)

    def list_logs(self, token: str, usuario_email: str | None = None):
        return self.auth.list_logs(token=token, usuario_email=usuario_email)

    # Exemplo de rota protegida. Nenhum dado interno deve ser carregado antes desta validação.
    def carregar_dashboard(self, token: str):
        current = self.auth.get_current_user(token)
        if not current.get("ok"):
            return {"ok": False, "message": "Acesso negado. Faça login novamente."}
        return {"ok": True, "data": {"exemplo": "dados protegidos"}}


if __name__ == "__main__":
    api = AppApi()
    webview.create_window(
        "Sistema interno",
        str(BASE_DIR / "frontend" / "index.html"),
        js_api=api,
        width=1280,
        height=800,
    )
    webview.start(debug=False)
