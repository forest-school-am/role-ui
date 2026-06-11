set dotenv-path := "docker/.env"

# Manage authentik test-stand
mod authentik

# Manage local application
mod app

# Show this help
[default]
help:
    @just --list


