#!/bin/bash

# Script to push the empty main branch to remote repository
# This script should be run by someone with push permissions to the repository

set -e

echo "Pushing empty main branch to remote..."

# Ensure we're in the repository root
cd "$(dirname "$0")"

# Check if main branch exists
if ! git show-ref --verify --quiet refs/heads/main; then
    echo "Error: main branch does not exist locally"
    echo "Please run the following commands first:"
    echo "  git checkout --orphan main"
    echo "  git rm -rf --cached ."
    echo "  git commit --allow-empty -m 'Initial empty commit for main branch'"
    exit 1
fi

# Push main branch to remote
echo "Pushing main branch..."
git push -u origin main

echo "Success! Empty main branch has been pushed to remote."
echo ""
echo "To verify:"
echo "  git ls-remote --heads origin main"
echo ""
echo "To set as default branch, go to:"
echo "  https://github.com/8823-scholar/x-poker-club-managemet/settings/branches"
