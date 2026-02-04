MAKEFLAGS += -j10

.PHONY: precommit build test

YEAR ?= $(shell date +%Y)

precommit:
	uv run ruff format
	uv run ruff check

build: precommit
	PYTHONPATH=py uv run python -m gh_trending_analytics build --kind repository --year $(YEAR)
	PYTHONPATH=py uv run python -m gh_trending_analytics build --kind developer --year $(YEAR)

test: precommit
	uv run python -m pytest -q
