package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/bickelmeister/teutates/backend/taskwarrior"
)

// TasksHandler serves the task list.
type TasksHandler struct {
	service *taskwarrior.Service
}

// NewTasksHandler wires a handler to a Taskwarrior service.
func NewTasksHandler(service *taskwarrior.Service) *TasksHandler {
	return &TasksHandler{service: service}
}

// List handles GET /api/tasks?status=pending|completed|all.
func (h *TasksHandler) List(c *gin.Context) {
	filter, err := taskwarrior.ParseStatusFilter(c.Query("status"))
	if err != nil {
		c.JSON(http.StatusBadRequest, errorBody{
			Error: err.Error(),
			Hint:  "Supported values are pending, completed and all.",
		})
		return
	}

	tasks, err := h.service.Tasks(c.Request.Context(), filter)
	if err != nil {
		status, body := classify(err)
		c.JSON(status, body)
		return
	}
	c.JSON(http.StatusOK, tasks)
}
