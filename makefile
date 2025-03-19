server:
	hugo server --renderToMemory
build:
	hugo --minify --ignoreCache --cleanDestinationDir --gc
	npx -y pagefind --site public
sub:
	git submodule update --init --recursive
