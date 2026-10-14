import frappe
from frappe.model.document import Document
from frappe.utils import getdate


class Card(Document):
    def validate(self):
        self.title = (self.title or "").strip()
        if not self.title or len(self.title) > 500:
            frappe.throw("A card title must be between 1 and 500 characters.")
        if len(self.description or "") > 100000:
            frappe.throw("Description is too long.")
        if (
            self.start_date
            and self.due_date
            and getdate(self.start_date) > getdate(self.due_date)
        ):
            frappe.throw("Due date must be on or after the start date.")
        column = frappe.get_doc("TB List", self.list_id)
        if column.archived and not self.archived:
            frappe.throw("Restore the list before moving cards into it.")
        if self.is_new() or self.has_value_changed("list_id"):
            self.completed = column.is_done

    def on_update(self):
        from taskboard.api import publish_change

        publish_change(self.name)
        if self.flags.in_insert or self.has_value_changed("description"):
            from taskboard.references import sync_links

            self.flags.taskboard_new_references = sync_links(
                self.name, self.description, "description"
            )

    def on_trash(self):
        # Only this card's outgoing links go. Incoming rows are kept (to_card is
        # a plain Data field) so a comment that still references a deleted card
        # keeps resolving to an "unavailable" entry without rescanning comments.
        for name in frappe.get_all(
            "TB Card Link", filters={"from_card": self.name}, pluck="name"
        ):
            frappe.delete_doc("TB Card Link", name, ignore_permissions=True, force=True)
