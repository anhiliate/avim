#!/bin/bash
# Build config for build.sh
APP_NAME=avim
CHROME_PROVIDERS="content locale"
CLEAN_UP=1
ROOT_FILES="CHANGELOG LICENSE"
ROOT_DIRS="defaults"
VAR_FILES="install.rdf CHANGELOG LICENSE"
VERSION="20080224.$REV_NUM"
#"*CVS*"
PRUNE_DIRS="*.svn*"
BEFORE_BUILD=
AFTER_BUILD=
