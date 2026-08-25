// Package handlers contains the HTTP layer of the teutates server.
package handlers

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/bickelmeister/teutates/backend/taskwarrior"
)

// ConfigHandler serves the Taskwarrior configuration.
type ConfigHandler struct {
	service *taskwarrior.Service
}

// NewConfigHandler wires a handler to a configuration service.
func NewConfigHandler(service *taskwarrior.Service) *ConfigHandler {
	return &ConfigHandler{service: service}
}

// errorBody is the shape of every error response, so the UI can render a
// useful message instead of a bare status code.
type errorBody struct {
	Error string `json:"error"`
	Hint  string `json:"hint,omitempty"`
}

// Get handles GET /api/config.
func (h *ConfigHandler) Get(c *gin.Context) {
	config, err := h.service.Config(c.Request.Context())
	if err != nil {
		status, body := classify(err)
		c.JSON(status, body)
		return
	}
	c.JSON(http.StatusOK, config)
}

// classify maps a read failure onto an HTTP status the UI can act on.
func classify(err error) (int, errorBody) {
	switch {
	case errors.Is(err, taskwarrior.ErrTaskNotFound):
		return http.StatusServiceUnavailable, errorBody{
			Error: err.Error(),
			Hint:  "Install Taskwarrior and make sure `task` is on the PATH of the process running teutates.",
		}
	case strings.Contains(err.Error(), "timed out"):
		return http.StatusGatewayTimeout, errorBody{
			Error: err.Error(),
			Hint:  "Taskwarrior did not respond. Run `task _show` in a terminal to check for a prompt or a lock.",
		}
	default:
		return http.StatusInternalServerError, errorBody{Error: err.Error()}
	}
}
