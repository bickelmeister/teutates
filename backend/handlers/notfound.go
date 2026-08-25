package handlers

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// apiPrefix marks the routes the UI talks to, as opposed to the static files.
const apiPrefix = "/api/"

// NotFound answers unknown routes.
//
// Gin's default 404 is the plain string "404 page not found", which the UI
// cannot turn into anything better than "Request failed with status 404".
// Answering in the same error shape as the real handlers lets it show
// something a reader can act on.
func NotFound(c *gin.Context) {
	path := c.Request.URL.Path

	if !strings.HasPrefix(path, apiPrefix) {
		c.JSON(http.StatusNotFound, errorBody{
			Error: fmt.Sprintf("Nothing is served at %s.", path),
			Hint:  "The interface is served at /. If it is missing, build it with `npm run build` in the ui directory and restart the server.",
		})
		return
	}

	c.JSON(http.StatusNotFound, errorBody{
		Error: fmt.Sprintf("Unknown API endpoint %s.", path),
		// The overwhelmingly common cause during development: `go run`
		// compiles once at startup, so a running server keeps serving the
		// routes it was built with, however often the sources change.
		Hint: "If this endpoint was added recently, restart the server — a running process does not pick up newly added routes.",
	})
}

// MethodNotAllowed answers a known path reached with the wrong method, which
// Gin otherwise reports as a bare 405 with an empty body.
func MethodNotAllowed(c *gin.Context) {
	c.JSON(http.StatusMethodNotAllowed, errorBody{
		Error: fmt.Sprintf("%s is not supported on %s.", c.Request.Method, c.Request.URL.Path),
		Hint:  "teutates is read-only for now; every endpoint answers GET.",
	})
}

// UINotBuilt answers a request for part of the interface that is not there.
// On a fresh clone the embedded copy is empty until the UI has been built,
// and "nothing is served here" would leave the reader guessing why.
func UINotBuilt(c *gin.Context, name string) {
	c.JSON(http.StatusNotFound, errorBody{
		Error: fmt.Sprintf("The interface file %s is missing.", name),
		Hint:  "Build it with `npm run build` in the ui directory, then restart the server so the new files are embedded.",
	})
}
