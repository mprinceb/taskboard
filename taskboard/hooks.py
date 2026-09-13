app_name = "taskboard"
app_title = "Taskboard"
app_publisher = "Taskboard contributors"
app_description = "A focused shared task board"
app_email = ""
app_license = "MIT"
required_apps = ["frappe"]
after_install = "taskboard.install.after_install"
website_route_rules = [{"from_route": "/taskboard/<path:app_path>", "to_route": "taskboard"}]
has_permission = {
    "TB Card": "taskboard.permissions.card_permission",
    "TB List": "taskboard.permissions.list_permission",
    "File": "taskboard.permissions.file_permission",
    "Comment": "taskboard.permissions.comment_permission",
    "ToDo": "taskboard.permissions.todo_permission",
}
permission_query_conditions = {
    "TB Card": "taskboard.permissions.query_condition",
    "TB List": "taskboard.permissions.query_condition",
}
doc_events = {
    "File": {"validate": "taskboard.permissions.validate_file"},
    "ToDo": {"validate": "taskboard.permissions.validate_todo"},
}
scheduler_events = {"cron": {"*/5 * * * *": ["taskboard.notifications.tick"]}}
before_request = ["taskboard.permissions.guard_download"]
after_request = ["taskboard.permissions.download_status"]
permission_query_conditions.update(
    {
        "File": "taskboard.permissions.file_query_condition",
        "ToDo": "taskboard.permissions.todo_query_condition",
    }
)
