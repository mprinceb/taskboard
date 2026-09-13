# Optional service examples

Edit the example unit files for your bench path, Unix user, site and bind address. Place configured copies in `/etc/systemd/system/`, reload systemd, then enable the web service and notification timer. Use an HTTPS reverse proxy for shared deployments. Redis unit examples are needed only when Redis is not already managed by your bench. Do not run a second Redis service on occupied bench ports.

The configured units for the current installation are kept outside this repository in the bench `config/taskboard` directory.
