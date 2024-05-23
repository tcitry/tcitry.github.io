server:
	hugo server --renderToMemory
build:
	npm run build:prod
	hugo --minify --ignoreCache --cleanDestinationDir --gc
sub:
	git submodule update --init --recursive
