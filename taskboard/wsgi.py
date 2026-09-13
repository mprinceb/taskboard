"""Optional dedicated HTTP entry point, pinned to one Frappe site."""

import os
from pathlib import Path
import frappe.app
from werkzeug.middleware.shared_data import SharedDataMiddleware

site = os.environ.get("TASKBOARD_SITE")
if not site:
    raise RuntimeError("Set TASKBOARD_SITE to the installed Frappe site")
bench = Path(__file__).resolve().parents[3]
os.chdir(bench / "sites")
frappe.app._site = site
frappe.app._sites_path = "."
application = SharedDataMiddleware(
    frappe.app.application,
    {
        "/assets/taskboard": str(Path(__file__).parent / "public"),
        "/assets/frappe": str(bench / "apps/frappe/frappe/public"),
    },
)
