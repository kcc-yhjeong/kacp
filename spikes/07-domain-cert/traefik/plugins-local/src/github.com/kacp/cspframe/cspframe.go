// Package cspframe: Traefik local plugin (spike 03, 버리는 코드).
// 업스트림 CSP 에서 frame-ancestors 만 재작성하고 X-Frame-Options 를 제거한다.
// WebSocket 이 깨지지 않도록 Hijack/Flush 를 그대로 넘긴다.
package cspframe

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"regexp"
)

type Config struct {
	FrameAncestors string `json:"frameAncestors,omitempty"`
}

func CreateConfig() *Config { return &Config{FrameAncestors: "'self'"} }

type plugin struct {
	next  http.Handler
	value string
}

func New(ctx context.Context, next http.Handler, config *Config, name string) (http.Handler, error) {
	v := config.FrameAncestors
	if v == "" {
		v = "'self'"
	}
	return &plugin{next: next, value: v}, nil
}

var directive = regexp.MustCompile(`frame-ancestors[^;]*`)

func (p *plugin) ServeHTTP(rw http.ResponseWriter, req *http.Request) {
	p.next.ServeHTTP(&wrapper{rw: rw, value: p.value}, req)
}

type wrapper struct {
	rw    http.ResponseWriter
	value string
	done  bool
}

func (w *wrapper) rewrite() {
	if w.done {
		return
	}
	w.done = true
	h := w.rw.Header()
	h.Del("X-Frame-Options")
	for _, k := range []string{"Content-Security-Policy", "Content-Security-Policy-Report-Only"} {
		vals := h.Values(k)
		if len(vals) == 0 {
			continue
		}
		out := make([]string, 0, len(vals))
		for _, v := range vals {
			out = append(out, directive.ReplaceAllString(v, "frame-ancestors "+w.value))
		}
		h.Del(k)
		for _, v := range out {
			h.Add(k, v)
		}
	}
}

func (w *wrapper) Header() http.Header { return w.rw.Header() }

func (w *wrapper) WriteHeader(code int) {
	w.rewrite()
	w.rw.WriteHeader(code)
}

func (w *wrapper) Write(b []byte) (int, error) {
	w.rewrite()
	return w.rw.Write(b)
}

func (w *wrapper) Flush() {
	w.rewrite()
	if f, ok := w.rw.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *wrapper) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := w.rw.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("cspframe: upstream ResponseWriter is not a Hijacker")
	}
	return h.Hijack()
}
