package certs

import (
	"bytes"
	"testing"
)

func TestPoolContainsLetsEncryptRoot(t *testing.T) {
	if _, err := Pool(); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(bundle, []byte("ISRG Root X1")) {
		t.Fatal("bundle lacks ISRG Root X1 (Let's Encrypt), the root Coolify/Traefik certificates chain to")
	}
}
