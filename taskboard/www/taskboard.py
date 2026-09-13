from frappe.sessions import get_csrf_token

no_cache = 1


def get_context(context):
    context.csrf_token = get_csrf_token()
    context.no_cache = 1
    from pathlib import Path

    context.asset_version = str(
        (Path(__file__).resolve().parents[1] / "public/ui/app.js").stat().st_mtime_ns
    )
