# Taskboard

A small, open-source task tracker built as a **Frappe app with a React frontend**. One private board per Frappe site, with a familiar column-and-card interface and a timeline. MIT licensed; no ERPNext dependency.

## Features

- Configurable lists; card and list ordering; archive and restore.
- A shared calendar picker for start/due dates in card creation and details, with range highlighting, quick dates, typed-date validation, clearing and keyboard navigation. Apply updates the draft; saving the card persists the dates.
- Hover or focus a card to reveal completion and edit controls; hover or focus the gap between cards to insert a new card at that position. Controls include contextual tooltips.
- Editable comma-separated labels and None/Low/Medium/High/Urgent priority, with label, priority and status filters. Timeline bars show photo/initial avatars with name tooltips, labels, due dates and Markdown checklist progress (including linked task completion). Full card views include a dated activity feed from available change history, comments, attachments and assignments.
- Cards with Markdown descriptions, multiple assignees, optional start/due dates, and completion controls on cards and in card details. Moving to a different list adopts that list’s completion state; ordinary edits and reordering preserve manual completion.
- New cards default to due today. Creating from a timeline day or selected range uses that day or the range end instead; dates can still be edited or cleared before saving.
- Comments, explicit member mentions, and downloadable private attachments on cards or comments.
- Images, videos, PDF, Word, Excel, text, and archive files. No embedded media/document viewer.
- Board and week/two-week/month timeline views, search, assignee/overdue filters, and an unscheduled section.
- Timeline opens in a rolling week around today, with regular 14px two-line titles, 12px date badges and roomy day columns; Week/Two weeks/Month zoom remains available. Instructions and the status legend are available under Guide.
- Readable timeline bars with full title, assigned owners and dates on hover; neutral charcoal workspace, weekend shading, a today line, sticky calendar/status labels, and a browsable list of tasks outside the visible range. Overdue, completed, blocked-status and selected tasks use distinct accents with icons or labels.
- Compact timeline lanes: non-overlapping cards share a row; overlapping ranges stack automatically. Drag cards between dates/lists, resize either edge, or drag unscheduled cards onto dates. Changes save immediately.
- Select empty timeline dates to create a scheduled card. Use Create card for title, list, dates, description and members, or quick-add consecutive cards with Enter on the board.
- Board drag overlays, insertion markers, edge scrolling, and dedicated keyboard/touch drag handles. Escape cancels dragging; failed saves restore the previous position or dates.
- Email invitations with expiring single-use tokens, resend/revoke, existing-user acceptance, and new website-user onboarding.
- App admin/member roles. New Taskboard users do not receive ERPNext or Desk roles.
- Assignment, mention and due-date emails through Frappe Email Queue. Per-user email preferences and an in-app notification list.
- Board refresh every 15 seconds and on window focus. No additional websocket service is required.

## Installation

Tested against **Frappe 14.92.0 / Python 3.10**, with React 18 and Vite 6. Requires a Node version supported by Vite 6. Other Frappe major versions have not been validated.

From an existing bench directory:

```sh
bench get-app --branch main git@github.com:mprinceb/taskboard.git
bench --site YOUR_SITE install-app taskboard
bench build --app taskboard
bench --site YOUR_SITE clear-cache
bench restart
```

`bench get-app` installs the Python package and runs the root package's install hook, which installs the locked React dependencies (including build tools). No separate frontend server or manual `npm install` is needed. `bench get-app` normally also builds assets; the explicit build above is safe to repeat. The machine needs GitHub SSH access for this URL; HTTPS cloning is also supported.

On a development bench, restart `bench start` instead of using `bench restart`. A normal production bench uses its existing web, Redis, scheduler and worker services; the optional dedicated services in this repository are not required.

For later updates, pull the app, refresh dependencies, migrate and rebuild:

```sh
git -C apps/taskboard pull --ff-only
bench setup requirements taskboard
bench --site YOUR_SITE migrate
bench build --app taskboard
bench restart
```

Open **`/taskboard`** on that site and sign in as `Administrator` for initial setup. Invite the first named admin from **Share**; existing users accept while signed in with the invited email. The app does not create a default password or automatically enroll existing ERP users.

Invitations expire after seven days. Resending invalidates the previous link. Users accepting a new account invitation choose a password; existing accounts retain their login credentials and existing roles.

## Email and reminders

Configure a default outgoing **Email Account** in Frappe. Set a correct site `host_name`, or a Taskboard-specific `taskboard_url` origin (for example `https://tasks.example.com`), so emails point to a URL your users can reach. Mail transport credentials remain in Frappe. For example:

```sh
bench --site YOUR_SITE set-config taskboard_url https://staging.example.com
```

Use the site origin without `/taskboard`. Staging sites often mute mail or disable the scheduler: invitations and notification emails require mail to be unmuted, Email Queue to be unsuspended, and scheduler/workers to be running. Enable these only when you intend staging to send email.

With a normal bench deployment, run the standard Frappe scheduler and workers. Taskboard registers a five-minute scheduled job which prepares notices and queues emails; Frappe's normal Email Queue processing sends them.

For a site where the global scheduler is intentionally disabled, this optional command processes **only Taskboard notices and Taskboard Email Queue entries**:

```sh
./env/bin/python -m taskboard.service --site YOUR_SITE
```

It can run from a one-minute systemd timer. It does not enable or execute ERP scheduled jobs or send unrelated queued mail. The runner honors Frappe email muting and queue suspension. Delivery failures follow Frappe's retry limit and appear in Email Queue / Error Log.

Reminders are issued one day before the due date and on the due date, using the site's timezone. Completed/archived cards, removed assignees, changed due dates, disabled members and revoked invitations are rechecked before delivery. A unique hashed event key prevents duplicate notices for the same scheduled event.

## Files and permissions

Default upload limit: **40 MiB**. Align the site's `max_file_size` and reverse proxy request limit with this value plus multipart overhead. The React UI shows progress and upload errors. Files retain their original format; Frappe may strip image metadata as part of its standard file processing.

Uploaded files are private Frappe File records. App endpoints enforce membership on each operation. Additional permission hooks and a request guard cover Frappe v14's owner shortcut on direct downloads. Removed members cannot download files they previously uploaded. Attachment removal hides the association and blocks download; it retains the underlying file for recovery. Comment deletion is a recoverable redaction.

Active web documents/scripts (`html`, `svg`, `js`, `xml`, etc.) must be packaged in a ZIP archive. There is no malware scanning, media transcoding, document rendering, public sharing or Trello import.

Descriptions/comments use Markdown rendered without raw HTML. Mention tokens use `@[email]`, inserted by the member picker. Notices link directly into the React card editor. All business mutations use POST with Frappe session/CSRF protection; stale card edits are rejected instead of overwriting newer changes.

## Development

Frontend source is in `frontend/src`. For development, run `npm run dev` in `frontend` to rebuild on changes, then refresh the Frappe-served page; this preserves same-origin sessions and CSRF protection without a second authentication setup. Build output is under `taskboard/public/ui` and served by `taskboard/www/taskboard.html`. Build timestamps invalidate browser asset caches.

Core DocTypes: TB Settings, TB List, TB Card, TB Member, TB Invitation, TB Notice, TB Attachment. Assignments use native ToDo records; comments and file contents use native Comment and File records.

The optional dedicated HTTP entry point pins requests to one site:

```sh
TASKBOARD_SITE=YOUR_SITE ./env/bin/gunicorn \
  --bind 127.0.0.1:8016 --workers 2 --timeout 180 taskboard.wsgi:application
```

Use your normal HTTPS reverse proxy for deployment. The dedicated entry point serves compiled Taskboard/Frappe assets; private files pass through Frappe permissions.

## Card references

Type `#[<card_name>]` in a card description or comment (for example `#[gbbhu7th7n]`) to reference another card, in the same way `@[user_email]` mentions a member. The raw token is stored in the text and links are tracked in the `TB Card Link` doctype (`from_card`, `to_card`, `source` = `description|comment`, `source_name` = comment id). Self-references, unknown ids and duplicates are ignored; editing or deleting a comment, or editing the description, re-syncs the links.

Only prose counts: tokens inside code blocks, inline code, link text, or written as `\#[id]` are ignored. "Code vs prose" is decided by a real CommonMark parser on each side: `markdown-it-py` on the server (declared in `pyproject.toml`; run `bench setup requirements` after pulling) and the same micromark parser the renderer uses in the frontend. `tests/reference_cases.json` is run by both the backend and frontend test suites so the two cannot drift.

`taskboard.api.detail` adds two keys:

- `references`: every distinct card referenced from the description and comments, in first-appearance order: `{name, title, list_id, list_title, is_done, completed, archived, exists}`. `is_done` is true when the card's list is a done list or the card is completed. A deleted target is returned as `{name, exists: false}` with empty/false remaining fields.
- `backlinks`: cards that reference this one: `{name, title, list_title, source, archived}`, one per referencing card; archived cards are listed only when no active card references this one.

`taskboard.api.board` adds the same `references` list to each card. When a reference is newly added, assignees of the referenced card receive a `card_reference` notice ("<actor> referenced <card> in <card>"), except the acting user and anyone already notified by an `@` mention in the same save. Existing sites get links for existing text through the `backfill_card_links` patch on `bench migrate`.

## Verification

Run integration tests only on a disposable site with `allow_tests: true` and `mute_emails: 1`:

```sh
bench --site TEST_SITE run-tests --module taskboard.test_taskboard --skip-test-records
cd apps/taskboard/frontend && npm test && npm run build
```

The suite covers membership, native read/write permissions, ordering, archive/restore, date validation, completion/reopening, stale edits, comment ownership, mentions, private file access, invitation expiry/resend/replay, new-user Desk isolation, reminder deduplication and stale-reminder suppression.

This implementation was also checked through HTTP for six upload formats and download revocation, through a local SMTP capture server for all four email types, and in Chrome at desktop/mobile widths. Real recipient inbox delivery is not part of those tests.

## Backup and recovery

Use the bench's normal database and file backups (`bench --site YOUR_SITE backup --with-files`). Include `site_config.json` securely so encrypted email credentials remain recoverable. Restore into a separate site before replacing live data. Stop the dedicated service/timer or remove the `/taskboard` reverse-proxy route to withdraw the app without deleting data.

## Intentional first-release limits

One board; no automation builder, subtasks, labels, custom fields, dependencies, time tracking, Trello synchronization or import. Dates are date-only. Timeline dates can be changed directly or through card details. Focus a timeline bar and use Left/Right to move one day (Shift for a week); focus either edge to resize. Focus a board drag handle, press Space, use arrow keys, then Space to drop or Escape to cancel. On touch screens, hold a card briefly to move it or use its drag handle.
