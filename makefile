CONTENT_DIR ?= content
PAGEFIND_VERSION ?= 1.5.2

server:
	hugo --contentDir "$(CONTENT_DIR)" server --renderToMemory
build:
	hugo --contentDir "$(CONTENT_DIR)" --minify --ignoreCache --cleanDestinationDir --gc
	npx --yes "pagefind@$(PAGEFIND_VERSION)" --site public
deps:
	hugo mod tidy
sub: deps
