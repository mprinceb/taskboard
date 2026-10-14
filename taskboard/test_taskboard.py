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
            {"title": "Integration test", "list_id": self.column, **values}
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

    def test_timeline_reschedule_resize_and_list_move(self):
        card = self.card(start_date="2026-09-14", due_date="2026-09-17", assignees=[self.member])
        moved = api.save_card(dict(name=card.name, modified=str(card.modified), start_date="2026-09-16", due_date="2026-09-19", list_id=self.done))["card"]
        self.assertEqual(str(moved.start_date), "2026-09-16")
        self.assertEqual(str(moved.due_date), "2026-09-19")
        self.assertTrue(moved.completed)
        todo = frappe.db.get_value("ToDo", {"reference_name": card.name}, ["date", "status"], as_dict=True)
        self.assertEqual(str(todo.date), "2026-09-19")
        self.assertEqual(todo.status, "Closed")
        with self.assertRaises(frappe.TimestampMismatchError):
            api.save_card(dict(name=card.name, modified=str(card.modified), due_date="2026-09-21"))
        resized = api.save_card(dict(name=card.name, modified=str(moved.modified), due_date="2026-09-22", list_id=self.column))["card"]
        self.assertEqual(str(resized.start_date), "2026-09-16")
        self.assertEqual(str(resized.due_date), "2026-09-22")
        self.assertFalse(resized.completed)
        todo = frappe.db.get_value("ToDo", {"reference_name": card.name}, ["date", "status"], as_dict=True)
        self.assertEqual(str(todo.date), "2026-09-22")
        self.assertEqual(todo.status, "Open")

    def test_manual_completion_survives_edits_and_reordering(self):
        c = self.card(assignees=[self.member], due_date="2026-09-20")
        frappe.set_user(self.member)
        completed = api.save_card(dict(name=c.name, modified=str(c.modified), completed=1))["card"]
        self.assertEqual(completed.list_id, self.column)
        self.assertTrue(completed.completed)
        self.assertEqual(frappe.db.get_value("ToDo", {"reference_name": c.name}, "status"), "Closed")
        with self.assertRaises(frappe.TimestampMismatchError):
            api.save_card(dict(name=c.name, modified=str(c.modified), completed=0))
        edited = api.save_card(dict(name=c.name, modified=str(completed.modified), title="Still complete", due_date="2026-09-22"))["card"]
        self.assertTrue(edited.completed)
        api.move_card(c.name, self.column, modified=str(edited.modified))
        self.assertTrue(api.detail(c.name)["card"].completed)
        frappe.set_user(self.admin)
        api.save_list(dict(name=self.column, title="Renamed " + self.suffix))
        self.assertTrue(api.detail(c.name)["card"].completed)
        current = api.detail(c.name)["card"]
        reopened = api.save_card(dict(name=c.name, modified=str(current.modified), completed=0))["card"]
        self.assertFalse(reopened.completed)
        self.assertEqual(reopened.list_id, self.column)
        self.assertEqual(api.assignees(c.name), [self.member])
        self.assertEqual(frappe.db.get_value("ToDo", {"reference_name": c.name}, "status"), "Open")
        api.save_list(dict(name=self.column, is_done=1))
        self.assertTrue(api.detail(c.name)["card"].completed)

    def test_create_at_insertion_point_and_reject_moved_target(self):
        first = self.card()
        last = self.card()
        middle = self.card(before=last.name, description="Inserted detail", assignees=[self.member])
        top = self.card(before=first.name)
        def order():
            return frappe.get_all("TB Card", filters={"list_id": self.column, "archived": 0}, pluck="name", order_by="position, creation")
        self.assertEqual(order(), [top.name, first.name, middle.name, last.name])
        self.assertEqual(api.detail(middle.name)["card"].description, "Inserted detail")
        self.assertEqual(api.assignees(middle.name), [self.member])
        another = self.card(before=last.name)
        self.assertEqual(order(), [top.name, first.name, middle.name, another.name, last.name])
        positions = frappe.get_all("TB Card", filters={"list_id": self.column}, pluck="position")
        self.assertEqual(len(positions), len(set(positions)))
        api.move_card(last.name, self.done)
        count = frappe.db.count("TB Card")
        with self.assertRaises(frappe.ValidationError):
            self.card(before=last.name)
        self.assertEqual(frappe.db.count("TB Card"), count)
        api.save_card(dict(name=first.name, archived=1))
        with self.assertRaises(frappe.ValidationError):
            self.card(before=first.name)
        self.assertEqual(frappe.db.count("TB Card"), count)

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


    # Card references: #[card_name] tokens in descriptions and comments.

    def links(self, **filters):
        return frappe.get_all(
            "TB Card Link", filters=filters, fields=["from_card", "to_card", "source", "source_name"]
        )

    def test_parse_references(self):
        from taskboard.references import parse_references

        self.assertEqual(
            parse_references("a #[abc] b #[def] #[abc] #[] #[ x ] @[u@x.y]"),
            ["abc", "def"],
        )
        self.assertEqual(parse_references(None), [])

    def test_parse_references_ignores_markdown_code(self):
        from taskboard.references import parse_references

        text = (
            "real #[aaa111] and `#[bbb222]` and ``a #[ccc333] b``\n"
            "```\n#[ddd444]\n```\n"
            "~~~js\n#[eee555]\n~~~\n"
            "after #[fff666]"
        )
        self.assertEqual(parse_references(text), ["aaa111", "fff666"])

    def test_sync_idempotent_and_ignores_invalid(self):
        a, b = self.card(), self.card(title="Target")
        text = f"See #[{b.name}] and #[{b.name}] and #[{a.name}] and #[nope123456]"
        api.save_card({"name": a.name, "description": text})
        rows = self.links(from_card=a.name)
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0].to_card, rows[0].source), (b.name, "description"))
        api.save_card({"name": a.name, "description": text + " again"})
        self.assertEqual(len(self.links(from_card=a.name)), 1)
        api.save_card({"name": a.name, "description": "gone"})
        self.assertEqual(self.links(from_card=a.name), [])

    def test_comment_links_and_delete_cleanup(self):
        a, b = self.card(), self.card(title="Target")
        name = api.save_comment(a.name, f"ref #[{b.name}]")
        rows = self.links(from_card=a.name, source="comment")
        self.assertEqual([(r.to_card, r.source_name) for r in rows], [(b.name, name)])
        api.save_comment(a.name, f"ref #[{b.name}] edited", name=name)
        self.assertEqual(len(self.links(from_card=a.name)), 1)
        api.save_comment(a.name, "no ref", name=name)
        self.assertEqual(self.links(from_card=a.name), [])
        api.save_comment(a.name, f"again #[{b.name}]", name=name)
        self.assertEqual(len(self.links(from_card=a.name)), 1)
        api.delete_comment(name)
        self.assertEqual(self.links(from_card=a.name), [])

    def test_references_and_backlinks_payload(self):
        a = self.card()
        b = self.card(title="Open target")
        done = self.card(title="Done target")
        api.move_card(done.name, self.done)
        gone = self.card(title="Doomed")
        api.save_card(
            {
                "name": a.name,
                "description": f"#[{done.name}] #[{b.name}] #[{gone.name}]",
            }
        )
        api.save_comment(a.name, f"later #[{b.name}] #[{gone.name}]")
        keys = {
            "name", "title", "list_id", "list_title", "is_done",
            "completed", "archived", "exists",
        }
        detail = api.detail(a.name)
        refs = detail["references"]
        self.assertEqual([r["name"] for r in refs], [done.name, b.name, gone.name])
        for r in refs:
            self.assertEqual(set(r), keys)
        self.assertTrue(refs[0]["is_done"] and refs[0]["completed"])
        self.assertEqual(refs[0]["list_title"], "Done " + self.suffix)
        self.assertFalse(refs[1]["is_done"])
        self.assertEqual(refs[1]["list_id"], self.column)
        self.assertTrue(refs[1]["exists"])
        # Deleted target keeps the token but is redacted.
        frappe.delete_doc("TB Card", gone.name, force=True, ignore_permissions=True)
        refs = api.detail(a.name)["references"]
        self.assertEqual(
            refs[2],
            {
                "name": gone.name, "exists": False, "title": "", "list_id": "",
                "list_title": "", "is_done": False, "completed": False,
                "archived": False,
            },
        )
        back = api.detail(b.name)["backlinks"]
        self.assertEqual(
            back,
            [
                {
                    "name": a.name,
                    "title": a.title,
                    "list_title": "Test " + self.suffix,
                    "source": "description",
                    "archived": False,
                }
            ],
        )
        board_card = [c for c in api.board()["cards"] if c.name == a.name][0]
        self.assertEqual([r["name"] for r in board_card["references"]][:3], [done.name, b.name, gone.name])

    def test_backlinks_archived_hidden_unless_only(self):
        a, b = self.card(), self.card(title="Target")
        api.save_card({"name": a.name, "description": f"#[{b.name}]"})
        api.save_card({"name": a.name, "archived": 1})
        self.assertEqual(len(api.detail(b.name)["backlinks"]), 1)
        c = self.card(description=f"#[{b.name}]")
        self.assertEqual([x["name"] for x in api.detail(b.name)["backlinks"]], [c.name])

    def test_non_member_gets_redacted(self):
        from taskboard.references import reference_payload

        a = self.card()
        frappe.set_user(self.outsider)
        self.assertFalse(reference_payload([a.name])[0]["exists"])
        self.assertEqual(reference_payload([a.name])[0]["title"], "")

    def test_reference_notifications_and_dedupe(self):
        target = self.card(title="Target", assignees=[self.member, self.admin])
        src = self.card(title="Source")
        kind = {"kind": "card_reference", "card": src.name}
        api.save_card(
            {"name": src.name, "description": f"see #[{target.name}] @[{self.member}]"}
        )
        # Actor (admin) excluded; member already notified through @mention.
        self.assertEqual(frappe.db.count("TB Notice", kind), 0)
        self.assertEqual(
            frappe.db.count("TB Notice", {"kind": "Mention", "card": src.name}), 1
        )
        other = self.card(title="Other", assignees=[self.member])
        api.save_card({"name": src.name, "description": f"see #[{other.name}]"})
        self.assertEqual(
            frappe.db.get_value(
                "TB Notice", {**kind, "recipient": self.member}, "subject"
            ),
            f"{frappe.utils.get_fullname(self.admin)} referenced Other in Source",
        )
        self.assertEqual(frappe.db.count("TB Notice", kind), 1)
        # Re-saving does not renotify.
        api.save_card({"name": src.name, "description": f"see #[{other.name}] more"})
        self.assertEqual(frappe.db.count("TB Notice", kind), 1)
        # Comment reference notifies once, not on edit.
        name = api.save_comment(src.name, f"#[{target.name}]")
        count = frappe.db.count("TB Notice", kind)
        self.assertEqual(count, 2)
        api.save_comment(src.name, f"#[{target.name}] edit", name=name)
        self.assertEqual(frappe.db.count("TB Notice", kind), count)

    def test_edit_adding_reference_not_suppressed_by_old_mention(self):
        src = self.card(title="Source")
        target = self.card(title="Target", assignees=[self.member])
        name = api.save_comment(src.name, f"hello @[{self.member}]")
        kind = {"kind": "card_reference", "card": src.name}
        self.assertEqual(frappe.db.count("TB Notice", kind), 0)
        # The mention existed before the edit, so only the reference is new.
        api.save_comment(
            src.name, f"hello @[{self.member}] #[{target.name}]", name=name
        )
        self.assertEqual(
            frappe.db.count("TB Notice", {**kind, "recipient": self.member}), 1
        )
        self.assertEqual(
            frappe.db.count("TB Notice", {"kind": "Mention", "card": src.name}), 1
        )

    def test_reference_cap_and_batched_validation(self):
        from taskboard.references import MAX_REFERENCES, parse_references

        tokens = " ".join(f"#[tok{i:05d}]" for i in range(MAX_REFERENCES + 50))
        self.assertEqual(len(parse_references(tokens)), MAX_REFERENCES)
        self.assertEqual(parse_references("#[" + "x" * 141 + "]"), [])
        a, b = self.card(), self.card(title="Real")
        api.save_card({"name": a.name, "description": tokens + f" #[{b.name}]"})
        # Real target past the cap is ignored; nonexistent tokens create no rows.
        self.assertEqual(len(self.links(from_card=a.name)), 0)

    def test_board_keeps_comment_reference_to_deleted_card(self):
        src, target = self.card(title="Source"), self.card(title="Gone")
        api.save_comment(src.name, f"see #[{target.name}]")
        frappe.delete_doc("TB Card", target.name, force=True, ignore_permissions=True)
        row = next(c for c in api.board()["cards"] if c["name"] == src.name)
        self.assertEqual(
            [(r["name"], r["exists"]) for r in row["references"]],
            [(target.name, False)],
        )
        detail = api.detail(src.name)
        self.assertEqual([r["exists"] for r in detail["references"]], [False])

    def test_fence_needs_clean_closer(self):
        from taskboard.references import parse_references

        text = "~~~\n#[aaa111]\n~~~ trailing\n#[bbb222]\n~~~\n#[ccc333]"
        self.assertEqual(parse_references(text), ["ccc333"])

    def test_readded_comment_reference_notifies_again(self):
        src = self.card(title="Source")
        target = self.card(title="Target", assignees=[self.member])
        kind = {"kind": "card_reference", "card": src.name, "recipient": self.member}
        name = api.save_comment(src.name, f"#[{target.name}]")
        self.assertEqual(frappe.db.count("TB Notice", kind), 1)
        api.save_comment(src.name, "removed", name=name)
        api.save_comment(src.name, f"#[{target.name}] back", name=name)
        self.assertEqual(frappe.db.count("TB Notice", kind), 2)
        # Saving without changing the reference must not notify.
        api.save_comment(src.name, f"#[{target.name}] back again", name=name)
        self.assertEqual(frappe.db.count("TB Notice", kind), 2)

    def test_indented_code_is_ignored_but_list_continuation_is_not(self):
        from taskboard.references import parse_references

        text = "para\n\n    #[aaa111]\n\n- item\n\n    #[bbb222]\n\nafter #[ccc333]"
        self.assertEqual(parse_references(text), ["bbb222", "ccc333"])
        self.assertEqual(parse_references("    #[ddd444]"), [])

    def test_deleted_target_keeps_incoming_rows_and_backlinks_cleaned(self):
        a, b = self.card(title="A"), self.card(title="B")
        api.save_comment(a.name, f"see #[{b.name}]")
        api.save_card({"name": b.name, "description": f"back #[{a.name}]"})
        frappe.delete_doc("TB Card", b.name, force=True, ignore_permissions=True)
        # Incoming (A -> B) kept so board can show "unavailable"; B's own links go.
        self.assertEqual(len(self.links(from_card=a.name)), 1)
        self.assertEqual(len(self.links(from_card=b.name)), 0)

    def test_multiline_code_span_is_ignored(self):
        from taskboard.references import parse_references

        text = "`example\n#[aaa111]\ntext` and #[bbb222]"
        self.assertEqual(parse_references(text), ["bbb222"])
        # A span cannot cross a list item or a blank line.
        self.assertEqual(parse_references("- a `x\n- b y` #[ccc333]"), ["ccc333"])
        self.assertEqual(parse_references("`x\n\n#[ddd444]\n\ny`"), ["ddd444"])

