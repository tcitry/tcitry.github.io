# Local default: the private Blog checkout beside the public site repository.
# CI explicitly overrides this with CONTENT_DIR=content after its checkout step.
CONTENT_DIR ?= $(abspath $(CURDIR)/../../Blog)
CONTENT_DEMOS_DIR ?= $(abspath $(CONTENT_DIR)/static/demos)
SITE_DEMOS_DIR ?= $(abspath $(CURDIR)/static/demos)
PAGEFIND_VERSION ?= 1.5.2

sync-content-demos:
	test -d "$(CONTENT_DEMOS_DIR)"
	mkdir -p "$(SITE_DEMOS_DIR)"
	rsync -a --delete "$(CONTENT_DEMOS_DIR)/" "$(SITE_DEMOS_DIR)/"

server: sync-content-demos
	hugo --contentDir "$(CONTENT_DIR)" server --renderToMemory
build:
	$(MAKE) sync-content-demos CONTENT_DIR="$(CONTENT_DIR)"
	hugo --contentDir "$(CONTENT_DIR)" --minify --ignoreCache --cleanDestinationDir --gc
	npx --yes "pagefind@$(PAGEFIND_VERSION)" --site public
deps:
	hugo mod tidy
sub: deps
