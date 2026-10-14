"""Card references: `#[card_name]` tokens in descriptions and comments."""

import re

import frappe
from markdown_it import MarkdownIt
from taskboard.permissions import membership

REFERENCE_RE = re.compile(r"#\[([^\]\s]{1,140})\]")
# Bound the work a single description/comment can cause (existence checks,
# link rows, payload size) while the board lock is held.
MAX_REFERENCES = 100
# "What is code / prose" comes from a real CommonMark parser (the renderer uses
# micromark through react-markdown), not hand-rolled rules.
_MD = MarkdownIt("commonmark", {"html": False}).enable(["table", "strikethrough"])
# Keep backslash escapes as separate `text_special` tokens so an escaped
# `\#[id]` is not merged back into a reference.
_MD.disable("text_join")


def _prose_runs(text):
    """Yield the text of prose runs in `text`: not code blocks, inline code,
    escaped characters or link text."""
    for token in _MD.parse(text or ""):
        if token.type != "inline":
            continue
        in_link = 0
        for child in token.children or []:
            if child.type == "link_open":
                in_link += 1
            elif child.type == "link_close":
                in_link -= 1
            elif child.type == "text" and not in_link:
                yield child.content


def parse_references(text):
    """Distinct referenced ids in prose, in first-appearance order."""
    found = []
    for run in _prose_runs(text):
        found.extend(REFERENCE_RE.findall(run))
    return list(dict.fromkeys(found))[:MAX_REFERENCES]


def sync_links(card, text, source, source_name=None):
    """Make TB Card Link rows for one source match `text`. Returns newly added ids."""
    source_name = source_name or ""
    tokens = [r for r in parse_references(text) if r != card]
    wanted = tokens
    if tokens:
        # One query instead of one existence check per token.
        real = set(
            frappe.get_all("TB Card", filters={"name": ["in", tokens]}, pluck="name")
        )
        wanted = [r for r in tokens if r in real]
    # A token whose target was deleted keeps its existing row (the board reads
    # comment references from this table and shows an "unavailable" entry), but
    # no new row is created for it.
    keep = set(tokens)
    existing = frappe.get_all(
        "TB Card Link",
        filters={"from_card": card, "source": source, "source_name": source_name},
        fields=["name", "to_card"],
        order_by="creation",
    )
    have = set()
    for row in existing:
        # Remove stale rows and any duplicates left by concurrent saves.
        if row.to_card in keep and row.to_card not in have:
            have.add(row.to_card)
        else:
            frappe.delete_doc(
                "TB Card Link", row.name, ignore_permissions=True, force=True
            )
    added = [r for r in wanted if r not in have]
    for ref in added:
        frappe.get_doc(
            dict(
                doctype="TB Card Link",
                from_card=card,
                to_card=ref,
                source=source,
                source_name=source_name,
            )
        ).insert(ignore_permissions=True)
    return added


def clear_comment_links(card, comment):
    return sync_links(card, "", "comment", comment)


def _redacted(name):
    return {
        "name": name,
        "title": "",
        "list_id": "",
        "list_title": "",
        "is_done": False,
        "completed": False,
        "archived": False,
        "exists": False,
    }


def reference_payload(names, cards=None, lists=None):
    """Build reference objects for `names`, preserving order.

    `cards` / `lists` are optional prefetched {name: row} maps (board payload);
    otherwise one batched query per doctype is made.
    """
    names = list(dict.fromkeys(names))
    if not names:
        return []
    if not membership():
        return [_redacted(n) for n in names]
    if cards is None:
        cards = {
            c.name: c
            for c in frappe.get_all(
                "TB Card",
                filters={"name": ["in", names]},
                fields=["name", "title", "list_id", "completed", "archived"],
            )
        }
    if lists is None:
        ids = {c.list_id for c in cards.values()}
        lists = {
            r.name: r
            for r in frappe.get_all(
                "TB List",
                filters={"name": ["in", list(ids)]} if ids else {"name": ""},
                fields=["name", "title", "is_done"],
            )
        }
    # A token that never named a card (a typo) is not a reference: only keep
    # tokens whose card exists or that still have a retained link row (deleted).
    missing = [n for n in names if n not in cards]
    if missing:
        retained = set(
            frappe.get_all(
                "TB Card Link", filters={"to_card": ["in", missing]}, pluck="to_card"
            )
        )
        names = [n for n in names if n in cards or n in retained]
    out = []
    for name in names:
        card = cards.get(name)
        if not card:
            out.append(_redacted(name))
            continue
        column = lists.get(card.list_id)
        out.append(
            {
                "name": name,
                "title": card.title,
                "list_id": card.list_id,
                "list_title": column.title if column else "",
                "is_done": bool((column and column.is_done) or card.completed),
                "completed": bool(card.completed),
                "archived": bool(card.archived),
                "exists": True,
            }
        )
    return out


def backlinks(name):
    if not membership():
        return []
    rows = frappe.db.sql(
        """SELECT l.from_card, l.source, c.title, c.archived, t.title AS list_title
        FROM `tabTB Card Link` l
        JOIN `tabTB Card` c ON c.name=l.from_card
        LEFT JOIN `tabTB List` t ON t.name=c.list_id
        WHERE l.to_card=%s AND l.from_card != %s
        ORDER BY l.creation, l.name""",
        (name, name),
        as_dict=True,
    )
    found = {}
    for row in rows:
        item = found.get(row.from_card)
        if not item:
            found[row.from_card] = {
                "name": row.from_card,
                "title": row.title,
                "list_title": row.list_title or "",
                "source": row.source,
                "archived": bool(row.archived),
            }
        elif row.source == "description":
            item["source"] = "description"
    items = list(found.values())
    active = [i for i in items if not i["archived"]]
    return active or items
