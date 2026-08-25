package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func newTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.HandleMethodNotAllowed = true
	router.NoRoute(NotFound)
	router.NoMethod(MethodNotAllowed)
	router.GET("/api/tasks", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{}) })
	return router
}

func do(t *testing.T, method, path string) (*httptest.ResponseRecorder, errorBody) {
	t.Helper()
	recorder := httptest.NewRecorder()
	newTestRouter().ServeHTTP(recorder, httptest.NewRequest(method, path, nil))

	var body errorBody
	if recorder.Body.Len() > 0 {
		if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
			t.Fatalf("response is not the shared error shape: %v (%q)", err, recorder.Body.String())
		}
	}
	return recorder, body
}

func TestUnknownAPIEndpointExplainsItself(t *testing.T) {
	recorder, body := do(t, http.MethodGet, "/api/nope")

	if recorder.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", recorder.Code)
	}
	if !strings.Contains(body.Error, "/api/nope") {
		t.Errorf("Error = %q, want it to name the path", body.Error)
	}
	// The message must beat Gin's plain-text default, which carries nothing
	// the UI can show.
	if body.Hint == "" {
		t.Error("an unknown API endpoint should carry a hint")
	}
	if got := recorder.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
		t.Errorf("Content-Type = %q, want JSON", got)
	}
}

func TestUnknownNonAPIPathPointsAtTheInterface(t *testing.T) {
	recorder, body := do(t, http.MethodGet, "/assets/missing.js")

	if recorder.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", recorder.Code)
	}
	// The interface is embedded in the binary, so a rebuilt UI reaches the
	// reader only after the server is rebuilt and restarted.
	if !strings.Contains(body.Hint, "npm run build") {
		t.Errorf("Hint = %q, want the build step", body.Hint)
	}
	if strings.Contains(body.Hint, "endpoint") {
		t.Errorf("a static path should not talk about API endpoints: %q", body.Hint)
	}
}

// The two 404 causes get different advice: a missing route is not a missing
// build, and vice versa.
func TestNotFoundHintsDifferByKind(t *testing.T) {
	_, api := do(t, http.MethodGet, "/api/nope")
	_, static := do(t, http.MethodGet, "/assets/missing.js")

	if api.Hint == static.Hint {
		t.Fatalf("both hints are %q", api.Hint)
	}
	if !strings.Contains(api.Hint, "routes") {
		t.Errorf("api hint = %q, want it to mention routes", api.Hint)
	}
}

func TestWrongMethodIsReportedAsSuch(t *testing.T) {
	recorder, body := do(t, http.MethodPost, "/api/tasks")

	// A wrong verb reported as 404 sends the reader hunting for a missing
	// route instead of the actual mistake.
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", recorder.Code)
	}
	if !strings.Contains(body.Error, "POST") {
		t.Errorf("Error = %q, want it to name the method", body.Error)
	}
}

func TestKnownRouteIsUnaffected(t *testing.T) {
	recorder := httptest.NewRecorder()
	newTestRouter().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/tasks", nil))
	if recorder.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", recorder.Code)
	}
}
