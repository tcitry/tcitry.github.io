server:
	hugo server --renderToMemory
build:
	hugo --minify --ignoreCache --cleanDestinationDir --gc
sub:
	git submodule update --init --recursive
