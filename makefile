server:
	hugo -c ~/OneDrive/Blog --config book.config.toml server
gen:
	hugo -c ~/OneDrive/Blog --config book.config.toml
sub:
	git submodule update --init --recursive

