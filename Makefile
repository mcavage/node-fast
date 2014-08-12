#
# Copyright (c) 2012, Mark Cavage. All rights reserved.

#
# Tools
#
ISTANBUL	:= ./node_modules/.bin/istanbul
FAUCET		:= ./node_modules/.bin/faucet
NPM		:= npm

#
# Files
#
DOC_FILES	 = index.restdown
JS_FILES	:= $(shell find lib test -name '*.js')
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = $(JS_FILES)
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -f tools/jsstyle.conf

include ./tools/mk/Makefile.defs

#
# Repo-specific targets
#
.PHONY: all
all: $(ISTANBUL) $(REPO_DEPS)
	$(NPM) rebuild

$(ISTANBUL): | $(NPM_EXEC)
	$(NPM) install

CLEAN_FILES += ./node_modules ./coverage

.PHONY: test
test: $(ISTANBUL)
	$(ISTANBUL) cover --print none test/test.js | $(FAUCET)

include ./tools/mk/Makefile.deps
include ./tools/mk/Makefile.targ
