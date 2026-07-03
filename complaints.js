# Copy this file to .env for local testing.
# On Render, set these under Dashboard -> Your Service -> Environment.

PORT=4000

# Comma-separated list of allowed frontend origins. Example:
# ALLOWED_ORIGIN=https://yourusername.github.io
ALLOWED_ORIGIN=*

# Secret used to sign admin login sessions. Set this to a long random string on Render.
JWT_SECRET=change-this-secret-before-production

# The admin password used the very first time the database is created.
# Change it from the Admin Console after your first login.
ADMIN_DEFAULT_PASSWORD=linea@admin123
