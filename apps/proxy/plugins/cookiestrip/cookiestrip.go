// Package cookiestrip is a Traefik local plugin (yaegi, stdlib only) that
// removes named cookies from the request before it reaches the backend.
//
// App containers (working copy `{app}--{team}` and public copy) live under the
// same parent domain as the platform, so the browser sends them the
// `kacp_session` cookie (Domain=.kacp.cloud). Traefik's built-in headers
// middleware can only drop the whole Cookie header, which would also break the
// app's own cookies. This plugin drops only the configured cookie names and
// keeps every other cookie pair exactly as received. If nothing is left the
// Cookie header is removed.
//
// It must run AFTER the forward-auth middleware (kacp-auth), which still needs
// the session cookie to identify the user.
//
// See docs/design/05-urls-and-storage.md §2 (middleware `strip-session-cookie`),
// docs/design/06-auth.md §3 and docs/spikes/03-iframe-csp.md.
package cookiestrip

import (
	"context"
	"fmt"
	"net/http"
	"strings"
)

// DefaultName is the cookie removed when the config lists no names.
const DefaultName = "kacp_session"

// Config is the plugin configuration (dynamic config key `names`).
type Config struct {
	// Names are exact, case-sensitive cookie names to remove.
	Names []string `json:"names,omitempty"`
}

// CreateConfig returns the default configuration. Names is left nil on
// purpose: Traefik decodes the user list on top of this value, and a non-nil
// default slice could leave stale default entries behind. The default is
// applied in New instead.
func CreateConfig() *Config {
	return &Config{}
}

// CookieStrip is the middleware handler.
type CookieStrip struct {
	next  http.Handler
	name  string
	names map[string]struct{}
}

// New builds the middleware.
func New(_ context.Context, next http.Handler, config *Config, name string) (http.Handler, error) {
	names := map[string]struct{}{}
	if config != nil {
		for _, n := range config.Names {
			n = strings.TrimSpace(n)
			if n == "" {
				continue
			}
			if strings.ContainsAny(n, "=; \t\r\n") {
				return nil, fmt.Errorf("cookiestrip %q: invalid cookie name %q", name, n)
			}
			names[n] = struct{}{}
		}
	}
	if len(names) == 0 {
		names[DefaultName] = struct{}{}
	}
	return &CookieStrip{next: next, name: name, names: names}, nil
}

func (c *CookieStrip) ServeHTTP(rw http.ResponseWriter, req *http.Request) {
	if values := req.Header.Values("Cookie"); len(values) > 0 {
		if kept, changed := c.filter(values); changed {
			if kept == "" {
				req.Header.Del("Cookie")
			} else {
				req.Header.Set("Cookie", kept)
			}
		}
	}
	c.next.ServeHTTP(rw, req)
}

// filter returns the remaining cookie pairs joined with "; " and whether
// anything changed. HTTP/2 clients may split cookies over several Cookie
// header fields; all of them are read and the result is a single field.
func (c *CookieStrip) filter(values []string) (string, bool) {
	kept := make([]string, 0, 8)
	changed := len(values) > 1
	for _, line := range values {
		for _, part := range strings.Split(line, ";") {
			pair := strings.TrimSpace(part)
			if pair == "" {
				changed = true
				continue
			}
			name := pair
			if i := strings.IndexByte(pair, '='); i >= 0 {
				name = strings.TrimSpace(pair[:i])
			}
			if _, drop := c.names[name]; drop {
				changed = true
				continue
			}
			kept = append(kept, pair)
		}
	}
	return strings.Join(kept, "; "), changed
}
