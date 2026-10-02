// Package cookiestrip: Traefik local plugin (spike 03, 버리는 코드). 요청 Cookie 에서 지정 쿠키만 제거.
package cookiestrip

import (
	"context"
	"net/http"
	"strings"
)

type Config struct {
	Names []string `json:"names,omitempty"`
}

func CreateConfig() *Config { return &Config{} }

type plugin struct {
	next  http.Handler
	names map[string]bool
}

func New(ctx context.Context, next http.Handler, config *Config, name string) (http.Handler, error) {
	m := map[string]bool{}
	for _, n := range config.Names {
		m[n] = true
	}
	return &plugin{next: next, names: m}, nil
}

func (p *plugin) ServeHTTP(rw http.ResponseWriter, req *http.Request) {
	var keep []string
	for _, line := range req.Header.Values("Cookie") {
		for _, part := range strings.Split(line, ";") {
			kv := strings.TrimSpace(part)
			if kv == "" {
				continue
			}
			name := kv
			if i := strings.Index(kv, "="); i >= 0 {
				name = kv[:i]
			}
			if !p.names[name] {
				keep = append(keep, kv)
			}
		}
	}
	req.Header.Del("Cookie")
	if len(keep) > 0 {
		req.Header.Set("Cookie", strings.Join(keep, "; "))
	}
	p.next.ServeHTTP(rw, req)
}
