import hashlib
import os
import re
import secrets
from html import escape

import frappe
from frappe.utils import cint, now_datetime, add_days, get_datetime, strip_html
from taskboard.permissions import require_member, membership
from taskboard.notifications import card_notice, notice, app_url
from taskboard.references import (
    backlinks,
    clear_comment_links,
    parse_references,
    reference_payload,
    sync_links,
)


def parse(value, default=None):
    return (
        frappe.parse_json(value)
        if isinstance(value, str)
        else (value if value is not None else default)
    )


def lock_board():
    # Serializes moves, membership transitions and invitation acceptance.
    frappe.db.sql(
        "SELECT field FROM tabSingles WHERE doctype='TB Settings' AND field='board_title' FOR UPDATE"
    )


def publish_change(card=None):
    for user in ["Administrator"] + frappe.get_all(
        "TB Member", filters={"active": 1}, pluck="user"
    ):
        frappe.publish_realtime(
            "taskboard_changed", {"card": card}, user=user, after_commit=True
        )


def card_doc(name):
    require_member()
    return frappe.get_doc("TB Card", name)


def check_version(doc, modified):
    if modified and str(doc.modified) != str(modified):
        frappe.throw(
            "This card changed while you were editing. Reload it before saving.",
            frappe.TimestampMismatchError,
        )


def members():
    rows = frappe.get_all(
        "TB Member", filters={"active": 1}, fields=["name", "user", "role"]
    )
    for row in rows:
        row.update(
            frappe.db.get_value(
                "User", row.user, ["full_name", "user_image"], as_dict=True
            )
            or {}
        )
    return rows


def assignees(name):
    return frappe.get_all(
        "ToDo",
        filters={
            "reference_type": "TB Card",
            "reference_name": name,
            "status": ["!=", "Cancelled"],
        },
        pluck="allocated_to",
    )


@frappe.whitelist()
def board():
    m = require_member()
    settings = frappe.get_single("TB Settings")
    cards = frappe.get_all(
        "TB Card",
        fields=[
            "name",
            "title",
            "description",
            "list_id",
            "position",
            "start_date",
            "due_date",
            "completed",
            "archived",
            "modified",
        ],
        order_by="position, creation",
        limit_page_length=0,
    )
    assignment_map = {}
    for row in frappe.get_all(
        "ToDo",
        filters={"reference_type": "TB Card", "status": ["!=", "Cancelled"]},
        fields=["reference_name", "allocated_to"],
    ):
        assignment_map.setdefault(row.reference_name, []).append(row.allocated_to)
    comments = dict(
        frappe.db.sql(
            "SELECT reference_name,COUNT(*) FROM tabComment WHERE reference_doctype='TB Card' AND comment_type='Comment' GROUP BY reference_name"
        )
    )
    attachments = dict(
        frappe.db.sql(
            "SELECT card,COUNT(*) FROM `tabTB Attachment` WHERE removed=0 GROUP BY card"
        )
    )
    lists = frappe.get_all(
        "TB List",
        fields=["name", "title", "position", "is_done", "archived"],
        order_by="position, creation",
    )
    card_map = {c.name: c for c in cards}
    list_map = {r.name: r for r in lists}
    # One indexed query for every link row (kept in sync on save): comment
    # references come from here, and each card's own rows are the only evidence
    # that a missing target was deleted rather than mistyped. No comment bodies
    # are rescanned on the 15s board poll.
    comment_refs, link_targets = {}, {}
    for source_card, target, source in frappe.db.sql(
        "SELECT from_card,to_card,source FROM `tabTB Card Link` ORDER BY creation,name"
    ):
        link_targets.setdefault(source_card, set()).add(target)
        if source == "comment":
            comment_refs.setdefault(source_card, []).append(target)
    for card in cards:
        card["references"] = reference_payload(
            [
                r
                for r in parse_references(card.description) + comment_refs.get(card.name, [])
                if r != card.name
            ],
            card_map,
            list_map,
            retained=link_targets.get(card.name, set()),
            authorized=True,
        )
        card["assignees"] = assignment_map.get(card.name, [])
        card["comment_count"] = comments.get(card.name, 0)
        card["attachment_count"] = attachments.get(card.name, 0)
    return dict(
        settings=dict(
            board_title=settings.board_title,
            max_upload_mb=settings.max_upload_mb,
            reminder_days=settings.reminder_days,
        ),
        lists=lists,
        cards=cards,
        members=members(),
        user=frappe.session.user,
        role=m.role,
        email_notifications=m.email_notifications,
        notifications=frappe.get_all(
            "TB Notice",
            filters={"recipient": frappe.session.user, "kind": ["!=", "Invitation"]},
            fields=["name", "kind", "subject", "card", "seen", "creation"],
            order_by="creation desc",
            limit_page_length=50,
        ),
    )


@frappe.whitelist()
def detail(name):
    doc = card_doc(name)
    comments = frappe.get_all(
        "Comment",
        filters={
            "reference_doctype": "TB Card",
            "reference_name": name,
            "comment_type": "Comment",
        },
        fields=["name", "content", "owner", "creation", "modified"],
        order_by="creation asc",
    )
    files = frappe.db.sql(
        """SELECT a.name,a.comment,f.file_name,f.file_size,f.file_url,a.owner,a.creation FROM `tabTB Attachment` a JOIN tabFile f ON f.name=a.file WHERE a.card=%s AND a.removed=0 ORDER BY a.creation""",
        name,
        as_dict=True,
    )
    # Comments are stored as escaped text by this app; decode only at the UI boundary.
    from html import unescape

    for comment in comments:
        comment.content = unescape(strip_html(comment.content))
    texts = [doc.description or ""] + [c.content for c in comments]
    refs = [
        r
        for r in dict.fromkeys(x for t in texts for x in parse_references(t))
        if r != name
    ]
    return dict(
        card=doc.as_dict(),
        assignees=assignees(name),
        comments=comments,
        attachments=files,
        references=reference_payload(refs, source=name),
        backlinks=backlinks(name),
    )


@frappe.whitelist(methods=["POST"])
def save_card(data):
    require_member()
    data = parse(data)
    lock_board()
    if data.get("name"):
        doc = card_doc(data["name"])
        check_version(doc, data.get("modified"))
    else:
        doc = frappe.new_doc("TB Card")
        doc.position = (
            frappe.db.get_value(
                "TB Card", {"list_id": data.get("list_id")}, "max(position)"
            )
            or 0
        ) + 1024
    before = data.get("before")
    if before:
        if not doc.is_new():
            frappe.throw("Use the move action to reorder an existing card.")
        target = frappe.db.get_value(
            "TB Card", before, ["list_id", "archived"], as_dict=True
        )
        if not target or target.archived or target.list_id != data.get("list_id"):
            frappe.throw("The target card moved. Refresh and try again.")
    previous_mentions = set(re.findall(r"@\[([^\]]+)\]", doc.description or ""))
    for key in [
        "title",
        "description",
        "list_id",
        "start_date",
        "due_date",
        "archived",
        "completed",
    ]:
        if key in data:
            if key in ("archived", "completed"):
                doc.set(key, 1 if cint(data[key]) else 0)
            else:
                doc.set(
                    key,
                    (data[key] or None)
                    if key in ("start_date", "due_date")
                    else data[key],
                )
    new_mentions = (
        set(re.findall(r"@\[([^\]]+)\]", doc.description or "")) - previous_mentions
    )
    for user in new_mentions:
        if not membership(user):
            frappe.throw("Mentioned users must be active board members.")
    doc.save(ignore_permissions=True)
    if before:
        names = frappe.get_all(
            "TB Card",
            filters={"list_id": doc.list_id, "archived": 0, "name": ["!=", doc.name]},
            pluck="name",
            order_by="position, creation",
        )
        names.insert(names.index(before), doc.name)
        for index, name in enumerate(names):
            frappe.db.set_value(
                "TB Card", name, "position", index * 1024, update_modified=False
            )
    mention_notified = set()
    for user in new_mentions:
        if user != frappe.session.user and card_notice(
            user,
            "Mention",
            doc,
            f"description:{doc.name}:{doc.modified}:{user}",
            f"You were mentioned in the description of {doc.title}.",
        ):
            mention_notified.add(user)
    notify_references(
        doc,
        doc.flags.get("taskboard_new_references") or [],
        f"description:{doc.name}:{doc.modified}",
        mention_notified,
    )
    if "assignees" in data:
        desired = set(data["assignees"])
        if len(desired) > 50:
            frappe.throw("Too many assignees.")
        for user in desired:
            if not membership(user):
                frappe.throw("Assignees must be active board members.")
        old = set(assignees(doc.name))
        for todo in frappe.get_all(
            "ToDo",
            filters={
                "reference_type": "TB Card",
                "reference_name": doc.name,
                "status": ["!=", "Cancelled"],
            },
            fields=["name", "allocated_to"],
        ):
            if todo.allocated_to not in desired:
                frappe.get_doc("ToDo", todo.name).update({"status": "Cancelled"}).save(
                    ignore_permissions=True
                )
        for user in desired - old:
            frappe.get_doc(
                dict(
                    doctype="ToDo",
                    allocated_to=user,
                    assigned_by=frappe.session.user,
                    reference_type="TB Card",
                    reference_name=doc.name,
                    description=escape(doc.title),
                    status="Open",
                    date=doc.due_date,
                )
            ).insert(ignore_permissions=True)
            card_notice(
                user,
                "Assignment",
                doc,
                f"assignment:{doc.name}:{user}:{secrets.token_hex(8)}",
                f"You were assigned to {doc.title}.",
            )
    for todo in frappe.get_all(
        "ToDo",
        filters={
            "reference_type": "TB Card",
            "reference_name": doc.name,
            "status": ["!=", "Cancelled"],
        },
        pluck="name",
    ):
        frappe.get_doc("ToDo", todo).update(
            {"status": "Closed" if doc.completed else "Open", "date": doc.due_date}
        ).save(ignore_permissions=True)
    publish_change(doc.name)
    return detail(doc.name)


@frappe.whitelist(methods=["POST"])
def move_card(name, list_id, before=None, modified=None):
    lock_board()
    doc = card_doc(name)
    check_version(doc, modified)
    column = frappe.get_doc("TB List", list_id)
    if column.archived:
        frappe.throw("This list is archived.")
    names = frappe.get_all(
        "TB Card",
        filters={"list_id": list_id, "archived": 0, "name": ["!=", name]},
        pluck="name",
        order_by="position, creation",
    )
    if before and before not in names:
        frappe.throw("The target card moved. Try again.")
    names.insert(names.index(before) if before else len(names), name)
    for index, item in enumerate(names):
        if item != name:
            frappe.db.set_value(
                "TB Card", item, "position", index * 1024, update_modified=False
            )
    return _move(doc, list_id, names.index(name) * 1024)


# One save never fans out to more than this many referenced cards, so a single
# valid edit cannot hold the board lock for thousands of notice inserts.
MAX_NOTIFIED_TARGETS = 20


def notify_references(doc, added, key, notified=()):
    """Notify assignees of newly referenced cards, skipping the actor and users
    who already got a mention notice from this same save."""
    skip = set(notified) | {frappe.session.user}
    targets = list(dict.fromkeys(added))[:MAX_NOTIFIED_TARGETS]
    if not targets:
        return
    # Three batched queries instead of per-target/per-user lookups.
    titles = {
        c.name: c.title
        for c in frappe.get_all(
            "TB Card", filters={"name": ["in", targets]}, fields=["name", "title"]
        )
    }
    by_target = {}
    for row in frappe.get_all(
        "ToDo",
        filters={
            "reference_type": "TB Card",
            "reference_name": ["in", targets],
            "status": ["!=", "Cancelled"],
        },
        fields=["reference_name", "allocated_to"],
    ):
        by_target.setdefault(row.reference_name, []).append(row.allocated_to)
    candidates = list({u for users in by_target.values() for u in users} - skip)
    if not candidates:
        return
    enabled = set(
        frappe.get_all(
            "User", filters={"name": ["in", candidates], "enabled": 1}, pluck="name"
        )
    )
    members = set(
        frappe.get_all(
            "TB Member",
            filters={"user": ["in", candidates], "active": 1},
            pluck="user",
        )
    )
    valid = enabled & members
    # `added` already means "newly added by this save", so make each addition its
    # own event: a reference removed and later re-added must notify again.
    stamp = frappe.utils.now_datetime().isoformat()
    actor = frappe.utils.get_fullname(frappe.session.user)
    for target in targets:
        if target not in titles:
            continue
        message = f"{actor} referenced {titles[target]} in {doc.title}"
        for user in dict.fromkeys(by_target.get(target, [])):
            if user in skip or user not in valid:
                continue
            # Mirrors card_notice but keeps the plain `card_reference` kind in the subject.
            notice(
                user,
                "card_reference",
                message,
                f'<p>{escape(message)}</p><p><a href="{escape(app_url("/taskboard?card=" + doc.name))}">{escape(doc.title)}</a></p>',
                f"reference:{key}:{target}:{user}:{stamp}",
                card=doc.name,
            )


def _move(doc, list_id, position):
    doc.list_id = list_id
    doc.position = position
    doc.save(ignore_permissions=True)
    for todo in frappe.get_all(
        "ToDo",
        filters={
            "reference_type": "TB Card",
            "reference_name": doc.name,
            "status": ["!=", "Cancelled"],
        },
        pluck="name",
    ):
        frappe.get_doc("ToDo", todo).update(
            {"status": "Closed" if doc.completed else "Open"}
        ).save(ignore_permissions=True)
    return {"name": doc.name}


@frappe.whitelist(methods=["POST"])
def save_list(data):
    require_member(admin=True)
    lock_board()
    data = parse(data)
    doc = (
        frappe.get_doc("TB List", data["name"])
        if data.get("name")
        else frappe.new_doc("TB List")
    )
    if doc.is_new():
        doc.position = (frappe.db.get_value("TB List", {}, "max(position)") or 0) + 1024
    previous_done = cint(doc.is_done)
    for key in ["title", "is_done", "archived"]:
        if key in data:
            doc.set(key, data[key])
    doc.title = (doc.title or "").strip()
    if not doc.title or len(doc.title) > 140:
        frappe.throw("List title must be 1–140 characters.")
    if doc.archived and frappe.db.exists(
        "TB Card", {"list_id": doc.name, "archived": 0}
    ):
        frappe.throw("Move or archive the cards in this list first.")
    doc.save(ignore_permissions=True)
    for name in frappe.get_all("TB Card", filters={"list_id": doc.name}, pluck="name"):
        card = frappe.get_doc("TB Card", name)
        if previous_done != cint(doc.is_done):
            card.completed = doc.is_done
        card.save(ignore_permissions=True)
        for todo in frappe.get_all(
            "ToDo",
            filters={
                "reference_type": "TB Card",
                "reference_name": name,
                "status": ["!=", "Cancelled"],
            },
            pluck="name",
        ):
            frappe.get_doc("ToDo", todo).update(
                {"status": "Closed" if card.completed else "Open"}
            ).save(ignore_permissions=True)
    publish_change()
    return doc.as_dict()


@frappe.whitelist(methods=["POST"])
def reorder_lists(names):
    require_member(admin=True)
    lock_board()
    names = parse(names)
    existing = set(frappe.get_all("TB List", filters={"archived": 0}, pluck="name"))
    if len(names) != len(existing) or set(names) != existing:
        frappe.throw("Lists changed. Refresh and try again.")
    for i, name in enumerate(names):
        frappe.db.set_value("TB List", name, "position", i * 1024)
    publish_change()


@frappe.whitelist(methods=["POST"])
def save_comment(card, content, name=None):
    doc = card_doc(card)
    content = (content or "").strip()
    if not content or len(content) > 20000:
        frappe.throw("Comment must be 1–20,000 characters.")
    if name:
        comment = frappe.get_doc("Comment", name)
        if (
            comment.reference_doctype != "TB Card"
            or comment.reference_name != card
            or comment.owner != frappe.session.user
        ):
            frappe.throw("You can only edit your own comments.", frappe.PermissionError)
        comment.content = escape(content)
        comment.save(ignore_permissions=True)
    else:
        comment = frappe.get_doc(
            dict(
                doctype="Comment",
                comment_type="Comment",
                reference_doctype="TB Card",
                reference_name=card,
                content=escape(content),
            )
        ).insert(ignore_permissions=True)
    added = sync_links(card, content, "comment", comment.name)
    # Explicit mention tokens avoid duplicate native mention emails and preserve app links.
    mentioned = set(re.findall(r"@\[([^\]]+)\]", content))
    mention_notified = set()
    for user in mentioned:
        if not membership(user):
            frappe.throw("Mentioned users must be active board members.")
        # card_notice returns nothing when the (stable) mention key was already
        # used, e.g. a mention that existed before this edit or was removed and
        # re-added: that user got no notice now, so a reference notice is not
        # suppressed for them.
        if user != frappe.session.user and card_notice(
            user,
            "Mention",
            doc,
            f"mention:{comment.name}:{user}",
            f"You were mentioned in a comment on {doc.title}.",
        ):
            mention_notified.add(user)
    notify_references(doc, added, f"comment:{comment.name}", mention_notified)
    publish_change(card)
    return comment.name


@frappe.whitelist(methods=["POST"])
def delete_comment(name):
    require_member()
    doc = frappe.get_doc("Comment", name)
    if doc.reference_doctype != "TB Card" or doc.owner != frappe.session.user:
        frappe.throw("You can only delete your own comments.", frappe.PermissionError)
    # Recoverable redaction; attachments stay on the card.
    doc.content = "[Comment deleted]"
    doc.save(ignore_permissions=True)
    clear_comment_links(doc.reference_name, doc.name)
    publish_change(doc.reference_name)


@frappe.whitelist(methods=["POST"])
def upload(card, comment=None):
    card_doc(card)
    if comment and not frappe.db.exists(
        "Comment",
        {"name": comment, "reference_doctype": "TB Card", "reference_name": card},
    ):
        frappe.throw("Comment does not belong to this card.")
    file = frappe.request.files.get("file")
    if not file:
        frappe.throw("Choose a file to upload.")
    limit = (
        cint(frappe.db.get_single_value("TB Settings", "max_upload_mb") or 40)
        * 1024
        * 1024
    )
    content = file.stream.read(limit + 1)
    if len(content) > limit:
        frappe.throw(f"File exceeds the {limit // 1024 // 1024} MB limit.")
    filename = os.path.basename((file.filename or "attachment").replace("\\", "/"))
    # Files are download-only; reject executable web content served on the session origin.
    if filename.lower().endswith(
        (".html", ".htm", ".svg", ".js", ".mjs", ".xml", ".xhtml")
    ):
        frappe.throw("This file type is not supported. Upload it in a ZIP archive.")
    frappe.flags.taskboard_upload = True
    try:
        doc = frappe.get_doc(
            dict(
                doctype="File",
                file_name=filename,
                is_private=1,
                content=content,
                attached_to_doctype="TB Card",
                attached_to_name=card,
            )
        ).insert(ignore_permissions=True)
    finally:
        frappe.flags.taskboard_upload = False
    if not frappe.db.exists("TB Attachment", {"file": doc.name}):
        frappe.get_doc(
            dict(doctype="TB Attachment", card=card, file=doc.name, comment=comment)
        ).insert(ignore_permissions=True)
    publish_change(card)
    return dict(name=doc.name, file_name=doc.file_name, file_url=doc.file_url)


@frappe.whitelist(methods=["POST"])
def remove_attachment(name):
    m = require_member()
    doc = frappe.get_doc("TB Attachment", name)
    if m.role != "Admin" and doc.owner != frappe.session.user:
        frappe.throw(
            "Only the uploader or an admin can remove this attachment.",
            frappe.PermissionError,
        )
    doc.removed = 1
    doc.save(ignore_permissions=True)
    publish_change(doc.card)


@frappe.whitelist(methods=["POST"])
def invite(email, role="Member"):
    require_member(admin=True)
    lock_board()
    from frappe.utils import validate_email_address

    email = validate_email_address((email or "").strip().lower(), throw=True)
    if not email or role not in ("Member", "Admin"):
        frappe.throw("Enter a valid email and role.")
    if membership(email):
        frappe.throw("This person is already a board member.")
    for old in frappe.get_all(
        "TB Invitation", filters={"email": email, "status": "Pending"}, pluck="name"
    ):
        frappe.db.set_value("TB Invitation", old, "status", "Revoked")
    token = secrets.token_urlsafe(32)
    doc = frappe.get_doc(
        dict(
            doctype="TB Invitation",
            email=email,
            role=role,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            expires_at=add_days(now_datetime(), 7),
            invited_by=frappe.session.user,
        )
    ).insert(ignore_permissions=True)
    link = app_url("/taskboard?invite=" + token)
    notice(
        email,
        "Invitation",
        "You are invited to Taskboard",
        f'<p>You have been invited as a {role}.</p><p><a href="{escape(link)}">Accept invitation</a></p><p>This invitation expires in 7 days.</p>',
        f"invite:{doc.name}",
        invitation=doc.name,
    )
    return {"name": doc.name, "email": email, "status": "Pending"}


def invitation(token):
    if not isinstance(token, str) or len(token) > 100:
        frappe.throw("Invalid invitation.")
    name = frappe.db.get_value(
        "TB Invitation",
        {"token_hash": hashlib.sha256(token.encode()).hexdigest()},
        "name",
    )
    if not name:
        frappe.throw("Invalid invitation.")
    doc = frappe.get_doc("TB Invitation", name)
    if doc.status != "Pending" or get_datetime(doc.expires_at) < now_datetime():
        frappe.throw("This invitation has expired or is no longer available.")
    return doc


@frappe.whitelist(allow_guest=True)
def invitation_info(token):
    doc = invitation(token)
    return dict(
        email=doc.email,
        role=doc.role,
        existing_user=bool(frappe.db.exists("User", doc.email)),
        signed_in=frappe.session.user if frappe.session.user != "Guest" else None,
    )


@frappe.whitelist(allow_guest=True, methods=["POST"])
def accept_invitation(token, full_name=None, password=None):
    lock_board()
    doc = invitation(token)
    if frappe.db.exists("User", doc.email):
        if frappe.session.user != doc.email:
            frappe.throw(
                "Sign in with the invited email address to accept.",
                frappe.PermissionError,
            )
    else:
        if frappe.session.user != "Guest" and frappe.session.user != doc.email:
            frappe.throw(
                "Sign out before creating the invited account.", frappe.PermissionError
            )
        if not full_name or not password or len(password) < 12:
            frappe.throw("Enter your name and a password of at least 12 characters.")
        frappe.get_doc(
            dict(
                doctype="User",
                email=doc.email,
                first_name=full_name[:140],
                enabled=1,
                user_type="Website User",
                send_welcome_email=0,
                new_password=password,
            )
        ).insert(ignore_permissions=True)
    _add_member(doc.email, doc.role)
    doc.status = "Accepted"
    doc.token_hash = hashlib.sha256(secrets.token_bytes(32)).hexdigest()
    doc.save(ignore_permissions=True)
    publish_change()
    return {"accepted": True}


def _add_member(user, role):
    old = frappe.db.get_value("TB Member", {"user": user}, "name")
    m = (
        frappe.get_doc("TB Member", old)
        if old
        else frappe.get_doc(dict(doctype="TB Member", user=user))
    )
    m.role = role
    m.active = 1
    m.save(ignore_permissions=True)
    account = frappe.get_doc("User", user)
    for name in ["Taskboard Member", "Taskboard Admin"]:
        account.roles = [r for r in account.roles if r.role != name]
    account.append(
        "roles", {"role": "Taskboard Admin" if role == "Admin" else "Taskboard Member"}
    )
    account.save(ignore_permissions=True)


@frappe.whitelist()
def invitations():
    require_member(admin=True)
    return frappe.get_all(
        "TB Invitation",
        fields=["name", "email", "role", "status", "expires_at"],
        order_by="creation desc",
        limit_page_length=100,
    )


@frappe.whitelist(methods=["POST"])
def revoke_invitation(name):
    require_member(admin=True)
    lock_board()
    doc = frappe.get_doc("TB Invitation", name)
    if doc.status == "Pending":
        doc.status = "Revoked"
        doc.save(ignore_permissions=True)


@frappe.whitelist(methods=["POST"])
def update_member(user, role=None, active=None):
    require_member(admin=True)
    lock_board()
    if user == frappe.session.user:
        frappe.throw("Ask another admin to change your own membership.")
    name = frappe.db.get_value("TB Member", {"user": user}, "name")
    if not name:
        frappe.throw("Member not found.")
    doc = frappe.get_doc("TB Member", name)
    if role is not None:
        if role not in ("Admin", "Member"):
            frappe.throw("Invalid role.")
        _add_member(user, role)
    if active is not None and not cint(active):
        doc.active = 0
        doc.save(ignore_permissions=True)
        for name in frappe.get_all(
            "ToDo",
            filters={
                "reference_type": "TB Card",
                "allocated_to": user,
                "status": ["!=", "Cancelled"],
            },
            pluck="name",
        ):
            frappe.get_doc("ToDo", name).update({"status": "Cancelled"}).save(
                ignore_permissions=True
            )
    publish_change()


@frappe.whitelist(methods=["POST"])
def settings(data):
    require_member(admin=True)
    data = parse(data)
    doc = frappe.get_single("TB Settings")
    if "board_title" in data:
        title = (data["board_title"] or "").strip()
        if not title or len(title) > 140:
            frappe.throw("Board title must be 1–140 characters.")
        doc.board_title = title
    if "max_upload_mb" in data:
        size = cint(data["max_upload_mb"])
        if size < 1 or size > 1024:
            frappe.throw("Upload limit must be between 1 and 1024 MB.")
        doc.max_upload_mb = size
    doc.save(ignore_permissions=True)
    publish_change()


@frappe.whitelist(methods=["POST"])
def preferences(email_notifications):
    m = require_member()
    if m.get("name"):
        frappe.db.set_value(
            "TB Member", m.name, "email_notifications", cint(email_notifications)
        )


@frappe.whitelist(methods=["POST"])
def mark_seen():
    require_member()
    frappe.db.sql(
        "UPDATE `tabTB Notice` SET seen=1 WHERE recipient=%s", frappe.session.user
    )
