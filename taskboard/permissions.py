"""App membership is checked on every request, including native file downloads."""

import frappe


def membership(user=None):
    user = user or frappe.session.user
    if not user or user == "Guest":
        return None
    if user == "Administrator":
        return frappe._dict(user=user, role="Admin", email_notifications=0)
    if not frappe.db.get_value("User", user, "enabled"):
        return None
    return frappe.db.get_value(
        "TB Member",
        {"user": user, "active": 1},
        ["name", "user", "role", "email_notifications"],
        as_dict=True,
    )


def require_member(admin=False):
    member = membership()
    if not member or (admin and member.role != "Admin"):
        frappe.throw(
            "You do not have access to this board."
            if not member
            else "Only board admins can do this.",
            frappe.PermissionError,
        )
    return member


def card_permission(doc, ptype="read", user=None, **kwargs):
    m = membership(user)
    # All changes use the narrow app API. Native assignment needs read access.
    return bool(m) if ptype in ("read", "select") else False


def list_permission(doc, ptype="read", user=None, **kwargs):
    return card_permission(doc, ptype, user, **kwargs)


def query_condition(user=None):
    return "" if membership(user) else "1=0"


def file_permission(doc, ptype="read", user=None, **kwargs):
    if doc.attached_to_doctype == "TB Card":
        if not membership(user):
            return False
        if frappe.db.exists("TB Attachment", {"file": doc.name, "removed": 1}):
            return False
        return ptype in ("read", "select")
    return None


def comment_permission(doc, ptype="read", user=None, **kwargs):
    if doc.reference_doctype == "TB Card":
        return bool(membership(user)) and ptype in ("read", "select")
    return None


def todo_permission(doc, ptype="read", user=None, **kwargs):
    if doc.reference_type == "TB Card" and not membership(user):
        return False
    return None


def validate_file(doc, method=None):
    if doc.attached_to_doctype == "TB Card":
        require_member()
        doc.is_private = 1
        if not frappe.flags.taskboard_upload:
            frappe.throw(
                "Upload attachments through Taskboard.", frappe.PermissionError
            )


def validate_todo(doc, method=None):
    if doc.reference_type == "TB Card":
        require_member()
        if doc.status != "Cancelled" and not membership(doc.allocated_to):
            frappe.throw("Assignees must be active board members.")


def guard_download():
    """Frappe v14's direct File helper grants owners access before app hooks."""
    from urllib.parse import unquote

    request = getattr(frappe.local, "request", None)
    if not request:
        return
    url = unquote(request.path)
    if not url.startswith("/private/files/"):
        url = unquote(str(frappe.form_dict.get("file_url") or ""))
    if not url.startswith("/private/files/"):
        return
    files = frappe.get_all(
        "File",
        filters={"file_url": url, "attached_to_doctype": "TB Card"},
        pluck="name",
    )
    if not files:
        return
    # A deduplicated URL can also belong to an independently authorized ERP file.
    # Preserve access through that other record; only Taskboard access is revoked.
    others = frappe.get_all(
        "File", filters={"file_url": url}, fields=["name", "attached_to_doctype"]
    )
    for other in others:
        if other.attached_to_doctype != "TB Card" and frappe.has_permission(
            "File", "read", doc=frappe.get_doc("File", other.name)
        ):
            return
    if not membership():
        frappe.local.flags.taskboard_download_denied = True
        frappe.throw(
            "You do not have access to this attachment.", frappe.PermissionError
        )
    if not any(
        frappe.db.exists("TB Attachment", {"file": name, "removed": 0})
        for name in files
    ):
        frappe.local.flags.taskboard_download_denied = True
        frappe.throw("This attachment is no longer available.", frappe.PermissionError)


def download_status(response, request):
    # Frappe v14 can render permission error pages with HTTP 200.
    if frappe.local.flags.get("taskboard_download_denied"):
        response.status_code = 403


def file_query_condition(user=None):
    if not membership(user):
        return "COALESCE(`tabFile`.attached_to_doctype, '') != 'TB Card'"
    return "NOT EXISTS (SELECT 1 FROM `tabTB Attachment` a WHERE a.file=`tabFile`.name AND a.removed=1)"


def todo_query_condition(user=None):
    return (
        ""
        if membership(user)
        else "COALESCE(`tabToDo`.reference_type, '') != 'TB Card'"
    )
