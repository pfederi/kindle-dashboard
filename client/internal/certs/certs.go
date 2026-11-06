// Package certs embeds the Mozilla CA bundle (from https://curl.se/ca/cacert.pem).
//
// The Kindle ships an outdated /etc/ssl bundle. Go would load it as system roots and
// golang.org/x/crypto/x509roots/fallback is only consulted when no system roots exist,
// so the client passes this pool explicitly instead.
package certs

import (
	"crypto/x509"
	_ "embed"
	"errors"
)

//go:embed cacert.pem
var bundle []byte

// Pool returns a certificate pool containing the embedded roots.
func Pool() (*x509.CertPool, error) {
	p := x509.NewCertPool()
	if !p.AppendCertsFromPEM(bundle) {
		return nil, errors.New("certs: embedded bundle contains no certificates")
	}
	return p, nil
}
