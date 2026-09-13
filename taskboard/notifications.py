"""Transactional outbox: card saves never depend on SMTP availability."""

import hashlib
import frappe
from frappe.utils import nowdate, add_days, getdate, get_url, escape_html
from taskboard.permissions import membership


def notice(recipient, kind, subject, body, event_key, card=None, invitation=None):
    event_key = hashlib.sha256(event_key.encode()).hexdigest()
    if recipient == "Administrator":
        return
    if frappe.db.exists("TB Notice", {"event_key": event_key}):
        return
    return frappe.get_doc(
        dict(
            doctype="TB Notice",
            recipient=recipient,
            kind=kind,
            subject=subject[:140],
            body=body,
            event_key=event_key,
            card=card,
            invitation=invitation,
        )
    ).insert(ignore_permissions=True)


def card_notice(recipient, kind, card, event_key, message):
    link = app_url("/taskboard?card=" + card.name)
    return notice(
        recipient,
        kind,
        f"{kind}: {card.title}",
        f'<p>{escape_html(message)}</p><p><a href="{escape_html(link)}">{escape_html(card.title)}</a></p>',
        event_key,
        card=card.name,
    )


def due_reminders():
    days = frappe.db.get_single_value("TB Settings", "reminder_days") or 1
    end = add_days(nowdate(), int(days))
    for card in frappe.get_all(
        "TB Card",
        filters={
            "archived": 0,
            "completed": 0,
            "due_date": ["between", [nowdate(), end]],
        },
        fields=["name", "title", "due_date"],
    ):
        for user in frappe.get_all(
            "ToDo",
            filters={
                "reference_type": "TB Card",
                "reference_name": card.name,
                "status": "Open",
            },
            pluck="allocated_to",
        ):
            if membership(user):
                # One advance reminder and one due-today reminder per schedule/recipient.
                phase = (
                    "today"
                    if getdate(card.due_date) == getdate(nowdate())
                    else "upcoming"
                )
                card_notice(
                    user,
                    "Reminder",
                    card,
                    f"reminder:{card.name}:{card.due_date}:{phase}:{user}",
                    f"Due {card.due_date}: {card.title}",
                )


def dispatch():
    if not frappe.db.exists(
        "Email Account", {"enable_outgoing": 1, "default_outgoing": 1}
    ):
        return
    for item in frappe.get_all(
        "TB Notice", filters={"state": "Pending"}, pluck="name", limit_page_length=100
    ):
        frappe.db.sql("SELECT name FROM `tabTB Notice` WHERE name=%s FOR UPDATE", item)
        doc = frappe.get_doc("TB Notice", item)
        if doc.state != "Pending":
            continue
        valid = should_deliver(doc)
        if not valid:
            doc.db_set("state", "Skipped", update_modified=False)
            continue
        frappe.db.savepoint("taskboard_notice")
        try:
            frappe.sendmail(
                recipients=[doc.recipient],
                subject=doc.subject,
                message=doc.body,
                reference_doctype="TB Notice",
                reference_name=doc.name,
                delayed=True,
                add_unsubscribe_link=0,
            )
            doc.db_set("state", "Queued", update_modified=False)
        except Exception:
            frappe.db.rollback(save_point="taskboard_notice")
            frappe.log_error(frappe.get_traceback(), "Taskboard email queue")


def tick():
    if "taskboard" not in frappe.get_installed_apps():
        return
    key = "taskboard:" + frappe.conf.db_name
    if not frappe.db.sql("SELECT GET_LOCK(%s, 0)", (key,))[0][0]:
        return
    try:
        due_reminders()
        dispatch()
    finally:
        frappe.db.sql("SELECT RELEASE_LOCK(%s)", (key,))


def should_deliver(doc):
    valid = doc.state != "Skipped"
    if doc.kind == "Invitation":
        if not doc.invitation or not frappe.db.exists("TB Invitation", doc.invitation):
            return False
        invite = frappe.get_doc("TB Invitation", doc.invitation)
        from frappe.utils import get_datetime, now_datetime

        return (
            valid
            and invite.status == "Pending"
            and get_datetime(invite.expires_at) > now_datetime()
        )
    member = membership(doc.recipient)
    valid = valid and bool(member and member.email_notifications)
    if doc.kind in ("Assignment", "Reminder") and doc.card:
        card = frappe.get_doc("TB Card", doc.card)
        valid = (
            valid
            and not card.archived
            and bool(
                frappe.db.exists(
                    "ToDo",
                    {
                        "reference_type": "TB Card",
                        "reference_name": doc.card,
                        "allocated_to": doc.recipient,
                        "status": "Open",
                    },
                )
            )
        )
        if doc.kind == "Reminder":
            keys = [
                hashlib.sha256(
                    f"reminder:{doc.card}:{card.due_date}:{phase}:{doc.recipient}".encode()
                ).hexdigest()
                for phase in ("today", "upcoming")
            ]
            valid = valid and not card.completed and doc.event_key in keys
    return valid


def app_url(path):
    base = frappe.conf.get("taskboard_url")
    return base.rstrip("/") + path if base else get_url(path)
