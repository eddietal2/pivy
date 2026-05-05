This file is meant to be a reference to useful .venv/python commands; Copy and Paste is king sometimes.

* Virtual Environment Commands:
# Create new venv
python -m venv venv

# Start venv session
./.venv/Scripts/Activate.ps1; python manage.py runserver

* Django Server Commands:
# Start Django Server
python manage.py runserver

# Start ngrok HTTPS server
ngrok http 8000 --domain=jayla-streptococcal-aretha.ngrok-free.dev 

* Unit Testing Commands:
# Run all Unit Test
python manage.py test

# Run Unit Test (entire file - Python)
python manage.py test authentication --keepdb

# Run Unit Test (specific test)
python manage.py test authentication.tests.MagicLinkAuthTests.test_email_change_unauthorized --keepdb

* Git Scripts:
# Check status
clear; git status

# Commit and push
clear; git commit -am "";git push; git status

# View log
clear; git log --oneline

* Docker Commands (Multi-Container Setup):
# Build and start all containers (first time or after changes)
docker compose up --build

# Start containers (after initial build)
docker compose up

# Start specific container
docker compose up [container]

# Stop all containers
docker compose down

# View logs for all services
docker compose logs

# View logs for specific service (e.g., api)
docker compose logs api

# Run Django commands in the API container (e.g., migrations)
docker compose exec api python manage.py migrate

# Run shell in API container for debugging
docker compose exec api bash

# Rebuild and restart a specific service (e.g., api)
docker compose up --build api

# Remove all containers, networks, and volumes (reset everything)
docker compose down -v --remove-orphans
