// Command teutates serves a local web interface for Taskwarrior.
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"

	"github.com/bickelmeister/teutates/backend/handlers"
	"github.com/bickelmeister/teutates/backend/taskwarrior"
)

func main() {
	// Binding to loopback by default keeps a user's task configuration off
	// the network; teutates has no authentication.
	addr := flag.String("addr", "127.0.0.1:8080", "address to listen on")
	uiDir := flag.String("ui", defaultUIDir(), "directory containing the built UI")
	flag.Parse()

	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery())

	service := taskwarrior.NewService()
	router.GET("/api/config", handlers.NewConfigHandler(service).Get)
	router.GET("/api/tasks", handlers.NewTasksHandler(service).List)

	router.StaticFile("/", filepath.Join(*uiDir, "index.html"))
	router.Static("/assets", filepath.Join(*uiDir, "assets"))

	log.Printf("teutates listening on http://%s (ui: %s)", *addr, *uiDir)
	server := &http.Server{Addr: *addr, Handler: router}
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("teutates: %v", err)
	}
}

// defaultUIDir points at the sibling ui/ directory of a source checkout so
// `go run .` works without flags.
func defaultUIDir() string {
	if wd, err := os.Getwd(); err == nil {
		return filepath.Join(filepath.Dir(wd), "ui")
	}
	return "ui"
}
