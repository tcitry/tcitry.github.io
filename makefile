# Local default: the private Blog checkout beside the public site repository.
# CI explicitly overrides this with CONTENT_DIR=content after its checkout step.
CONTENT_DIR ?= $(abspath $(CURDIR)/../../Blog)
PAGEFIND_VERSION ?= 1.5.2

server:
	hugo --contentDir "$(CONTENT_DIR)" server --renderToMemory
build:
	hugo --contentDir "$(CONTENT_DIR)" --minify --ignoreCache --cleanDestinationDir --gc
	npx --yes "pagefind@$(PAGEFIND_VERSION)" --site public
deps:
	hugo mod tidy
sub: deps
