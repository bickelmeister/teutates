package main

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// Go's mime.TypeByExtension consults the host's mime registry, which has been
// observed to report text/plain for .js. A browser refuses a module served
// that way, so the mapping is fixed in code and pinned here.
func TestContentType(t *testing.T) {
	cases := map[string]string{
		"index.html":        "text/html; charset=utf-8",
		"assets/app.js":     "text/javascript; charset=utf-8",
		"assets/styles.css": "text/css; charset=utf-8",
		"icon.svg":          "image/svg+xml",
		"data.json":         "application/json; charset=utf-8",
		"unknown.bin":       "application/octet-stream",
		"noextension":       "application/octet-stream",
	}
	for name, want := range cases {
		if got := contentType(name); got != want {
			t.Errorf("contentType(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestUserInterfaceDefaultsToTheEmbeddedCopy(t *testing.T) {
	ui, source, err := userInterface("")
	if err != nil {
		t.Fatalf("userInterface: %v", err)
	}
	if source != "embedded" {
		t.Errorf("source = %q, want embedded", source)
	}
	// The embedded directory always matches, even before the UI is built,
	// because .gitkeep is tracked and `all:` includes it.
	if _, err := fs.ReadDir(ui, "."); err != nil {
		t.Errorf("embedded interface is not readable: %v", err)
	}
}

func TestUserInterfaceServesFromDiskWhenAsked(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<p>from disk</p>"), 0o600); err != nil {
		t.Fatal(err)
	}

	ui, source, err := userInterface(dir)
	if err != nil {
		t.Fatalf("userInterface: %v", err)
	}
	if source != dir {
		t.Errorf("source = %q, want %q", source, dir)
	}

	data, err := fs.ReadFile(ui, "index.html")
	if err != nil || string(data) != "<p>from disk</p>" {
		t.Errorf("read from disk = %q, %v", data, err)
	}
}

// The routes are wired the same way main does, so the test covers the actual
// URL handling rather than the helper in isolation.
func newUIRouter(t *testing.T, dir string) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)

	ui, _, err := userInterface(dir)
	if err != nil {
		t.Fatalf("userInterface: %v", err)
	}

	router := gin.New()
	router.GET("/", serveUIFile(ui, "index.html"))
	router.GET("/assets/:name", func(c *gin.Context) {
		name := assetPath(c.Param("name"))
		if name == "" {
			c.Status(http.StatusNotFound)
			return
		}
		serveUIFile(ui, name)(c)
	})
	return router
}

func get(t *testing.T, router *gin.Engine, target string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
	return recorder
}

func TestServesTheInterfaceFromDisk(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<h1>hi</h1>"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "app.js"), []byte("export {}"), 0o600); err != nil {
		t.Fatal(err)
	}

	router := newUIRouter(t, dir)

	page := get(t, router, "/")
	if page.Code != http.StatusOK || page.Body.String() != "<h1>hi</h1>" {
		t.Errorf("/ = %d %q", page.Code, page.Body.String())
	}
	if got := page.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
		t.Errorf("Content-Type = %q", got)
	}

	script := get(t, router, "/assets/app.js")
	if script.Code != http.StatusOK {
		t.Errorf("/assets/app.js = %d", script.Code)
	}
	if got := script.Header().Get("Content-Type"); got != "text/javascript; charset=utf-8" {
		t.Errorf("Content-Type = %q, a module must not be served as text/plain", got)
	}
}

// Before the UI has been built there is nothing to serve, which is a
// different problem from an unknown route and gets its own explanation.
func TestMissingInterfaceExplainsTheBuildStep(t *testing.T) {
	router := newUIRouter(t, t.TempDir())

	recorder := get(t, router, "/")
	if recorder.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "npm run build") {
		t.Errorf("body = %q, want the build step", recorder.Body.String())
	}
}

// The asset name must not be able to reach outside the assets directory.
func TestAssetPathCannotEscape(t *testing.T) {
	cases := map[string]string{
		"app.js":           "assets/app.js",
		"../go.mod":        "assets/go.mod",
		"../../etc/passwd": "assets/passwd",
		"nested/../app.js": "assets/app.js",
		// path.Base leaves these intact, and joining either would step back
		// out of the assets directory, so they resolve to nothing at all.
		"..": "",
		".":  "",
		"/":  "",
		"":   "",
	}
	for name, want := range cases {
		got := assetPath(name)
		if got != want {
			t.Errorf("assetPath(%q) = %q, want %q", name, got, want)
		}
		if got != "" && !strings.HasPrefix(got, "assets/") {
			t.Errorf("assetPath(%q) = %q, which is outside the assets directory", name, got)
		}
	}
}
