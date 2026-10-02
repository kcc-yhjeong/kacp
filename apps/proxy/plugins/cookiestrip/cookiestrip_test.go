package cookiestrip

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestServeHTTP(t *testing.T) {
	tests := []struct {
		name       string
		names      []string
		cookies    []string // request Cookie header fields; nil = no header
		wantCookie []string // Cookie header fields seen by the backend; nil = no header
	}{
		{
			name:       "removes default session cookie and keeps app cookies",
			cookies:    []string{"kacp_session=SECRET; app_pref=dark; theme=1"},
			wantCookie: []string{"app_pref=dark; theme=1"},
		},
		{
			name:       "session cookie in the middle",
			cookies:    []string{"a=1; kacp_session=SECRET; b=2"},
			wantCookie: []string{"a=1; b=2"},
		},
		{
			name:       "only session cookie drops the header",
			cookies:    []string{"kacp_session=SECRET"},
			wantCookie: nil,
		},
		{
			name:       "no cookie header",
			cookies:    nil,
			wantCookie: nil,
		},
		{
			name:       "no matching cookie leaves header untouched",
			cookies:    []string{"a=1;b=2"},
			wantCookie: []string{"a=1;b=2"},
		},
		{
			name:       "name match is exact and case-sensitive",
			cookies:    []string{"KACP_SESSION=x; kacp_session_extra=y; xkacp_session=z"},
			wantCookie: []string{"KACP_SESSION=x; kacp_session_extra=y; xkacp_session=z"},
		},
		{
			name:       "value containing the name is kept",
			cookies:    []string{"note=kacp_session=1; kacp_session=SECRET"},
			wantCookie: []string{"note=kacp_session=1"},
		},
		{
			name:       "duplicate session cookies all removed",
			cookies:    []string{"kacp_session=A; a=1; kacp_session=B"},
			wantCookie: []string{"a=1"},
		},
		{
			name:       "multiple Cookie fields are merged",
			cookies:    []string{"a=1", "kacp_session=SECRET", "b=2"},
			wantCookie: []string{"a=1; b=2"},
		},
		{
			name:       "empty parts and spaces are normalized",
			cookies:    []string{" a=1 ;; kacp_session=S ; b=2; "},
			wantCookie: []string{"a=1; b=2"},
		},
		{
			name:       "custom names",
			names:      []string{"kacp_session", "kacp_dev_user"},
			cookies:    []string{"kacp_dev_user=bob; kacp_session=S; app=1"},
			wantCookie: []string{"app=1"},
		},
		{
			name:       "custom names replace the default",
			names:      []string{"other"},
			cookies:    []string{"kacp_session=S; other=1"},
			wantCookie: []string{"kacp_session=S"},
		},
		{
			name:       "cookie without value",
			cookies:    []string{"flag; kacp_session=S"},
			wantCookie: []string{"flag"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got []string
			var seen bool
			next := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				seen = true
				got = r.Header.Values("Cookie")
			})
			cfg := CreateConfig()
			cfg.Names = tt.names
			h, err := New(context.Background(), next, cfg, "strip-session-cookie")
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(http.MethodGet, "http://todo--team1.kacp.localhost/", nil)
			for _, c := range tt.cookies {
				req.Header.Add("Cookie", c)
			}
			h.ServeHTTP(httptest.NewRecorder(), req)

			if !seen {
				t.Fatal("next handler was not called")
			}
			if len(got) != len(tt.wantCookie) {
				t.Fatalf("Cookie = %q, want %q", got, tt.wantCookie)
			}
			for i := range got {
				if got[i] != tt.wantCookie[i] {
					t.Errorf("Cookie[%d] = %q, want %q", i, got[i], tt.wantCookie[i])
				}
			}
		})
	}
}

func TestNewConfig(t *testing.T) {
	next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	tests := []struct {
		name    string
		config  *Config
		want    []string
		wantErr bool
	}{
		{name: "default", config: CreateConfig(), want: []string{"kacp_session"}},
		{name: "nil config", config: nil, want: []string{"kacp_session"}},
		{name: "blank entries use default", config: &Config{Names: []string{"", " "}}, want: []string{"kacp_session"}},
		{name: "custom", config: &Config{Names: []string{"a", " b "}}, want: []string{"a", "b"}},
		{name: "invalid name", config: &Config{Names: []string{"a=b"}}, wantErr: true},
		{name: "name with semicolon", config: &Config{Names: []string{"a;b"}}, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, err := New(context.Background(), next, tt.config, "strip-session-cookie")
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			names := h.(*CookieStrip).names
			if len(names) != len(tt.want) {
				t.Fatalf("names = %v, want %v", names, tt.want)
			}
			for _, n := range tt.want {
				if _, ok := names[n]; !ok {
					t.Errorf("missing name %q in %v", n, names)
				}
			}
		})
	}
}
