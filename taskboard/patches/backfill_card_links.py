import frappe

from taskboard.references import sync_links


def execute():
    """Create TB Card Link rows for references already present in text."""
    for card in frappe.get_all("TB Card", fields=["name", "description"]):
        sync_links(card.name, card.description, "description")
    for comment in frappe.get_all(
        "Comment",
        filters={"reference_doctype": "TB Card", "comment_type": "Comment"},
        fields=["name", "reference_name", "content"],
    ):
        if frappe.db.exists("TB Card", comment.reference_name):
            sync_links(
                comment.reference_name, comment.content, "comment", comment.name
            )
