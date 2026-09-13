"""Scoped runner for sites whose global Frappe scheduler is intentionally disabled.

Run: python -m taskboard.service --site SITE
Only Taskboard notices are processed. Existing ERP jobs and email are untouched.
"""

import argparse
import os
from pathlib import Path
import frappe


def run(site):
    os.chdir(Path(__file__).resolve().parents[3] / "sites")
    frappe.init(site=site)
    try:
        frappe.connect()
        frappe.set_user("Administrator")
        # Prevent overlap with either this timer or the normal Frappe scheduler.
        if not frappe.db.sql(
            "SELECT GET_LOCK(%s, 0)", ("taskboard:" + frappe.conf.db_name,)
        )[0][0]:
            return
        from taskboard.notifications import tick, should_deliver

        tick()
        frappe.db.commit()
        if frappe.are_emails_muted():
            return
        from frappe.email.doctype.email_queue.email_queue import get_email_retry_limit

        for name in frappe.get_all(
            "Email Queue",
            filters={
                "reference_doctype": "TB Notice",
                "status": ["in", ["Not Sent", "Partially Sent", "Error"]],
            },
            pluck="name",
            limit_page_length=100,
        ):
            queue = frappe.get_doc("Email Queue", name)
            if not frappe.db.exists("TB Notice", queue.reference_name):
                continue
            notice = frappe.get_doc("TB Notice", queue.reference_name)
            if not should_deliver(notice):
                notice.db_set("state", "Skipped")
                continue
            if queue.status == "Error":
                if (queue.retry or 0) >= get_email_retry_limit():
                    continue
                queue.db_set("status", "Not Sent")
            try:
                queue.send()
            except Exception:
                frappe.log_error(frappe.get_traceback(), "Taskboard email delivery")
            frappe.db.commit()
        frappe.db.commit()
    except Exception:
        if getattr(frappe.local, "db", None):
            frappe.db.rollback()
        raise
    finally:
        if getattr(frappe.local, "db", None):
            frappe.db.sql(
                "SELECT RELEASE_LOCK(%s)", ("taskboard:" + frappe.conf.db_name,)
            )
        frappe.destroy()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", required=True)
    run(parser.parse_args().site)
