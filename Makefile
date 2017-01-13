BASE=/Volumes/Threading/aclweb-data
VOLUMES=$(shell cat conferences.yaml | yaml2json | jq -r '.[] | .volumes | .[]')
PDFS=$(shell cat $(BASE)/?/???/index.html.json | jq -r '.[].pdf.url' | sed s%https://www.aclweb.org/anthology/%%g | egrep '^.{18}$$')

all: all-index all-index-json all-pdf

# %.pdf.json: %.pdf $(NODE_PATH)/pdfi
# 	$(NODE_PATH)/pdfi paper $< >$@

# %.pdf.linked.json: %.pdf.json $(NODE_PATH)/academia
# 	$(NODE_PATH)/academia link $< -o $@

# %.bib.json: %.bib $(NODE_PATH)/tex-node
# 	$(NODE_PATH)/tex-node bib-json $< >$@

### Downloading original sources

$(BASE)/%/index.html:
	@mkdir -p $(@D)
	curl -s https://aclweb.org/anthology/$*/ >$@

# Download all the index listings
all-index: $(VOLUMES:%=$(BASE)/%/index.html)

$(BASE)/%/index.html.json: $(BASE)/%/index.html
	node parse-index.js $* <$< >$@

# Parse all the index listings
all-index-json: $(VOLUMES:%=$(BASE)/%/index.html.json)

$(BASE)/%.pdf:
	@mkdir -p $(@D)
	curl -s https://aclweb.org/anthology/$*.pdf >$@

# Download all of the PDFs
all-pdf: $(PDFS:%=$(BASE)/%)
