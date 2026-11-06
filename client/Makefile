# All Go commands run in Docker (golang:1.23); no local Go installation is needed.
GO_IMAGE := golang:1.23
DOCKER   := docker run --rm -e GOTOOLCHAIN=local -v "$(CURDIR)":/src -w /src -v kindle-dash-gomod:/go/pkg/mod $(GO_IMAGE)
DIST     := ../dist/kindle

.PHONY: test build dist certs

test:
	$(DOCKER) sh -c 'go vet ./... && go test -race ./...'
	python3 -m unittest discover -s tools -p 'test_*.py'

build:
	$(DOCKER) env GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0 \
		go build -trimpath -ldflags="-s -w" -o bin/dashboard ./cmd/dashboard

dist: build
	rm -rf $(DIST)
	mkdir -p $(DIST)/dashboard $(DIST)/documents
	cp bin/dashboard $(DIST)/dashboard/dashboard
	cp kindle/dashboard/config.example.json $(DIST)/dashboard/config.example.json
	cp kindle/documents/Dashboard.sh kindle/documents/Dashboard-Diagnose.sh kindle/documents/Dashboard-Systeminfo.sh $(DIST)/documents/

certs:
	curl -fsSL https://curl.se/ca/cacert.pem -o internal/certs/cacert.pem
