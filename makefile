server:
	hugo server --renderToMemory
build:
	hugo --minify --ignoreCache --cleanDestinationDir --gc
	npx -y pagefind --site public
deps:
	hugo mod tidy
sub: deps
