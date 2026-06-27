from __future__ import annotations

from functools import wraps
from typing import Callable, Any

from .auth_service import AuthService, ADMIN_PROFILES


def protected(auth: AuthService):
    """Decorator simples para funções internas que exigem sessão válida.

    A função decorada deve receber token como primeiro argumento nomeado ou posicional.
    Exemplo:
        @protected(auth)
        def carregar_dados(token: str): ...
    """
    def decorator(func: Callable[..., Any]):
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any):
            token = kwargs.get("token") or (args[0] if args else None)
            current = auth.get_current_user(token)
            if not current.get("ok"):
                return {"ok": False, "message": "Acesso negado. Faça login novamente."}
            return func(*args, **kwargs)
        return wrapper
    return decorator


def admin_only(auth: AuthService):
    """Decorator para funções que exigem perfil admin ou master."""
    def decorator(func: Callable[..., Any]):
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any):
            token = kwargs.get("token") or (args[0] if args else None)
            current = auth.get_current_user(token)
            if not current.get("ok"):
                return {"ok": False, "message": "Acesso negado. Faça login novamente."}
            user = current.get("user") or {}
            if user.get("perfil") not in ADMIN_PROFILES:
                return {"ok": False, "message": "Acesso restrito a administradores."}
            return func(*args, **kwargs)
        return wrapper
    return decorator
