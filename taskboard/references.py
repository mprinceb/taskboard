"""Card references: `#[card_name]` tokens in descriptions and comments."""

import re

import frappe
from taskboard.permissions import membership

REFERENCE_RE = re.compile(r"#\[([^\]\s]{1,140})\]")
# Bound the work a single description/comment can cause (existence checks,
# link rows, payload size) while the board lock is held.
MAX_REFERENCES = 100
# Mirror of the frontend's code-span rules (frontend/src/cardrefs.ts mapOutsideCode)
# so a token inside Markdown code is neither rendered nor stored as a link.
INLINE_CODE_RE = re.compile(r"(`+)(?!`)[\s\S]*?[^`]\1(?!`)")


LIST_RE = re.compile(r"^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s")
INDENT_RE = re.compile(r"^(?: {4,}|\t)")


QUOTE_RE = re.compile(r"^\s{0,3}(?:>\s?)+")
LIST_PREFIX_RE = re.compile(r"^\s*(?:[-*+]|\d{1,9}[.)])\s+")
LOOSE_FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})(.*)$")
STRICT_FENCE_RE = re.compile(r"^\s{0,3}(`{3,}|~{3,})(.*)$")
BARE_FENCE_RE = re.compile(r"^(`{3,}|~{3,})(.*)$")


def _fence_of(line, in_list):
    """Match a code fence on `line`, including fences nested in a blockquote or
    list item, where indentation is not limited to 3. Returns
    (marker, rest, quoted, nested) or None."""
    q = QUOTE_RE.match(line)
    body = line[q.end():] if q else line
    loose = bool(q) or in_list
    m = (LOOSE_FENCE_RE if loose else STRICT_FENCE_RE).match(body)
    nested = loose
    if not m:
        lm = LIST_PREFIX_RE.match(body)
        if lm:
            m = BARE_FENCE_RE.match(body[lm.end():])
            nested = True
    if not m:
        return None
    return m.group(1), m.group(2), bool(q), nested


def _code_mask(lines):
    """True for lines that are Markdown code: fenced blocks (with their fences)
    and indented code blocks. An indented line is code only after a blank line
    or another code line and outside a list, where it is list continuation. A
    fence opened inside a blockquote ends where the quote does.
    Mirrors `codeLineMask` in frontend/src/cardrefs.ts."""
    fence, fence_quoted, fence_nested = "", False, False
    prev_blank, in_indented, in_list = True, False, False
    mask = []
    for line in lines:
        if fence and fence_quoted and not QUOTE_RE.match(line):
            fence, fence_quoted, prev_blank = "", False, True
        if fence:
            # A closing fence is the same character, at least as long, and
            # followed only by whitespace (CommonMark); "~~~ x" does not close.
            c = _fence_of(line, fence_nested)
            if (
                c
                and c[0][0] == fence[0]
                and len(c[0]) >= len(fence)
                and not c[1].strip()
            ):
                fence, fence_quoted, prev_blank = "", False, True
            mask.append(True)
            continue
        o = _fence_of(line, in_list)
        if o and not (o[0][0] == "`" and "`" in o[1]):
            fence, fence_quoted, fence_nested = o[0], o[2], o[3]
            in_indented, prev_blank = False, False
            mask.append(True)
            continue
        blank = not line.strip()
        indented = not blank and bool(INDENT_RE.match(line))
        code = False
        if indented and (prev_blank or in_indented) and not in_list:
            code = in_indented = True
        elif not blank:
            in_indented = False
            if not indented:
                in_list = bool(LIST_RE.match(line))
        prev_blank = blank
        mask.append(code)
    return mask


# A new block starts here, so an inline code span cannot continue across it.
BLOCK_START_RE = re.compile(
    r"^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s|^\s{0,3}#{1,6}(?:\s|$)|^\s{0,3}>"
)


def _outside_code(text):
    """Yield paragraphs of `text` with code blocks and inline code removed.

    Inline spans may cross line breaks inside a paragraph (CommonMark), so
    consecutive plain lines are matched together; blank lines, code lines and
    new block starts end a paragraph. Mirrors `mapOutsideCode` in the frontend.
    """
    lines = (text or "").split("\n")
    chunk = []
    for line, code in zip(lines, _code_mask(lines)):
        if code or not line.strip():
            if chunk:
                yield INLINE_CODE_RE.sub(" ", "\n".join(chunk))
                chunk = []
            continue
        if BLOCK_START_RE.match(line) and chunk:
            yield INLINE_CODE_RE.sub(" ", "\n".join(chunk))
            chunk = []
        chunk.append(line)
    if chunk:
        yield INLINE_CODE_RE.sub(" ", "\n".join(chunk))


def parse_references(text):
    """Distinct referenced ids outside Markdown code, in first-appearance order."""
    found = []
    for plain in _outside_code(text):
        for m in REFERENCE_RE.finditer(plain):
            # `\#[id]` is Markdown-escaped literal text, not a reference.
            slashes = len(plain[: m.start()]) - len(plain[: m.start()].rstrip("\\"))
            if slashes % 2 == 0:
                found.append(m.group(1))
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
