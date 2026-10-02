package cspframe

import (
	"bufio"
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

// openclawCSP mimics the Control UI policy (shape taken from spike 03).
const openclawCSP = "default-src 'self'; frame-ancestors 'none'; frame-src 'self' blob: http: https:; " +
	"script-src 'self' 'sha256-AAAA' 'sha256-BBBB' 'wasm-unsafe-eval'; object-src 'none'"

func TestRewriteFrameAncestors(t *testing.T) {
	tests := []struct {
		name   string
		policy string
		value  string
		want   string
	}{
		{
			name:   "openclaw policy keeps hashes and other directives",
			policy: openclawCSP,
			value:  "'self'",
			want: "default-src 'self'; frame-ancestors 'self'; frame-src 'self' blob: http: https:; " +
				"script-src 'self' 'sha256-AAAA' 'sha256-BBBB' 'wasm-unsafe-eval'; object-src 'none'",
		},
		{
			name:   "no frame-ancestors is left untouched",
			policy: "default-src 'self'; script-src 'self' 'sha256-AAAA'",
			value:  "'self'",
			want:   "default-src 'self'; script-src 'self' 'sha256-AAAA'",
		},
		{
			name:   "frame-src is not mistaken for frame-ancestors",
			policy: "frame-src 'none'; frame-ancestorsx 'none'",
			value:  "'self'",
			want:   "frame-src 'none'; frame-ancestorsx 'none'",
		},
		{
			name:   "first directive",
			policy: "frame-ancestors 'none'; default-src 'self'",
			value:  "'self'",
			want:   "frame-ancestors 'self'; default-src 'self'",
		},
		{
			name:   "last directive with trailing semicolon",
			policy: "default-src 'self'; frame-ancestors 'none';",
			value:  "'self'",
			want:   "default-src 'self'; frame-ancestors 'self';",
		},
		{
			name:   "directive without sources",
			policy: "default-src 'self';frame-ancestors",
			value:  "'self'",
			want:   "default-src 'self';frame-ancestors 'self'",
		},
		{
			name:   "case-insensitive name is normalized",
			policy: "default-src 'self'; Frame-Ancestors 'none'",
			value:  "'self'",
			want:   "default-src 'self'; frame-ancestors 'self'",
		},
		{
			name:   "whitespace around directive is preserved",
			policy: "default-src 'self';  frame-ancestors\t'none'  ; img-src *",
			value:  "'self'",
			want:   "default-src 'self';  frame-ancestors 'self'  ; img-src *",
		},
		{
			name:   "several policies in one header value",
			policy: "default-src 'self'; frame-ancestors 'none', frame-ancestors https://x.example; img-src *",
			value:  "'self'",
			want:   "default-src 'self'; frame-ancestors 'self', frame-ancestors 'self'; img-src *",
		},
		{
			name:   "custom value",
			policy: "frame-ancestors 'none'",
			value:  "'self' https://app.kacp.cloud",
			want:   "frame-ancestors 'self' https://app.kacp.cloud",
		},
		{
			name:   "empty policy",
			policy: "",
			value:  "'self'",
			want:   "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := RewriteFrameAncestors(tt.policy, tt.value); got != tt.want {
				t.Errorf("RewriteFrameAncestors()\n got: %q\nwant: %q", got, tt.want)
			}
		})
	}
}

func TestNewConfig(t *testing.T) {
	next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	tests := []struct {
		name    string
		config  *Config
		want    string
		wantErr bool
	}{
		{name: "default", config: CreateConfig(), want: "'self'"},
		{name: "nil config", config: nil, want: "'self'"},
		{name: "blank uses default", config: &Config{FrameAncestors: "  "}, want: "'self'"},
		{name: "custom", config: &Config{FrameAncestors: "'self' https://app.kacp.cloud"}, want: "'self' https://app.kacp.cloud"},
		{name: "semicolon injection", config: &Config{FrameAncestors: "'self'; script-src *"}, wantErr: true},
		{name: "comma injection", config: &Config{FrameAncestors: "'self', script-src *"}, wantErr: true},
		{name: "newline injection", config: &Config{FrameAncestors: "'self'\r\nX-Evil: 1"}, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, err := New(context.Background(), next, tt.config, "claw-frame")
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got := h.(*CSPFrame).value; got != tt.want {
				t.Errorf("value = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestServeHTTPRewritesHeaders(t *testing.T) {
	tests := []struct {
		name       string
		upstream   func(w http.ResponseWriter)
		wantCSP    []string
		wantReport []string
	}{
		{
			name: "explicit WriteHeader",
			upstream: func(w http.ResponseWriter) {
				w.Header().Set("Content-Security-Policy", openclawCSP)
				w.Header().Set("X-Frame-Options", "DENY")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte("ok"))
			},
			wantCSP: []string{RewriteFrameAncestors(openclawCSP, "'self'")},
		},
		{
			name: "implicit header via Write",
			upstream: func(w http.ResponseWriter) {
				w.Header().Set("Content-Security-Policy", "frame-ancestors 'none'")
				w.Header().Set("X-Frame-Options", "SAMEORIGIN")
				_, _ = w.Write([]byte("ok"))
			},
			wantCSP: []string{"frame-ancestors 'self'"},
		},
		{
			name: "implicit header via Flush",
			upstream: func(w http.ResponseWriter) {
				w.Header().Set("Content-Security-Policy", "frame-ancestors 'none'")
				w.Header().Set("X-Frame-Options", "DENY")
				w.(http.Flusher).Flush()
			},
			wantCSP: []string{"frame-ancestors 'self'"},
		},
		{
			name: "multiple CSP headers and report-only",
			upstream: func(w http.ResponseWriter) {
				w.Header().Add("Content-Security-Policy", "default-src 'self'")
				w.Header().Add("Content-Security-Policy", "frame-ancestors 'none'")
				w.Header().Set("Content-Security-Policy-Report-Only", "frame-ancestors 'none'; report-uri /r")
				w.WriteHeader(http.StatusNotFound)
			},
			wantCSP:    []string{"default-src 'self'", "frame-ancestors 'self'"},
			wantReport: []string{"frame-ancestors 'self'; report-uri /r"},
		},
		{
			name: "no CSP header stays absent",
			upstream: func(w http.ResponseWriter) {
				w.Header().Set("X-Frame-Options", "DENY")
				w.WriteHeader(http.StatusOK)
			},
		},
		{
			name: "headers changed after WriteHeader are not sent",
			upstream: func(w http.ResponseWriter) {
				w.Header().Set("Content-Security-Policy", "frame-ancestors 'none'")
				w.WriteHeader(http.StatusOK)
				w.Header().Set("X-Frame-Options", "DENY") // too late; recorder snapshot already taken
			},
			wantCSP: []string{"frame-ancestors 'self'"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { tt.upstream(w) })
			h, err := New(context.Background(), next, CreateConfig(), "claw-frame")
			if err != nil {
				t.Fatal(err)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://team1.kacp.localhost/claw/", nil))
			res := rec.Result()

			if v := res.Header.Get("X-Frame-Options"); v != "" {
				t.Errorf("X-Frame-Options = %q, want removed", v)
			}
			assertValues(t, "Content-Security-Policy", res.Header.Values("Content-Security-Policy"), tt.wantCSP)
			assertValues(t, "Content-Security-Policy-Report-Only", res.Header.Values("Content-Security-Policy-Report-Only"), tt.wantReport)
		})
	}
}

func assertValues(t *testing.T, key string, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Errorf("%s = %q, want %q", key, got, want)
		return
	}
	for i := range got {
		if got[i] != want[i] {
			t.Errorf("%s[%d] = %q, want %q", key, i, got[i], want[i])
		}
	}
}

// hijackRecorder is a ResponseRecorder that also implements http.Hijacker.
type hijackRecorder struct {
	*httptest.ResponseRecorder
	hijacked bool
	server   net.Conn
	client   net.Conn
}

func (h *hijackRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h.hijacked = true
	return h.server, bufio.NewReadWriter(bufio.NewReader(h.server), bufio.NewWriter(h.server)), nil
}

func TestHijackPassthrough(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()
	rec := &hijackRecorder{ResponseRecorder: httptest.NewRecorder(), server: server, client: client}

	var gotConn net.Conn
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hj, ok := w.(http.Hijacker)
		if !ok {
			t.Fatal("wrapped ResponseWriter does not implement http.Hijacker")
		}
		conn, _, err := hj.Hijack()
		if err != nil {
			t.Fatalf("Hijack: %v", err)
		}
		gotConn = conn
	})
	h, err := New(context.Background(), next, CreateConfig(), "claw-frame")
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "http://team1.kacp.localhost/claw", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	h.ServeHTTP(rec, req)

	if !rec.hijacked {
		t.Fatal("underlying Hijack was not called")
	}
	if gotConn != server {
		t.Fatal("Hijack did not return the underlying connection")
	}
}

func TestHijackUnsupported(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if _, _, err := w.(http.Hijacker).Hijack(); err == nil {
			t.Error("expected error when the underlying writer cannot hijack")
		}
	})
	h, err := New(context.Background(), next, CreateConfig(), "claw-frame")
	if err != nil {
		t.Fatal(err)
	}
	// httptest.ResponseRecorder does not implement http.Hijacker.
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
}

func TestFlushPassthrough(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("chunk"))
		w.(http.Flusher).Flush()
	})
	h, err := New(context.Background(), next, CreateConfig(), "claw-frame")
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if !rec.Flushed {
		t.Error("Flush was not passed to the underlying writer")
	}
}
