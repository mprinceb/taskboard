"""Integration tests. Run only on a disposable, mail-muted site."""

import io
import re
import secrets
import unittest
from unittest.mock import patch
import frappe
from frappe.utils import add_days, now_datetime, nowdate
from werkzeug.datastructures import FileStorage
from taskboard import api
from taskboard.notifications import due_reminders, dispatch


class TestTaskboard(unittest.TestCase):
    def setUp(self):
        if not frappe.conf.mute_emails:
            raise RuntimeError("Tests require mute_emails=1 on a disposable site")
        self.previous = frappe.session.user
        frappe.set_user("Administrator")
        self.suffix = secrets.token_hex(5)
        self.admin = self.user("admin")
        self.member = self.user("member")
        self.outsider = self.user("outsider")
        api._add_member(self.admin, "Admin")
        api._add_member(self.member, "Member")
        frappe.set_user(self.admin)
        self.column = api.save_list({"title": "Test " + self.suffix})["name"]
        self.done = api.save_list({"title": "Done " + self.suffix, "is_done": 1})[
            "name"
        ]

    def tearDown(self):
        frappe.db.rollback()
        frappe.set_user(self.previous)
        frappe.clear_cache()

    def user(self, kind):
        email = f"{kind}-{self.suffix}@example.invalid"
        frappe.get_doc(
            dict(
                doctype="User",
                email=email,
                first_name=kind,
                enabled=1,
                user_type="Website User",
                send_welcome_email=0,
            )
        ).insert(ignore_permissions=True)
        return email

    def card(self, **values):
        return api.save_card(
            dict(title="Integration test", list_id=self.column, **values)
        )["card"]

    def test_permissions_and_membership_removal(self):
        card = self.card()
        frappe.set_user(self.member)
        self.assertEqual(api.detail(card.name)["card"].name, card.name)
        with self.assertRaises(frappe.PermissionError):
            api.save_list({"title": "No"})
        with self.assertRaises(frappe.PermissionError):
            api.invite("unauthorized@example.invalid")
        self.assertFalse(
            frappe.has_permission(
                "TB Card", "write", doc=frappe.get_doc("TB Card", card.name)
            )
        )
        frappe.set_user(self.outsider)
        with self.assertRaises(frappe.PermissionError):
            api.board()
        self.assertFalse(
            frappe.has_permission(
                "TB Card", "read", doc=frappe.get_doc("TB Card", card.name)
            )
        )
        frappe.set_user(self.admin)
        api.update_member(self.member, active=0)
        frappe.set_user(self.member)
        with self.assertRaises(frappe.PermissionError):
            api.detail(card.name)

    def test_dates_completion_and_stale_edits(self):
        with self.assertRaises(frappe.ValidationError):
            self.card(start_date="2026-09-20", due_date="2026-09-19")
        c = self.card(
            start_date="2026-09-19", due_date="2026-09-20", assignees=[self.member]
        )
        api.move_card(c.name, self.done, modified=str(c.modified))
        self.assertTrue(api.detail(c.name)["card"].completed)
        self.assertIn(self.member, api.assignees(c.name))
        self.assertEqual(
            frappe.db.get_value("ToDo", {"reference_name": c.name}, "status"), "Closed"
        )
        with self.assertRaises(frappe.TimestampMismatchError):
            api.save_card(
                {"name": c.name, "title": "stale", "modified": str(c.modified)}
            )
        api.move_card(c.name, self.column)
        self.assertEqual(
            frappe.db.get_value("ToDo", {"reference_name": c.name}, "status"), "Open"
        )
        with self.assertRaises(frappe.ValidationError):
            api.save_list({"name": self.column, "archived": 1})

    def test_card_order_archive_restore(self):
        a = self.card()
        b = self.card()
        c = self.card()
        api.move_card(c.name, self.column, before=a.name)
        names = frappe.get_all(
            "TB Card",
            filters={"list_id": self.column},
            order_by="position, creation",
            pluck="name",
        )
        self.assertEqual(names, [c.name, a.name, b.name])
        api.save_card({"name": a.name, "archived": 1})
        self.assertEqual(api.detail(a.name)["card"].archived, 1)
        api.save_card({"name": a.name, "archived": 0})
        self.assertEqual(api.detail(a.name)["card"].archived, 0)

    def test_comment_ownership_and_mentions(self):
        c = self.card()
        name = api.save_comment(
            c.name, f"Please review @[{self.member}] <script>alert(1)</script>"
        )
        self.assertEqual(
            frappe.db.count("TB Notice", {"kind": "Mention", "card": c.name}), 1
        )
        api.save_comment(c.name, f"Updated @[{self.member}]", name=name)
        self.assertEqual(
            frappe.db.count("TB Notice", {"kind": "Mention", "card": c.name}), 1
        )
        frappe.set_user(self.member)
        with self.assertRaises(frappe.PermissionError):
            api.save_comment(c.name, "Hijack", name=name)
        with self.assertRaises(frappe.PermissionError):
            api.delete_comment(name)
        frappe.set_user(self.admin)
        api.delete_comment(name)
        self.assertEqual(api.detail(c.name)["comments"][0].content, "[Comment deleted]")

    def test_upload_private_limits_and_revocation(self):
        c = self.card()
        frappe.set_user(self.member)
        content = b"private-test-" + self.suffix.encode()
        with patch.object(
            frappe.local,
            "request",
            frappe._dict(
                files={
                    "file": FileStorage(
                        stream=io.BytesIO(content), filename="notes.pdf"
                    )
                }
            ),
            create=True,
        ):
            result = api.upload(c.name)
        self.assertTrue(result["file_url"].startswith("/private/files/"))
        f = frappe.get_doc("File", result["name"])
        self.assertEqual(
            f.get_content().encode()
            if isinstance(f.get_content(), str)
            else f.get_content(),
            content,
        )
        self.assertTrue(frappe.has_permission("File", "read", doc=f))
        from taskboard.permissions import guard_download

        frappe.set_user(self.admin)
        api.update_member(self.member, active=0)
        frappe.set_user(self.member)
        self.assertFalse(frappe.has_permission("File", "read", doc=f))
        with patch.object(
            frappe.local, "request", frappe._dict(path=result["file_url"]), create=True
        ):
            with self.assertRaises(frappe.PermissionError):
                guard_download()
        frappe.set_user(self.admin)
        with patch.object(
            frappe.local,
            "request",
            frappe._dict(
                files={
                    "file": FileStorage(
                        stream=io.BytesIO(b"<script/>"), filename="evil.html"
                    )
                }
            ),
            create=True,
        ):
            with self.assertRaises(frappe.ValidationError):
                api.upload(c.name)
        attachment = frappe.db.get_value("TB Attachment", {"file": f.name}, "name")
        api.remove_attachment(attachment)
        self.assertEqual(api.detail(c.name)["attachments"], [])

    def test_invitation_expiry_resend_identity_and_replay(self):
        email = self.outsider
        first = api.invite(email)
        body = frappe.db.get_value("TB Notice", {"invitation": first["name"]}, "body")
        token = re.search(r'invite=([^"&]+)', body).group(1)
        self.assertEqual(api.invitation_info(token)["email"], email)
        with self.assertRaises(frappe.PermissionError):
            api.accept_invitation(token)
        second = api.invite(email)
        with self.assertRaises(frappe.ValidationError):
            api.invitation_info(token)
        body = frappe.db.get_value("TB Notice", {"invitation": second["name"]}, "body")
        token = re.search(r'invite=([^"&]+)', body).group(1)
        frappe.set_user(email)
        api.accept_invitation(token)
        self.assertTrue(api.membership(email))
        with self.assertRaises(frappe.ValidationError):
            api.accept_invitation(token)
        frappe.set_user(self.admin)
        i = api.invite("expired-" + self.suffix + "@example.invalid")
        body = frappe.db.get_value("TB Notice", {"invitation": i["name"]}, "body")
        token = re.search(r'invite=([^"&]+)', body).group(1)
        frappe.db.set_value(
            "TB Invitation", i["name"], "expires_at", add_days(now_datetime(), -1)
        )
        with self.assertRaises(frappe.ValidationError):
            api.invitation_info(token)

    def test_reminder_dedup_and_outbox(self):
        c = self.card(due_date=nowdate(), assignees=[self.member])
        due_reminders()
        due_reminders()
        self.assertEqual(
            frappe.db.count("TB Notice", {"card": c.name, "kind": "Reminder"}), 1
        )
        self.assertEqual(
            frappe.db.count("TB Notice", {"card": c.name, "kind": "Assignment"}), 1
        )
        original = frappe.db.exists

        def exists(dt, *args, **kwargs):
            if dt == "Email Account":
                return True
            return original(dt, *args, **kwargs)

        with (
            patch.object(frappe.db, "exists", side_effect=exists),
            patch("frappe.sendmail") as send,
        ):
            dispatch()
            count = send.call_count
            dispatch()
            self.assertEqual(send.call_count, count)
            self.assertGreaterEqual(count, 2)
        api.move_card(c.name, self.done)
        due_reminders()
        self.assertEqual(
            frappe.db.count("TB Notice", {"card": c.name, "kind": "Reminder"}), 1
        )

    def test_new_invitee_has_no_desk_access(self):
        email = "new-" + self.suffix + "@example.invalid"
        invitation = api.invite(email)
        body = frappe.db.get_value(
            "TB Notice", {"invitation": invitation["name"]}, "body"
        )
        token = re.search(r'invite=([^"&]+)', body).group(1)
        frappe.set_user("Guest")
        with self.assertRaises(frappe.ValidationError):
            api.accept_invitation(token, full_name="New Member", password="short")
        api.accept_invitation(
            token, full_name="New Member", password=secrets.token_urlsafe(24)
        )
        self.assertEqual(
            frappe.db.get_value("User", email, "user_type"), "Website User"
        )
        self.assertFalse(frappe.get_doc("User", email).has_desk_access())
        self.assertEqual(api.membership(email).role, "Member")

    def test_rescheduled_reminder_is_not_delivered(self):
        c = self.card(due_date=nowdate(), assignees=[self.member])
        due_reminders()
        n = frappe.db.get_value(
            "TB Notice", {"card": c.name, "kind": "Reminder"}, "name"
        )
        from taskboard.notifications import should_deliver

        self.assertTrue(should_deliver(frappe.get_doc("TB Notice", n)))
        api.save_card({"name": c.name, "due_date": add_days(nowdate(), 10)})
        self.assertFalse(should_deliver(frappe.get_doc("TB Notice", n)))

    def test_description_mentions_and_disabled_members(self):
        c = self.card(description=f"Please review @[{self.member}]")
        self.assertEqual(
            frappe.db.count("TB Notice", {"card": c.name, "kind": "Mention"}), 1
        )
        api.save_card(
            {"name": c.name, "description": f"Please review @[{self.member}] again"}
        )
        self.assertEqual(
            frappe.db.count("TB Notice", {"card": c.name, "kind": "Mention"}), 1
        )
        frappe.db.set_value("User", self.member, "enabled", 0)
        self.assertIsNone(api.membership(self.member))
        with self.assertRaises(frappe.ValidationError):
            api.save_card({"name": c.name, "assignees": [self.member]})
