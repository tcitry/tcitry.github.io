server:
	hugo -c ~/Library/Mobile\ Documents/com~apple~CloudDocs/Blog --config book.config.toml server --disableFastRender
gen:
	hugo -c ~/Library/Mobile\ Documents/com~apple~CloudDocs/Blog --config book.config.toml --minify
sub:
	git submodule update --init --recursive

