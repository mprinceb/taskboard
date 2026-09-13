# Taskboard

A small, open-source task tracker built as a **Frappe app with a React frontend**. One private board per Frappe site, with a familiar column-and-card interface and a timeline. MIT licensed; no ERPNext dependency.

## Features

- Configurable lists; card and list ordering; archive and restore.
- Cards with Markdown descriptions, multiple assignees, optional start/due dates, and completion determined by their list.
- Comments, explicit member mentions, and downloadable private attachments on cards or comments.
- Images, videos, PDF, Word, Excel, text, and archive files. No embedded media/document viewer.
- Board and week/two-week/month timeline views, search, assignee/overdue filters, and an unscheduled section.
- Email invitations with expiring single-use tokens, resend/revoke, existing-user acceptance, and new website-user onboarding.
- App admin/member roles. New Taskboard users do not receive ERPNext or Desk roles.
- Assignment, mention and due-date emails through Frappe Email Queue. Per-user email preferences and an in-app notification list.
- Board refresh every 15 seconds and on window focus. No additional websocket service is required.

## Installation

Tested against **Frappe 14.92.0 / Python 3.10**, with React 18 and Vite 6. Requires a Node version supported by Vite 6. Other Frappe major versions have not been validated.

Clone this repository into `frappe-bench/apps/taskboard`, then from the bench directory:

```sh
./env/bin/pip install -e apps/taskboard --no-deps
# Add taskboard once to sites/apps.txt if not installed using bench get-app.
cd apps/taskboard/frontend
npm ci
npm run build
cd ../../..
bench --site YOUR_SITE install-app taskboard
bench build --app taskboard
bench --site YOUR_SITE clear-cache
```

Open **`/taskboard`** on that site and sign in as `Administrator` for initial setup. Invite the first named admin from **Share**; existing users accept while signed in with the invited email. The app does not create a default password or automatically enroll existing ERP users.

Invitations expire after seven days. Resending invalidates the previous link. Users accepting a new account invitation choose a password; existing accounts retain their login credentials and existing roles.

## Email and reminders

Configure a default outgoing **Email Account** in Frappe. Set a correct site `host_name`, or a Taskboard-specific `taskboard_url` origin (for example `https://tasks.example.com`), so emails point to a URL your users can reach. Mail transport credentials remain in Frappe.

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

## Verification

Run integration tests only on a disposable site with `allow_tests: true` and `mute_emails: 1`:

```sh
bench --site TEST_SITE run-tests --module taskboard.test_taskboard --skip-test-records
cd apps/taskboard/frontend && npm run build
```

The suite covers membership, native read/write permissions, ordering, archive/restore, date validation, completion/reopening, stale edits, comment ownership, mentions, private file access, invitation expiry/resend/replay, new-user Desk isolation, reminder deduplication and stale-reminder suppression.

This implementation was also checked through HTTP for six upload formats and download revocation, through a local SMTP capture server for all four email types, and in Chrome at desktop/mobile widths. Real recipient inbox delivery is not part of those tests.

## Backup and recovery

Use the bench's normal database and file backups (`bench --site YOUR_SITE backup --with-files`). Include `site_config.json` securely so encrypted email credentials remain recoverable. Restore into a separate site before replacing live data. Stop the dedicated service/timer or remove the `/taskboard` reverse-proxy route to withdraw the app without deleting data.

## Intentional first-release limits

One board; no automation builder, subtasks, labels, custom fields, dependencies, time tracking, Trello synchronization or import. Dates are date-only. The timeline is edited through card details. Desktop dragging is complemented by list selectors and list position controls. No public repository has been published automatically.
