import frappe


def after_install():
    for role in ["Taskboard Admin", "Taskboard Member"]:
        if not frappe.db.exists("Role", role):
            frappe.get_doc(dict(doctype="Role", role_name=role, desk_access=0)).insert(
                ignore_permissions=True
            )
        else:
            frappe.db.set_value("Role", role, "desk_access", 0)
    frappe.clear_cache()
    settings = frappe.get_single("TB Settings")
    if not settings.board_title:
        settings.board_title = "Task Tracking"
    settings.max_upload_mb = settings.max_upload_mb or 40
    settings.reminder_days = 1
    settings.save(ignore_permissions=True)
    if not frappe.db.count("TB List"):
        for index, title in enumerate(
            ["Backlog", "TODO", "Ongoing", "Under Review", "Done", "Discussion"]
        ):
            frappe.get_doc(
                dict(
                    doctype="TB List",
                    title=title,
                    position=index * 1024,
                    is_done=title == "Done",
                )
            ).insert(ignore_permissions=True)
