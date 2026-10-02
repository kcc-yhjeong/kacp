// Package cspframe is a Traefik local plugin (yaegi, stdlib only) that lets the
// KACP agent shell embed the team Gateway's Control UI in an iframe.
//
// OpenClaw serves the Control UI with `X-Frame-Options: DENY` and a CSP that
// contains `frame-ancestors 'none'` next to per-release script hashes. Replacing
// the whole CSP would break on every OpenClaw upgrade, and adding a second CSP
// header cannot widen the policy (browsers intersect policies). So this plugin:
//
//   - removes `X-Frame-Options` from the response, and
//   - rewrites only the `frame-ancestors` directive of `Content-Security-Policy`
//     (and `Content-Security-Policy-Report-Only`) to the configured value,
//     leaving every other directive byte-for-byte untouched.
//
// A policy without `frame-ancestors` is left as is. The rewrite happens once,
// right before the response headers are sent (WriteHeader, or the first
// Write/Flush). The wrapped ResponseWriter passes Hijack and Flush through so
// WebSocket upgrades and streaming responses keep working.
//
// See docs/design/05-urls-and-storage.md §2 (middleware `claw-frame`) and
// docs/spikes/03-iframe-csp.md.
package cspframe

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
)

// DefaultFrameAncestors is used when the config leaves frameAncestors empty.
const DefaultFrameAncestors = "'self'"

const directiveName = "frame-ancestors"

// cspHeaders are the response headers whose frame-ancestors directive is rewritten.
var cspHeaders = []string{
	"Content-Security-Policy",
	"Content-Security-Policy-Report-Only",
}

// Config is the plugin configuration (dynamic config key `frameAncestors`).
type Config struct {
	// FrameAncestors is the source list placed after `frame-ancestors`,
	// for example `'self'` or `'self' https://app.kacp.cloud`.
	FrameAncestors string `json:"frameAncestors,omitempty"`
}

// CreateConfig returns the default configuration. Traefik calls it before
// decoding the user configuration on top.
func CreateConfig() *Config {
	return &Config{}
}

// CSPFrame is the middleware handler.
type CSPFrame struct {
	next  http.Handler
	name  string
	value string
}

// New builds the middleware. It rejects values that would inject extra
// directives or policies into the CSP.
func New(_ context.Context, next http.Handler, config *Config, name string) (http.Handler, error) {
	value := DefaultFrameAncestors
	if config != nil {
		if v := strings.TrimSpace(config.FrameAncestors); v != "" {
			value = v
		}
	}
	if strings.ContainsAny(value, ";,\r\n") {
		return nil, fmt.Errorf("cspframe %q: frameAncestors must not contain ';', ',' or line breaks: %q", name, value)
	}
	return &CSPFrame{next: next, name: name, value: value}, nil
}

func (c *CSPFrame) ServeHTTP(rw http.ResponseWriter, req *http.Request) {
	c.next.ServeHTTP(&responseWriter{rw: rw, value: c.value}, req)
}

// responseWriter rewrites the frame headers once, just before they are sent.
type responseWriter struct {
	rw          http.ResponseWriter
	value       string
	wroteHeader bool
}

func (w *responseWriter) Header() http.Header {
	return w.rw.Header()
}

func (w *responseWriter) WriteHeader(code int) {
	// 1xx informational responses (e.g. 103 Early Hints) may be followed by the
	// final header, so rewrite every time but only mark done on the final one.
	rewriteHeaders(w.rw.Header(), w.value)
	if code >= 200 || code == http.StatusSwitchingProtocols {
		w.wroteHeader = true
	}
	w.rw.WriteHeader(code)
}

func (w *responseWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.rw.Write(b)
}

// Flush implements http.Flusher (server-sent events, streamed responses).
func (w *responseWriter) Flush() {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	if f, ok := w.rw.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack implements http.Hijacker. WebSocket upgrades (Control UI ⇄ Gateway)
// fail without it.
func (w *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := w.rw.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("cspframe: underlying ResponseWriter does not implement http.Hijacker")
	}
	return h.Hijack()
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (w *responseWriter) Unwrap() http.ResponseWriter {
	return w.rw
}

// rewriteHeaders removes X-Frame-Options and rewrites frame-ancestors in place.
func rewriteHeaders(h http.Header, value string) {
	h.Del("X-Frame-Options")
	for _, key := range cspHeaders {
		values := h.Values(key)
		if len(values) == 0 {
			continue
		}
		out := make([]string, len(values))
		for i, v := range values {
			out[i] = RewriteFrameAncestors(v, value)
		}
		h[http.CanonicalHeaderKey(key)] = out
	}
}

// RewriteFrameAncestors returns policy with the source list of every
// `frame-ancestors` directive replaced by value. A header value may hold
// several policies separated by ',' (CSP3 serialization); each policy is a
// ';'-separated list of directives. Directive names are case-insensitive.
// Every other directive, separator and whitespace is kept exactly as received.
// If no frame-ancestors directive exists the policy is returned unchanged.
func RewriteFrameAncestors(policy, value string) string {
	policies := strings.Split(policy, ",")
	changed := false
	for pi, p := range policies {
		directives := strings.Split(p, ";")
		for di, d := range directives {
			trimmed := strings.TrimLeft(d, " \t")
			nameEnd := strings.IndexAny(trimmed, " \t")
			name := trimmed
			if nameEnd >= 0 {
				name = trimmed[:nameEnd]
			}
			if !strings.EqualFold(name, directiveName) {
				continue
			}
			// Keep the leading whitespace and any trailing whitespace before
			// the next ';' so the rest of the header is unchanged.
			leading := d[:len(d)-len(trimmed)]
			trailing := d[len(strings.TrimRight(d, " \t")):]
			directives[di] = leading + directiveName + " " + value + trailing
			changed = true
		}
		policies[pi] = strings.Join(directives, ";")
	}
	if !changed {
		return policy
	}
	return strings.Join(policies, ",")
}
