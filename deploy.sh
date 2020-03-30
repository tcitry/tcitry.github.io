#!/bin/sh

# If a command fails then the deploy stops
set -e

printf "\033[0;32mDeploying updates to GitHub...\033[0m\n"

# Build the project.
# hugo # if using a theme, replace with `hugo -t <YOURTHEME>`

# Go To Public folder
cd public
rm -rf .git
git init
git remote add origin git@github.com:tcitry/blog.git
# Add changes to git.
git add .

# Commit changes.
msg="rebuilding site $(date)"
if [ -n "$*" ]; then
	msg="$*"
fi
git commit -m "$msg"

# Push source and build repos.
git push -f origin master

# come back zero
cd ..