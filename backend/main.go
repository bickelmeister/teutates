// Command teutates serves a local web interface for Taskwarrior.
package main

import (
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"

	"github.com/gin-gonic/gin"

	"github.com/bickelmeister/teutates/backend/handlers"
	"github.com/bickelmeister/teutates/backend/taskwarrior"
)

// embeddedUI holds the built interface, so the binary runs on its own with
// no assumptions about what sits next to it on disk. `all:` keeps files the
// embed patterns would otherwise skip, which lets the directory be matched
// on a fresh clone where it holds nothing but .gitkeep.
//
//go:embed all:webui
var embeddedUI embed.FS

// embeddedRoot is the directory inside embeddedUI that holds the interface.
const embeddedRoot = "webui"

func main() {
	// Binding to loopback by default keeps a user's task configuration off
	// the network; teutates has no authentication.
	addr := flag.String("addr", "127.0.0.1:8080", "address to listen on")
	// Serving from disk is for development: the UI can be rebuilt without
	// rebuilding the binary. Empty means the embedded copy.
	uiDir := flag.String("ui", "", "serve the interface from this directory instead of the embedded copy")
	flag.Parse()

	ui, source, err := userInterface(*uiDir)
	if err != nil {
		log.Fatalf("teutates: %v", err)
	}

	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery())
	// Without this Gin answers a wrong method with a 404, which sends the
	// reader looking for a missing route rather than a wrong verb.
	router.HandleMethodNotAllowed = true
	router.NoRoute(handlers.NotFound)
	router.NoMethod(handlers.MethodNotAllowed)

	service := taskwarrior.NewService()
	router.GET("/api/config", handlers.NewConfigHandler(service).Get)
	router.GET("/api/tasks", handlers.NewTasksHandler(service).List)

	router.GET("/", serveUIFile(ui, "index.html"))
	router.GET("/assets/:name", func(c *gin.Context) {
		name := assetPath(c.Param("name"))
		if name == "" {
			handlers.NotFound(c)
			return
		}
		serveUIFile(ui, name)(c)
	})

	log.Printf("teutates listening on http://%s (ui: %s)", *addr, source)
	server := &http.Server{Addr: *addr, Handler: router}
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("teutates: %v", err)
	}
}

// userInterface returns the file system the interface is served from, along
// with a description for the startup log.
func userInterface(dir string) (fs.FS, string, error) {
	if dir != "" {
		return os.DirFS(dir), dir, nil
	}
	embedded, err := fs.Sub(embeddedUI, embeddedRoot)
	if err != nil {
		return nil, "", err
	}
	return embedded, "embedded", nil
}

// assetPath maps a requested asset name into the assets directory, or
// returns "" when the name does not denote a file.
//
// Taking the base name drops any directory part, but path.Base leaves "."
// and ".." intact and joining either of those walks back out of the assets
// directory, so they are rejected outright.
func assetPath(name string) string {
	name = path.Base(name)
	if name == "." || name == ".." || name == "/" {
		return ""
	}
	return path.Join("assets", name)
}

// serveUIFile serves one file from the interface's file system. A missing
// file is reported as an unbuilt interface rather than as an unknown route,
// which is what it actually means.
func serveUIFile(ui fs.FS, name string) gin.HandlerFunc {
	return func(c *gin.Context) {
		data, err := fs.ReadFile(ui, name)
		if err != nil {
			handlers.UINotBuilt(c, name)
			return
		}
		c.Data(http.StatusOK, contentType(name), data)
	}
}

// contentType covers the handful of types the interface ships. Go's
// mime.TypeByExtension depends on the host's mime registry, which has been
// known to report text/plain for .js on some systems.
func contentType(name string) string {
	switch path.Ext(name) {
	case ".html":
		return "text/html; charset=utf-8"
	case ".js":
		return "text/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".json":
		return "application/json; charset=utf-8"
	default:
		return "application/octet-stream"
	}
}
