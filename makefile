server:
	hugo server --renderToMemory
build:
	hugo --minify --ignoreCache --cleanDestinationDir
sub:
	git submodule update --init --recursive
